import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StreamOutputSettings, YouTubeAccount, YouTubeBroadcast, YouTubeBroadcastDraft, YouTubeLiveDetails, YouTubeLiveNotice } from '../shared/desktop-api';
import { StreamOutput } from './stream-output';
import { electronSecureStorage, type SecureStorage } from './secure-storage';

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const MAX_OAUTH_WAIT_MS = 5 * 60 * 1000;

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface StoredYouTubeAccount {
  version: 1;
  encrypted: string;
}

interface StoredYouTubeAuth {
  tokens: OAuthTokens;
  account: YouTubeAccount;
}

interface YouTubeApiErrorBody {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

interface YouTubeBroadcastResource {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    scheduledStartTime?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } };
  };
  status?: { lifeCycleStatus?: string; privacyStatus?: string };
  contentDetails?: {
    boundStreamId?: string;
    monitorStream?: { enableMonitorStream?: boolean };
  };
}

interface YouTubeStreamResource {
  id?: string;
  status?: {
    streamStatus?: string;
    healthStatus?: {
      status?: string;
      configurationIssues?: Array<{
        type?: string;
        reason?: string;
        severity?: string;
        description?: string;
      }>;
    };
  };
  cdn?: { ingestionInfo?: { rtmpsIngestionAddress?: string; streamName?: string } };
}

