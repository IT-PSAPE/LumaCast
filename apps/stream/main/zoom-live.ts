import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ZoomAccount, ZoomMeeting, ZoomMeetingDraft } from '../shared/desktop-api';
import { electronSecureStorage, type SecureStorage } from './secure-storage';

const ZOOM_AUTH = 'https://zoom.us/oauth/authorize';
const ZOOM_TOKEN = 'https://zoom.us/oauth/token';
const ZOOM_API = 'https://api.zoom.us/v2';
const ZOOM_SCOPES = ['meeting:read:list_meetings', 'meeting:write:meeting', 'user:read:user', 'user:read:zak'];
const MAX_OAUTH_WAIT_MS = 5 * 60 * 1000;

interface OAuthTokens { accessToken: string; refreshToken: string; expiresAt: number; }
interface StoredZoomAccount { version: 1; encrypted: string; }
interface StoredZoomAuth { tokens: OAuthTokens; account: ZoomAccount; }
interface ZoomApiError { code?: number; message?: string; }
interface ZoomMeetingResource { id?: number | string; topic?: string; start_time?: string; duration?: number; status?: string; }

function base64Url(value: Buffer): string { return value.toString('base64url'); }

export function createZoomPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  return { verifier, challenge: base64Url(createHash('sha256').update(verifier, 'ascii').digest()) };
}

