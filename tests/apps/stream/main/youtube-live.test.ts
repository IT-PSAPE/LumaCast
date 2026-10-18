// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamOutputSettings } from '../../../../apps/stream/shared/desktop-api';
import { StreamOutput } from '../../../../apps/stream/main/stream-output';
import { YouTubeLiveService, createYouTubePkce } from '../../../../apps/stream/main/youtube-live';

const temporaryDirectories: string[] = [];
const authTokens = { accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 60 * 60 * 1000 };
const account = { channelId: 'channel-1', channelTitle: 'Test Channel' };

const secureStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, 'utf8')),
  decryptString: vi.fn((value: Buffer) => {
    const text = value.toString('utf8');
    if (!text.startsWith('encrypted:')) throw new Error('Unable to decrypt.');
    return text.slice('encrypted:'.length);
  }),
};

const outputSettings: StreamOutputSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoBitrateKbps: 6000,
  audioBitrateKbps: 160,
  rateControl: 'cbr',
  encoder: 'libopenh264',
  encoderQuality: 23,
  hardwareEncoding: false,
  keyframeIntervalSeconds: 2,
};

afterEach(async () => {
  secureStorage.isEncryptionAvailable.mockReturnValue(true);
  secureStorage.encryptString.mockClear();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createService(fetcher: typeof fetch, openExternal = vi.fn(async () => undefined), output = createOutput()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-youtube-live-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    output,
    openExternal,
    service: new YouTubeLiveService(directory, output, 'google-client-id', openExternal, fetcher, secureStorage),
  };
}

function createOutput() {
  return {
    start: vi.fn(() => 'output-session'),
    reportStatus: vi.fn(),
    stop: vi.fn(async () => undefined),
  } as unknown as StreamOutput & { start: ReturnType<typeof vi.fn>; reportStatus: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
}

async function storeAuth(directory: string, tokens = authTokens): Promise<void> {
  const value = { tokens, account };
  const encrypted = secureStorage.encryptString(JSON.stringify(value)).toString('base64');
  await writeFile(path.join(directory, 'youtube-auth.json'), JSON.stringify({ version: 1, encrypted }), 'utf8');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('YouTube Live integration', () => {
  it('creates an S256 PKCE challenge from a high-entropy verifier', () => {
    const { verifier, challenge } = createYouTubePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier, 'ascii').digest('base64url'));
  });

  it('connects through a state-checked loopback OAuth callback and encrypts refresh credentials', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') return jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
      if (url.endsWith('/channels?part=id,snippet&mine=true')) return jsonResponse({ items: [{ id: 'channel-1', snippet: { title: 'Test Channel' } }] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    let authorizationUrl: URL | null = null;
    const openExternal = vi.fn(async (rawUrl: string) => {
      authorizationUrl = new URL(rawUrl);
      const callback = new URL(authorizationUrl.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({ code: 'authorization-code', state: authorizationUrl.searchParams.get('state')! }).toString();
      const response = await fetch(callback);
      expect(response.ok).toBe(true);
    });
    const { directory, service } = await createService(fetcher, openExternal);

    await expect(service.connect()).resolves.toEqual(account);

    expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl?.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.force-ssl');
    const tokenRequest = requests.find((request) => request.url === 'https://oauth2.googleapis.com/token');
    const tokenBody = new URLSearchParams(String(tokenRequest?.init?.body));
    const expectedChallenge = createHash('sha256').update(tokenBody.get('code_verifier')!, 'ascii').digest('base64url');
    expect(authorizationUrl?.searchParams.get('code_challenge')).toBe(expectedChallenge);
    const persisted = await readFile(path.join(directory, 'youtube-auth.json'), 'utf8');
    expect(persisted).not.toContain('new-refresh');
    expect(await service.getAccount()).toEqual(account);
  });

  it('lists upcoming broadcasts and creates one with validated details', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/liveBroadcasts?') && init?.method === 'POST') return jsonResponse({ id: 'broadcast-2', snippet: { title: 'Launch stream', description: 'Product launch', scheduledStartTime: '2026-10-20T14:00:00Z' }, status: { lifeCycleStatus: 'ready', privacyStatus: 'private' } });
      if (url.includes('/liveBroadcasts?')) return jsonResponse({ items: [{ id: 'broadcast-1', snippet: { title: 'Town Hall', scheduledStartTime: '2026-10-20T14:00:00Z' }, status: { lifeCycleStatus: 'ready', privacyStatus: 'unlisted' } }] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { directory, service } = await createService(fetcher);
    await storeAuth(directory);

    await expect(service.listBroadcasts()).resolves.toMatchObject([{ id: 'broadcast-1', title: 'Town Hall', status: 'ready' }]);
    const created = await service.createBroadcast({
      title: 'Launch stream',
      description: 'Product launch',
      privacy: 'private',
      broadcastId: '',
      scheduledStartTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    expect(calls[0]?.url).toContain('broadcastStatus=upcoming');
    expect(calls[0]?.url).toContain('mine=true');
    expect(calls[1]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ snippet: { title: 'Launch stream', description: 'Product launch' }, status: { privacyStatus: 'private' }, contentDetails: { enableAutoStop: true } });
    expect(created).toMatchObject({ id: 'broadcast-2', title: 'Launch stream' });
    await expect(service.createBroadcast({ title: '', description: '', privacy: 'unlisted', broadcastId: '', scheduledStartTime: '' })).rejects.toThrow('broadcast title');
    expect(calls).toHaveLength(2);
  });

  it('refreshes an expired access token before making the YouTube request', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') return jsonResponse({ access_token: 'refreshed-access', expires_in: 3600 });
      if (url.includes('/liveBroadcasts?') && new Headers(init?.headers).get('authorization') === 'Bearer expired-access') return jsonResponse({ error: { message: 'expired' } }, 401);
      if (url.includes('/liveBroadcasts?') && new Headers(init?.headers).get('authorization') === 'Bearer refreshed-access') return jsonResponse({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { directory, service } = await createService(fetcher);
    await storeAuth(directory, { accessToken: 'expired-access', refreshToken: 'refresh-token', expiresAt: Date.now() - 1_000 });

    await expect(service.listBroadcasts()).resolves.toEqual([]);

    const listCalls = calls.filter((call) => call.url.includes('/liveBroadcasts?'));
    expect(listCalls).toHaveLength(1);
    expect(new Headers(listCalls[0]?.init?.headers).get('authorization')).toBe('Bearer refreshed-access');
    const refreshed = JSON.parse(secureStorage.decryptString(Buffer.from(JSON.parse(await readFile(path.join(directory, 'youtube-auth.json'), 'utf8')).encrypted, 'base64')));
    expect(refreshed.tokens).toMatchObject({ accessToken: 'refreshed-access', refreshToken: 'refresh-token' });
  });

  it('refreshes and retries once when YouTube rejects an access token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') return jsonResponse({ access_token: 'refreshed-access', expires_in: 3600 });
      if (url.includes('/liveBroadcasts?') && new Headers(init?.headers).get('authorization') === 'Bearer access-token') return jsonResponse({ error: { message: 'expired' } }, 401);
      if (url.includes('/liveBroadcasts?') && new Headers(init?.headers).get('authorization') === 'Bearer refreshed-access') return jsonResponse({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { directory, service } = await createService(fetcher);
    await storeAuth(directory);

    await expect(service.listBroadcasts()).resolves.toEqual([]);

    expect(calls.filter((call) => call.url.includes('/liveBroadcasts?'))).toHaveLength(2);
    expect(calls.filter((call) => call.url === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
  });

  it('creates and binds an RTMPS stream, waits for ingest, then transitions the selected broadcast live', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let broadcastState = 'ready';
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/liveBroadcasts?') && url.includes('part=id%2Cstatus')) {
        if (broadcastState === 'liveStarting') broadcastState = 'live';
        return jsonResponse({ items: [{ id: 'broadcast-1', status: { lifeCycleStatus: broadcastState } }] });
      }
      if (url.includes('/liveBroadcasts?')) return jsonResponse({ items: [{ id: 'broadcast-1', snippet: { title: 'Town Hall', scheduledStartTime: new Date(Date.now() - 1000).toISOString() }, status: { lifeCycleStatus: 'ready' } }] });
      if (url.includes('/liveStreams?') && init?.method === 'POST') return jsonResponse({ id: 'stream-1', cdn: { ingestionInfo: { rtmpsIngestionAddress: 'rtmps://a.rtmps.youtube.com:443/live2', streamName: 'secret-stream-key' } } });
      if (url.includes('/liveBroadcasts/bind?')) return jsonResponse({ id: 'broadcast-1' });
      if (url.includes('/liveStreams?') && url.includes('part=id%2Ccdn%2Cstatus')) return jsonResponse({ items: [{ id: 'stream-1', status: { streamStatus: 'inactive' }, cdn: { ingestionInfo: { rtmpsIngestionAddress: 'rtmps://a.rtmps.youtube.com:443/live2', streamName: 'secret-stream-key' } } }] });
      if (url.includes('/liveStreams?') && url.includes('part=id%2Cstatus')) return jsonResponse({ items: [{ id: 'stream-1', status: { streamStatus: 'active' } }] });
      if (url.includes('/liveBroadcasts/transition?')) {
        broadcastState = url.includes('broadcastStatus=complete') ? 'complete' : 'liveStarting';
        return jsonResponse({ id: 'broadcast-1', status: { lifeCycleStatus: broadcastState } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { directory, output, service } = await createService(fetcher);
    await storeAuth(directory);

    await expect(service.startBroadcast('broadcast-1', outputSettings)).resolves.toBe('output-session');
    await vi.waitFor(() => expect(output.reportStatus).toHaveBeenCalledWith('output-session', { state: 'live' }), { timeout: 3000 });

    expect(output.start).toHaveBeenCalledWith('rtmps://a.rtmps.youtube.com:443/live2/secret-stream-key', outputSettings, 'youtube', 'external');
    expect(calls.some((call) => call.url.includes('/liveBroadcasts/bind?'))).toBe(true);
    expect(calls.some((call) => call.url.includes('/liveBroadcasts/transition?') && call.url.includes('broadcastStatus=live'))).toBe(true);
    await service.stopStreaming('output-session');
    expect(output.stop).toHaveBeenCalledWith('output-session');
    await vi.waitFor(() => expect(calls.some((call) => call.url.includes('broadcastStatus=complete'))).toBe(true), { timeout: 3000 });
  });

  it('rejects non-YouTube RTMPS ingest destinations before starting an output', async () => {
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/liveBroadcasts?')) return jsonResponse({ items: [{ id: 'broadcast-1', status: { lifeCycleStatus: 'ready' }, contentDetails: { boundStreamId: 'stream-1' } }] });
      if (url.includes('/liveStreams?')) return jsonResponse({ items: [{ id: 'stream-1', cdn: { ingestionInfo: { rtmpsIngestionAddress: 'rtmps://attacker.example:443/live2', streamName: 'secret-key' } } }] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { directory, output, service } = await createService(fetcher);
    await storeAuth(directory);

    await expect(service.startBroadcast('broadcast-1', outputSettings)).rejects.toThrow('unsupported RTMPS');
    expect(output.start).not.toHaveBeenCalled();
  });
});