interface YouTubeVideoResource {
  id?: string;
  snippet?: { title?: string };
  statistics?: { viewCount?: string | number };
  liveStreamingDetails?: { concurrentViewers?: string | number };
  status?: { uploadStatus?: string; failureReason?: string; rejectionReason?: string };
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function apiCount(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const count = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function liveHealth(value: unknown): YouTubeLiveDetails['health'] {
  if (value === 'good') return 'excellent';
  if (value === 'ok') return 'warning';
  if (value === 'bad') return 'error';
  return 'waiting';
}

function displayIssueType(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function streamHealthNotices(stream: YouTubeStreamResource | undefined): YouTubeLiveNotice[] {
  const issues = stream?.status?.healthStatus?.configurationIssues ?? [];
  const notices: YouTubeLiveNotice[] = [];
  for (const issue of issues) {
    if (issue.severity !== 'info' && issue.severity !== 'warning' && issue.severity !== 'error') continue;
    const type = optionalText(issue.type, 100);
    const description = optionalText(issue.description, 1000) ?? optionalText(issue.reason, 180);
    if (!type || !description) continue;
    notices.push({ severity: issue.severity, title: optionalText(issue.reason, 180) ?? displayIssueType(type), description, type });
  }
  return notices;
}

function videoStatusNotice(video: YouTubeVideoResource | undefined): YouTubeLiveNotice | null {
  const status = video?.status;
  if (!status) return null;
  if (status.uploadStatus === 'rejected') {
    const reason = optionalText(status.rejectionReason, 100);
    return {
      severity: 'error',
      title: 'Video rejected',
      description: reason ? `YouTube rejected this video for ${displayIssueType(reason).toLowerCase()}.` : 'YouTube rejected this video.',
      type: `rejected${reason ? `:${reason}` : ''}`,
    };
  }
  if (status.uploadStatus === 'failed') {
    const reason = optionalText(status.failureReason, 100);
    return {
      severity: 'error',
      title: 'Video upload failed',
      description: reason ? `YouTube reported a video upload failure: ${displayIssueType(reason).toLowerCase()}.` : 'YouTube reported a video upload failure.',
      type: `failed${reason ? `:${reason}` : ''}`,
    };
  }
  return null;
}

function emptyLiveDetails(): YouTubeLiveDetails {
  return { title: null, currentViewers: null, viewCount: null, health: 'waiting', notices: [] };
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

export function createYouTubePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier, 'ascii').digest());
  return { verifier, challenge };
}

function writeOAuthResponse(response: ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>LumaStream</title></head><body><p>${message}</p><p>You can return to LumaStream.</p></body></html>`);
}

function secureEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function parseApiError(body: unknown, status: number): Error {
  const apiError = body && typeof body === 'object' ? (body as YouTubeApiErrorBody).error : undefined;
  const reason = apiError?.errors?.[0]?.reason;
  if (reason === 'liveStreamingNotEnabled') return new Error('This YouTube channel is not enabled for live streaming. Check channel eligibility in YouTube Studio.');
  if (status === 401 || status === 403) return new Error('YouTube denied access. Reconnect the account or check its live streaming eligibility.');
  if (typeof apiError?.message === 'string') return new Error(`YouTube request failed: ${apiError.message.slice(0, 180)}`);
  return new Error(`YouTube request failed (${status}).`);
}

function broadcastSummary(resource: YouTubeBroadcastResource): YouTubeBroadcast {
  const id = resource.id;
  if (!id) throw new Error('YouTube returned a stream without an ID.');
  const thumbnails = resource.snippet?.thumbnails;
  return {
    id,
    title: resource.snippet?.title ?? 'Untitled stream',
    description: resource.snippet?.description ?? '',
    scheduledStartTime: resource.snippet?.scheduledStartTime ?? '',
    status: resource.status?.lifeCycleStatus ?? 'created',
    privacy: resource.status?.privacyStatus === 'public' || resource.status?.privacyStatus === 'private' ? resource.status.privacyStatus : 'unlisted',
    thumbnailUrl: thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? '',
  };
}

function createBroadcastBody(draft: YouTubeBroadcastDraft): Record<string, unknown> {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const start = Date.parse(draft.scheduledStartTime);
  if (!title || title.length > 100) throw new Error('Enter a stream title between 1 and 100 characters.');
  if (description.length > 5000) throw new Error('The stream description is too long.');
  if (!Number.isFinite(start) || start < Date.now() - 60_000) throw new Error('Choose a valid stream start time in the future.');
  if (draft.privacy !== 'public' && draft.privacy !== 'unlisted' && draft.privacy !== 'private') throw new Error('Choose a valid stream privacy setting.');
  return {
    snippet: { title, description, scheduledStartTime: new Date(start).toISOString() },
    status: { privacyStatus: draft.privacy },
    contentDetails: {
      enableAutoStart: false,
      enableAutoStop: true,
      monitorStream: { enableMonitorStream: false },
    },
  };
}

function buildIngestDestination(address: string, streamName: string): string {
  let url: URL;
  try { url = new URL(address); } catch { throw new Error('YouTube returned an invalid RTMPS ingest address.'); }
  if (url.protocol !== 'rtmps:' || url.port !== '443' || !url.hostname.toLowerCase().endsWith('.youtube.com') || !streamName || /[\u0000-\u001f\u007f/#?]/.test(streamName)) {
    throw new Error('YouTube returned an unsupported RTMPS ingest configuration.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(streamName)}`;
  return url.toString();
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timeout = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

export class YouTubeLiveService {
  private readonly authFile: string;
  private readonly transitionMonitors = new Map<string, AbortController>();
  private readonly broadcastsByOutput = new Map<string, string>();
  private connectTask: Promise<YouTubeAccount> | null = null;

  constructor(
    private readonly dataDirectory: string,
    private readonly output: StreamOutput,
    private readonly clientId: string,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly secureStorage: SecureStorage = electronSecureStorage,
  ) {
    this.authFile = path.join(dataDirectory, 'youtube-auth.json');
  }

  async getAccount(): Promise<YouTubeAccount | null> {
    return (await this.loadAuth())?.account ?? null;
  }

  connect(): Promise<YouTubeAccount> {
    if (this.connectTask) return this.connectTask;
    this.connectTask = this.authorize().finally(() => { this.connectTask = null; });
    return this.connectTask;
  }

  async disconnect(): Promise<void> {
    const stored = await this.loadAuth();
    if (!stored) return;
    await this.fetcher(GOOGLE_REVOKE, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: stored.tokens.refreshToken }),
    }).catch(() => undefined);
    await rm(this.authFile, { force: true });
  }

  async listBroadcasts(): Promise<YouTubeBroadcast[]> {
    const broadcasts: YouTubeBroadcast[] = [];
    let pageToken = '';
    const seenPageTokens = new Set<string>();
    while (true) {
      const params = new URLSearchParams({ part: 'id,snippet,status,contentDetails', mine: 'true', broadcastStatus: 'upcoming', maxResults: '50' });
      if (pageToken) params.set('pageToken', pageToken);
      const result = await this.apiRequest<{ items?: YouTubeBroadcastResource[]; nextPageToken?: string }>(`liveBroadcasts?${params}`);
      broadcasts.push(...(result.items ?? []).map(broadcastSummary));
      const nextPageToken = result.nextPageToken ?? '';
      if (!nextPageToken) break;
      if (seenPageTokens.has(nextPageToken)) throw new Error('YouTube returned a repeated stream page token.');
      seenPageTokens.add(nextPageToken);
      pageToken = nextPageToken;
    }
    return broadcasts;
  }

  async getLiveDetails(broadcastIdValue: unknown): Promise<YouTubeLiveDetails> {
    if (typeof broadcastIdValue !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(broadcastIdValue)) throw new Error('Select a valid YouTube stream.');
    const broadcastId = broadcastIdValue;
    const broadcastParams = new URLSearchParams({ id: broadcastId, part: 'id,snippet,contentDetails' });
    const broadcastResponse = await this.apiRequest<{ items?: YouTubeBroadcastResource[] }>(`liveBroadcasts?${broadcastParams}`);
    const broadcast = broadcastResponse.items?.find((item) => item.id === broadcastId);
    if (!broadcast) return emptyLiveDetails();

    const videoParams = new URLSearchParams({ id: broadcastId, part: 'id,snippet,statistics,liveStreamingDetails,status' });
    const streamId = broadcast.contentDetails?.boundStreamId;
    const [videoResponse, streamResponse] = await Promise.all([
      this.apiRequest<{ items?: YouTubeVideoResource[] }>(`videos?${videoParams}`),
      streamId
        ? this.apiRequest<{ items?: YouTubeStreamResource[] }>(`liveStreams?${new URLSearchParams({ id: streamId, part: 'id,status' })}`)
        : Promise.resolve(undefined),
    ]);
    const video = videoResponse.items?.find((item) => item.id === broadcastId);
    const stream = streamId ? streamResponse?.items?.find((item) => item.id === streamId) : undefined;
    const notices = streamHealthNotices(stream);
    const statusNotice = videoStatusNotice(video);
    if (statusNotice) notices.push(statusNotice);

    return {
      title: optionalText(video?.snippet?.title, 300) ?? optionalText(broadcast.snippet?.title, 300),
      currentViewers: apiCount(video?.liveStreamingDetails?.concurrentViewers),
      viewCount: apiCount(video?.statistics?.viewCount),
      health: liveHealth(stream?.status?.healthStatus?.status),
      notices,
    };
  }

  async createBroadcast(draft: YouTubeBroadcastDraft): Promise<YouTubeBroadcast> {
    const body = createBroadcastBody(draft);
    const result = await this.apiRequest<{ id?: string; snippet?: YouTubeBroadcastResource['snippet']; status?: YouTubeBroadcastResource['status'] }> (
      'liveBroadcasts?part=id,snippet,status,contentDetails', { method: 'POST', body: JSON.stringify(body) },
    );
    return broadcastSummary(result);
  }

  async startBroadcast(broadcastIdValue: unknown, settings: StreamOutputSettings): Promise<string> {
    if (typeof broadcastIdValue !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(broadcastIdValue)) throw new Error('Select a valid YouTube stream.');
    const broadcastId = broadcastIdValue;
    const broadcastResponse = await this.apiRequest<{ items?: YouTubeBroadcastResource[] }>(`liveBroadcasts?${new URLSearchParams({ id: broadcastId, part: 'id,snippet,status,contentDetails' })}`);
    const broadcast = broadcastResponse.items?.[0];
    if (!broadcast || !broadcast.id) throw new Error('The selected YouTube stream could not be found. Refresh the stream list.');
    if (broadcast.status?.lifeCycleStatus === 'complete' || broadcast.status?.lifeCycleStatus === 'revoked') throw new Error('This YouTube stream has already ended.');

    let streamId = broadcast.contentDetails?.boundStreamId;
    if (!streamId) {
      const frameRate = settings.frameRate > 30 ? '60fps' : '30fps';
      const resolution = settings.height >= 2160 ? '2160p' : settings.height >= 1440 ? '1440p' : settings.height >= 1080 ? '1080p' : settings.height >= 720 ? '720p' : settings.height >= 480 ? '480p' : '360p';
      const stream = await this.apiRequest<YouTubeStreamResource>('liveStreams?part=id,snippet,cdn,contentDetails', {
        method: 'POST',
        body: JSON.stringify({ snippet: { title: `${broadcast.snippet?.title ?? 'LumaStream'} ingest` }, cdn: { frameRate, ingestionType: 'rtmp', resolution }, contentDetails: { isReusable: false } }),
      });
      if (!stream.id) throw new Error('YouTube did not create an ingest stream.');
      streamId = stream.id;
      const bindParams = new URLSearchParams({ part: 'id,snippet,contentDetails', id: broadcastId, streamId });
      await this.apiRequest(`liveBroadcasts/bind?${bindParams}`, { method: 'POST' });
      const destination = this.ingestDestination(stream);
      const outputId = this.output.start(destination, this.youtubeSettings(settings), 'youtube', 'external');
      this.broadcastsByOutput.set(outputId, broadcastId);
      this.monitorTransition(outputId, broadcastId, streamId, broadcast.snippet?.scheduledStartTime ?? '', broadcast.contentDetails?.monitorStream?.enableMonitorStream !== false);
      return outputId;
    }

    const streamResponse = await this.apiRequest<{ items?: YouTubeStreamResource[] }>(`liveStreams?${new URLSearchParams({ id: streamId, part: 'id,cdn,status' })}`);
    const stream = streamResponse.items?.[0];
    if (!stream) throw new Error('The selected YouTube stream ingest details could not be loaded.');
    const destination = this.ingestDestination(stream);
    const outputId = this.output.start(destination, this.youtubeSettings(settings), 'youtube', 'external');
    this.broadcastsByOutput.set(outputId, broadcastId);
    this.monitorTransition(outputId, broadcastId, streamId, broadcast.snippet?.scheduledStartTime ?? '', broadcast.contentDetails?.monitorStream?.enableMonitorStream !== false);
    return outputId;
  }

  async stopStreaming(id: string): Promise<void> {
    this.transitionMonitors.get(id)?.abort();
    this.transitionMonitors.delete(id);
    await this.output.stop(id);
    const broadcastId = this.broadcastsByOutput.get(id);
    this.broadcastsByOutput.delete(id);
    if (broadcastId) void this.completeBroadcastIfLive(broadcastId).catch(() => undefined);
  }

  async stopAll(): Promise<void> {
    for (const controller of this.transitionMonitors.values()) controller.abort();
    this.transitionMonitors.clear();
  }

  private async authorize(): Promise<YouTubeAccount> {
    if (!this.clientId) throw new Error('YouTube account connection is not configured. Set LUMASTREAM_GOOGLE_CLIENT_ID and rebuild LumaStream.');
    if (!this.secureStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device, so YouTube cannot be connected safely.');
    const { verifier, challenge } = createYouTubePkce();
    const state = base64Url(randomBytes(32));
    const { code, redirectUri } = await this.receiveAuthorizationCode(state, challenge);
    const response = await this.fetcher(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }),
    });
    const tokenBody = await this.readJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(response);
    if (!response.ok || !tokenBody.access_token || !tokenBody.refresh_token) throw parseApiError(tokenBody, response.status);
    const tokens: OAuthTokens = { accessToken: tokenBody.access_token, refreshToken: tokenBody.refresh_token, expiresAt: Date.now() + Math.max(60, tokenBody.expires_in ?? 3600) * 1000 };
    const channels = await this.apiRequest<{ items?: Array<{ id?: string; snippet?: { title?: string } }> }>('channels?part=id,snippet&mine=true', undefined, tokens);
    const channel = channels.items?.[0];
    if (!channel?.id) throw new Error('The connected Google account has no YouTube channel.');
    const account = { channelId: channel.id, channelTitle: channel.snippet?.title ?? 'YouTube channel' };
    await this.saveAuth({ tokens, account });
    return account;
  }

  private receiveAuthorizationCode(state: string, challenge: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => this.handleOAuthCallback(request, response, state, (result) => {
        if ('error' in result) reject(result.error);
        else resolve(result);
      }));
      const timeout = setTimeout(() => finish(new Error('YouTube sign-in timed out. Try connecting again.')), MAX_OAUTH_WAIT_MS);
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
        const url = new URL(GOOGLE_AUTH);
        url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirectUri, response_type: 'code', scope: YOUTUBE_SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' }).toString();
        void this.openExternal(url.toString()).catch((error) => finish(error instanceof Error ? error : new Error('Could not open the system browser for YouTube sign-in.')));
      });
      // resolve() itself does not close the loopback server because the callback
      // also needs to serve a result page. Close after the HTTP response ends.
      server.on('request', (_request, response) => response.once('finish', () => finish()));
    });
  }

  private handleOAuthCallback(
    request: IncomingMessage,
    response: ServerResponse,
    expectedState: string,
    complete: (result: { code: string; redirectUri: string } | { error: Error }) => void,
  ): void {
    const host = request.headers.host ?? '';
    let callbackUrl: URL;
    try { callbackUrl = new URL(request.url ?? '/', `http://${host}`); } catch { writeOAuthResponse(response, 400, 'Invalid sign-in response.'); return; }
    if (request.method !== 'GET' || callbackUrl.pathname !== '/oauth2callback') { writeOAuthResponse(response, 404, 'Not found.'); return; }
    const state = callbackUrl.searchParams.get('state') ?? '';
    const code = callbackUrl.searchParams.get('code') ?? '';
    if (!secureEquals(state, expectedState)) {
      writeOAuthResponse(response, 400, 'Sign-in could not be verified. Return to LumaStream and try again.');
      complete({ error: new Error('YouTube sign-in could not be verified. Try connecting again.') });
      return;
    }
    const address = request.socket.localAddress;
    const port = request.socket.localPort;
    if (!address || !port) { writeOAuthResponse(response, 400, 'Invalid sign-in callback.'); complete({ error: new Error('The YouTube sign-in callback was invalid.') }); return; }
    if (callbackUrl.searchParams.has('error')) {
      writeOAuthResponse(response, 200, 'YouTube sign-in was cancelled.');
      complete({ error: new Error('YouTube sign-in was cancelled.') });
      return;
    }
    if (!code) { writeOAuthResponse(response, 400, 'No authorization code was returned.'); complete({ error: new Error('YouTube did not return an authorization code.') }); return; }
    writeOAuthResponse(response, 200, 'YouTube is connected.');
    complete({ code, redirectUri: `http://127.0.0.1:${port}/oauth2callback` });
  }

  private async apiRequest<T>(pathOrUrl: string, init: RequestInit = {}, suppliedTokens?: OAuthTokens): Promise<T> {
    const firstTokens = suppliedTokens ?? await this.getUsableTokens();
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${YOUTUBE_API}/${pathOrUrl}`;
    const send = (accessToken: string) => this.fetcher(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${accessToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    let response = await send(firstTokens.accessToken);
    if (response.status === 401 && !suppliedTokens) {
      const refreshed = await this.refreshTokens(firstTokens);
      response = await send(refreshed.accessToken);
    }
    const body = await this.readJson<T>(response);
    if (!response.ok) throw parseApiError(body, response.status);
    return body;
  }

  private async readJson<T>(response: Response): Promise<T> {
    try { return await response.json() as T; }
    catch { throw new Error(`The YouTube service returned an invalid response (${response.status}).`); }
  }

  private async getUsableTokens(): Promise<OAuthTokens> {
    const stored = await this.loadAuth();
    if (!stored) throw new Error('Connect a YouTube account first.');
    if (stored.tokens.expiresAt > Date.now() + 60_000) return stored.tokens;
    return this.refreshTokens(stored.tokens);
  }

  private async refreshTokens(current: OAuthTokens): Promise<OAuthTokens> {
    const response = await this.fetcher(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, refresh_token: current.refreshToken, grant_type: 'refresh_token' }),
    });
    const body = await this.readJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(response);
    if (!response.ok || !body.access_token) throw parseApiError(body, response.status);
    const next = { accessToken: body.access_token, refreshToken: body.refresh_token ?? current.refreshToken, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000 };
    const stored = await this.loadAuth();
    if (stored) await this.saveAuth({ tokens: next, account: stored.account });
    return next;
  }

  private async loadAuth(): Promise<StoredYouTubeAuth | null> {
    if (!this.secureStorage.isEncryptionAvailable()) return null;
    try {
      const raw = JSON.parse(await readFile(this.authFile, 'utf8')) as StoredYouTubeAccount;
      if (raw.version !== 1 || typeof raw.encrypted !== 'string') return null;
      const decrypted = this.secureStorage.decryptString(Buffer.from(raw.encrypted, 'base64'));
      const value = JSON.parse(decrypted) as StoredYouTubeAuth;
      if (!value?.tokens?.accessToken || !value.tokens.refreshToken || !Number.isFinite(value.tokens.expiresAt) || !value.account?.channelId) return null;
      return value;
    } catch { return null; }
  }

  private async saveAuth(value: StoredYouTubeAuth): Promise<void> {
    if (!this.secureStorage.isEncryptionAvailable()) throw new Error('Secure credential storage became unavailable. Reconnect YouTube after enabling OS secure storage.');
    await mkdir(this.dataDirectory, { recursive: true });
    const temporary = `${this.authFile}.${randomBytes(8).toString('hex')}.tmp`;
    const record: StoredYouTubeAccount = { version: 1, encrypted: this.secureStorage.encryptString(JSON.stringify(value)).toString('base64') };
    try {
      await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.authFile);
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }

  private ingestDestination(stream: YouTubeStreamResource): string {
    const info = stream.cdn?.ingestionInfo;
    if (!info?.rtmpsIngestionAddress || !info.streamName) throw new Error('YouTube did not return RTMPS ingest details for this stream.');
    return buildIngestDestination(info.rtmpsIngestionAddress, info.streamName);
  }

  private youtubeSettings(settings: StreamOutputSettings): StreamOutputSettings {
    // YouTube recommends a two second keyframe interval and allows at most four.
    return { ...settings, keyframeIntervalSeconds: Math.min(settings.keyframeIntervalSeconds, 4) };
  }

  private async completeBroadcastIfLive(broadcastId: string): Promise<void> {
    const result = await this.apiRequest<{ items?: YouTubeBroadcastResource[] }>(`liveBroadcasts?${new URLSearchParams({ id: broadcastId, part: 'id,status' })}`);
    const state = result.items?.[0]?.status?.lifeCycleStatus;
    if (state !== 'live' && state !== 'testing') return;
    const params = new URLSearchParams({ part: 'id,status', id: broadcastId, broadcastStatus: 'complete' });
    await this.apiRequest(`liveBroadcasts/transition?${params}`, { method: 'POST' });
  }

  private monitorTransition(outputId: string, broadcastId: string, streamId: string, scheduledStartTime: string, monitorStreamEnabled: boolean): void {
    const controller = new AbortController();
    this.transitionMonitors.set(outputId, controller);
    void (async () => {
      try {
        let attempts = 0;
        while (attempts < 120) {
          if (controller.signal.aborted) return;
          const result = await this.apiRequest<{ items?: YouTubeStreamResource[] }>(`liveStreams?${new URLSearchParams({ id: streamId, part: 'id,status' })}`);
          if (result.items?.[0]?.status?.streamStatus === 'active') break;
          attempts += 1;
          await wait(1500, controller.signal);
        }
        if (attempts >= 120) throw new Error('YouTube did not detect an incoming video stream. Check the encoder connection and try again.');
        while (!controller.signal.aborted && scheduledStartTime) {
          const scheduledAt = Date.parse(scheduledStartTime);
          if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) break;
          await wait(Math.min(10_000, scheduledAt - Date.now()), controller.signal);
        }
        if (controller.signal.aborted) return;
        const stateUrl = `liveBroadcasts?${new URLSearchParams({ id: broadcastId, part: 'id,status' })}`;
        const readState = async () => {
          const result = await this.apiRequest<{ items?: YouTubeBroadcastResource[] }>(stateUrl);
          return result.items?.[0]?.status?.lifeCycleStatus;
        };
        const transition = async (target: 'testing' | 'live') => {
          const params = new URLSearchParams({ part: 'id,status', id: broadcastId, broadcastStatus: target });
          await this.apiRequest(`liveBroadcasts/transition?${params}`, { method: 'POST' });
        };
        let state = await readState();
        if (state === 'complete' || state === 'revoked') throw new Error('YouTube ended or revoked this stream before it went live.');
        if (state !== 'live' && state !== 'liveStarting') {
          if (monitorStreamEnabled && state !== 'testing' && state !== 'testStarting') {
            await transition('testing');
            state = 'testStarting';
          }
          if (state === 'testStarting') {
            for (let attempt = 0; state === 'testStarting' && attempt < 40; attempt += 1) {
              if (controller.signal.aborted) return;
              await wait(1500, controller.signal);
              if (controller.signal.aborted) return;
              state = await readState();
              if (state === 'complete' || state === 'revoked') throw new Error('YouTube ended or revoked this stream before it went live.');
            }
            if (state === 'testStarting') throw new Error('YouTube did not finish preparing the stream preview. Check YouTube Studio and try again.');
          }
          if (state !== 'live' && state !== 'liveStarting') await transition('live');
        }
        for (let attempt = 0; state !== 'live' && attempt < 40; attempt += 1) {
          if (controller.signal.aborted) return;
          await wait(1500, controller.signal);
          if (controller.signal.aborted) return;
          state = await readState();
          if (state === 'complete' || state === 'revoked') throw new Error('YouTube ended or revoked this stream before it went live.');
        }
        if (state !== 'live') throw new Error('YouTube did not finish starting the stream. Check YouTube Studio and try again.');
        this.output.reportStatus(outputId, { state: 'live' });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'YouTube could not start the selected stream.';
        this.output.reportStatus(outputId, { state: 'error', message });
        await this.output.stop(outputId).catch(() => undefined);
        this.broadcastsByOutput.delete(outputId);
      } finally {
        if (this.transitionMonitors.get(outputId) === controller) this.transitionMonitors.delete(outputId);
      }
    })();
  }
}