function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function writeOAuthResponse(response: ServerResponse, message: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>LumaStream</title></head><body><p>${message}</p><p>You can return to LumaStream.</p></body></html>`);
}

function parseZoomError(value: unknown, status: number): Error {
  const body = value && typeof value === 'object' ? value as ZoomApiError : {};
  if (status === 401 || body.code === 124) return new Error('Zoom denied access. Reconnect the account and confirm the app has the required meeting scopes.');
  if (status === 403) return new Error('Zoom denied this request. Check the account plan, app scopes, and Meeting SDK app review status.');
  return new Error(typeof body.message === 'string' ? `Zoom request failed: ${body.message.slice(0, 180)}` : `Zoom request failed (${status}).`);
}

function meetingSummary(resource: ZoomMeetingResource): ZoomMeeting {
  if (resource.id === undefined || resource.id === null) throw new Error('Zoom returned a meeting without an ID.');
  return {
    id: String(resource.id),
    topic: resource.topic ?? 'Untitled meeting',
    startTime: resource.start_time ?? '',
    durationMinutes: typeof resource.duration === 'number' ? resource.duration : 0,
    status: resource.status ?? 'scheduled',
  };
}

function createMeetingBody(draft: ZoomMeetingDraft): Record<string, unknown> {
  const topic = draft.topic.trim();
  const start = Date.parse(draft.startTime);
  if (!topic || topic.length > 200) throw new Error('Enter a meeting name between 1 and 200 characters.');
  if (!Number.isFinite(start) || start < Date.now() - 60_000) throw new Error('Choose a meeting start time in the future.');
  if (!Number.isInteger(draft.durationMinutes) || draft.durationMinutes < 1 || draft.durationMinutes > 1440) throw new Error('Meeting duration must be between 1 and 1,440 minutes.');
  return {
    topic,
    type: 2,
    start_time: new Date(start).toISOString(),
    duration: draft.durationMinutes,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

export class ZoomLiveService {
  private readonly authFile: string;
  private connectTask: Promise<ZoomAccount> | null = null;

  constructor(
    private readonly dataDirectory: string,
    private readonly publicClientId: string,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly secureStorage: SecureStorage = electronSecureStorage,
    private readonly confidentialClientId = '',
    private readonly clientSecret = '',
  ) {
    this.authFile = path.join(dataDirectory, 'zoom-auth.json');
  }

  async getAccount(): Promise<ZoomAccount | null> { return (await this.loadAuth())?.account ?? null; }

  /** Main-process-only Meeting SDK app key; never return this through renderer IPC. */
  getSdkPublicAppKey(): string {
    if (!this.publicClientId) throw new Error('Zoom Meeting SDK is not configured. Set LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID and rebuild LumaStream.');
    return this.publicClientId;
  }

  connect(): Promise<ZoomAccount> {
    if (this.connectTask) return this.connectTask;
    this.connectTask = this.authorize().finally(() => { this.connectTask = null; });
    return this.connectTask;
  }

  async disconnect(): Promise<void> {
    // Zoom's token revocation endpoint requires a client secret. A public desktop
    // PKCE client must never ship that secret, so remove only this device's copy.
    await rm(this.authFile, { force: true });
  }

  async listMeetings(): Promise<ZoomMeeting[]> {
    const meetings: ZoomMeeting[] = [];
    let nextPageToken = '';
    const seenPageTokens = new Set<string>();
    while (true) {
      const params = new URLSearchParams({ type: 'upcoming', page_size: '100' });
      if (nextPageToken) params.set('next_page_token', nextPageToken);
      const result = await this.apiRequest<{ meetings?: ZoomMeetingResource[]; next_page_token?: string }>(`users/me/meetings?${params}`);
      meetings.push(...(result.meetings ?? []).map(meetingSummary));
      const token = result.next_page_token ?? '';
      if (!token) break;
      if (seenPageTokens.has(token)) throw new Error('Zoom returned a repeated meeting page token.');
      seenPageTokens.add(token);
      nextPageToken = token;
    }
    return meetings;
  }

  async createMeeting(draft: ZoomMeetingDraft): Promise<ZoomMeeting> {
    const body = createMeetingBody(draft);
    const result = await this.apiRequest<ZoomMeetingResource>('users/me/meetings', { method: 'POST', body: JSON.stringify(body) });
    return meetingSummary(result);
  }

  async getZak(): Promise<string> {
    const result = await this.apiRequest<{ token?: string }>('users/me/token?type=zak');
    if (!result.token) throw new Error('Zoom did not return a ZAK for the connected account. Check the user:read:zak app scope.');
    return result.token;
  }

  private async authorize(): Promise<ZoomAccount> {
    if (!this.publicClientId) throw new Error('Zoom account connection is not configured. Set LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID and rebuild LumaStream.');
    if (!this.secureStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device, so Zoom cannot be connected safely.');
    const { verifier, challenge } = createZoomPkce();
    const state = base64Url(randomBytes(32));
    const { code, redirectUri } = await this.receiveAuthorizationCode(state, challenge);
    const useConfidentialClient = Boolean(this.confidentialClientId && this.clientSecret);
    const tokenParameters = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: useConfidentialClient ? this.confidentialClientId : this.publicClientId,
    });
    const tokenHeaders: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (useConfidentialClient) {
      const authorization = Buffer.from(`${this.confidentialClientId}:${this.clientSecret}`, 'utf8').toString('base64');
      tokenHeaders.authorization = `Basic ${authorization}`;
    }
    const response = await this.fetcher(ZOOM_TOKEN, {
      method: 'POST',
      headers: tokenHeaders,
      body: tokenParameters,
    });
    const body = await this.readJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(response);
    if (!response.ok || !body.access_token || !body.refresh_token) throw parseZoomError(body, response.status);
    const tokens: OAuthTokens = { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000 };
    const user = await this.apiRequest<{ id?: string; display_name?: string; first_name?: string; last_name?: string; email?: string }>('users/me', undefined, tokens);
    if (!user.id) throw new Error('Zoom did not return a user ID for the connected account.');
    const account: ZoomAccount = {
      userId: user.id,
      displayName: user.display_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Zoom account',
      email: user.email ?? '',
    };
    await this.saveAuth({ tokens, account });
    return account;
  }

  private receiveAuthorizationCode(state: string, challenge: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        const finishRequest = (result: { code: string; redirectUri: string } | { error: Error }) => {
          if ('error' in result) finish(result.error);
          else { resolve(result); finish(); }
        };
        this.handleOAuthCallback(request, response, state, finishRequest);
      });
      const timeout = setTimeout(() => finish(new Error('Zoom sign-in timed out. Try connecting again.')), MAX_OAUTH_WAIT_MS);
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        if (error) reject(error);
      };
      server.on('error', (error) => finish(error));
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') { finish(new Error('Could not open a secure local sign-in callback.')); return; }
        const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
        const url = new URL(ZOOM_AUTH);
        url.search = new URLSearchParams({
          client_id: this.oauthClientId(),
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: ZOOM_SCOPES.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }).toString();
        void this.openExternal(url.toString()).catch((error) => finish(error instanceof Error ? error : new Error('Could not open the system browser for Zoom sign-in.')));
      });
    });
  }

  private handleOAuthCallback(
    request: IncomingMessage,
    response: ServerResponse,
    expectedState: string,
    complete: (result: { code: string; redirectUri: string } | { error: Error }) => void,
  ): void {
    const remoteAddress = request.socket.remoteAddress ?? '';
    if (!remoteAddress.includes('127.0.0.1')) { writeOAuthResponse(response, 'Invalid sign-in response.'); return; }
    let callbackUrl: URL;
    try { callbackUrl = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { writeOAuthResponse(response, 'Invalid sign-in response.'); return; }
    if (request.method !== 'GET' || callbackUrl.pathname !== '/oauth2callback') { response.writeHead(404, { 'cache-control': 'no-store' }); response.end('Not found.'); return; }
    const state = callbackUrl.searchParams.get('state') ?? '';
    const code = callbackUrl.searchParams.get('code') ?? '';
    if (!secureEquals(state, expectedState)) {
      writeOAuthResponse(response, 'Sign-in could not be verified. Return to LumaStream and try again.');
      complete({ error: new Error('Zoom sign-in could not be verified. Try connecting again.') });
      return;
    }
    if (callbackUrl.searchParams.has('error')) {
      writeOAuthResponse(response, 'Zoom sign-in was cancelled.');
      complete({ error: new Error('Zoom sign-in was cancelled.') });
      return;
    }
    if (!code) {
      writeOAuthResponse(response, 'No authorization code was returned.');
      complete({ error: new Error('Zoom did not return an authorization code.') });
      return;
    }
    const port = request.socket.localPort;
    if (!port) { writeOAuthResponse(response, 'Invalid sign-in callback.'); complete({ error: new Error('The Zoom sign-in callback was invalid.') }); return; }
    writeOAuthResponse(response, 'Zoom is connected.');
    complete({ code, redirectUri: `http://127.0.0.1:${port}/oauth2callback` });
  }

  private async apiRequest<T>(pathOrUrl: string, init: RequestInit = {}, suppliedTokens?: OAuthTokens): Promise<T> {
    const tokens = suppliedTokens ?? await this.getUsableTokens();
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${ZOOM_API}/${pathOrUrl}`;
    const send = (accessToken: string) => this.fetcher(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${accessToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    let response = await send(tokens.accessToken);
    if (response.status === 401 && !suppliedTokens) {
      const refreshed = await this.refreshTokens(tokens);
      response = await send(refreshed.accessToken);
    }
    const body = await this.readJson<T>(response);
    if (!response.ok) throw parseZoomError(body, response.status);
    return body;
  }

  private async readJson<T>(response: Response): Promise<T> {
    try { return await response.json() as T; }
    catch { throw new Error(`Zoom returned an invalid response (${response.status}).`); }
  }

  private async getUsableTokens(): Promise<OAuthTokens> {
    const stored = await this.loadAuth();
    if (!stored) throw new Error('Connect a Zoom account first.');
    if (stored.tokens.expiresAt > Date.now() + 60_000) return stored.tokens;
    return this.refreshTokens(stored.tokens);
  }

  private async refreshTokens(current: OAuthTokens): Promise<OAuthTokens> {
    if (!this.confidentialClientId || !this.clientSecret) throw this.reconnectRequired();
    const authorization = Buffer.from(`${this.confidentialClientId}:${this.clientSecret}`, 'utf8').toString('base64');
    const response = await this.fetcher(ZOOM_TOKEN, {
      method: 'POST',
      headers: { authorization: `Basic ${authorization}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: current.refreshToken, grant_type: 'refresh_token' }),
    });
    const body = await this.readJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(response);
    if (!response.ok || !body.access_token) throw parseZoomError(body, response.status);
    const next: OAuthTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? current.refreshToken,
      expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    };
    const stored = await this.loadAuth();
    if (stored) await this.saveAuth({ tokens: next, account: stored.account });
    return next;
  }

  private oauthClientId(): string {
    return this.confidentialClientId && this.clientSecret ? this.confidentialClientId : this.publicClientId;
  }

  private reconnectRequired(): Error {
    return new Error('Zoom access expired or was rejected. Reconnect your account to continue.');
  }

  private async loadAuth(): Promise<StoredZoomAuth | null> {
    if (!this.secureStorage.isEncryptionAvailable()) return null;
    try {
      const raw = JSON.parse(await readFile(this.authFile, 'utf8')) as StoredZoomAccount;
      if (raw.version !== 1 || typeof raw.encrypted !== 'string') return null;
      const value = JSON.parse(this.secureStorage.decryptString(Buffer.from(raw.encrypted, 'base64'))) as StoredZoomAuth;
      if (!value?.tokens?.accessToken || !value.tokens.refreshToken || !Number.isFinite(value.tokens.expiresAt) || !value.account?.userId) return null;
      return value;
    } catch { return null; }
  }

  private async saveAuth(value: StoredZoomAuth): Promise<void> {
    if (!this.secureStorage.isEncryptionAvailable()) throw new Error('Secure credential storage became unavailable. Reconnect Zoom after enabling OS secure storage.');
    await mkdir(this.dataDirectory, { recursive: true });
    const temporary = `${this.authFile}.${randomBytes(8).toString('hex')}.tmp`;
    const record: StoredZoomAccount = { version: 1, encrypted: this.secureStorage.encryptString(JSON.stringify(value)).toString('base64') };
    try {
      await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.authFile);
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }
}
