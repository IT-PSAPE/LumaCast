// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZoomLiveService, createZoomPkce } from '../../../../apps/stream/main/zoom-live';

const temporaryDirectories: string[] = [];
const tokens = { accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 60 * 60 * 1000 };
const account = { userId: 'zoom-user-1', displayName: 'Test Zoom User', email: 'user@example.com' };
const secureStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, 'utf8')),
  decryptString: vi.fn((value: Buffer) => {
    const text = value.toString('utf8');
    if (!text.startsWith('encrypted:')) throw new Error('Unable to decrypt.');
    return text.slice('encrypted:'.length);
  }),
};

afterEach(async () => {
  secureStorage.isEncryptionAvailable.mockReturnValue(true);
  secureStorage.encryptString.mockClear();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createService(fetcher: typeof fetch, openExternal: (rawUrl: string) => Promise<void> = vi.fn(async () => undefined)) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-zoom-live-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    openExternal,
    service: new ZoomLiveService(directory, 'zoom-public-client-id', openExternal, fetcher, secureStorage),
  };
}

async function storeAuth(directory: string, authTokens = tokens): Promise<void> {
  const value = { tokens: authTokens, account };
  const encrypted = secureStorage.encryptString(JSON.stringify(value)).toString('base64');
  await writeFile(path.join(directory, 'zoom-auth.json'), JSON.stringify({ version: 1, encrypted }), 'utf8');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Zoom Meeting integration', () => {
  it('creates an S256 PKCE challenge from a high-entropy verifier', () => {
    const { verifier, challenge } = createZoomPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier, 'ascii').digest('base64url'));
  });

  it('connects with state-checked loopback PKCE and stores refresh credentials encrypted', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === 'https://zoom.us/oauth/token') return jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
      if (url === 'https://api.zoom.us/v2/users/me') return jsonResponse({ id: account.userId, display_name: account.displayName, email: account.email });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    // Assigned inside the openExternal callback; a holder keeps TypeScript from narrowing a bare `let` to null.
    const captured: { authorizationUrl?: URL } = {};
    const openExternal = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      captured.authorizationUrl = url;
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({ code: 'authorization-code', state: url.searchParams.get('state')! }).toString();
      expect((await fetch(callback)).ok).toBe(true);
    });
    const { directory, service } = await createService(fetcher, openExternal);

    await expect(service.connect()).resolves.toEqual(account);
    const authorizationUrl = captured.authorizationUrl;

    expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl?.searchParams.get('scope')).toContain('user:read:zak');
    expect(authorizationUrl?.searchParams.get('scope')).toContain('meeting:write:meeting');
    const tokenRequest = requests.find((request) => request.url === 'https://zoom.us/oauth/token');
    const tokenBody = new URLSearchParams(String(tokenRequest?.init?.body));
    const expectedChallenge = createHash('sha256').update(tokenBody.get('code_verifier')!, 'ascii').digest('base64url');
    expect(authorizationUrl?.searchParams.get('code_challenge')).toBe(expectedChallenge);
    expect(tokenBody.get('client_id')).toBe('zoom-public-client-id');
    expect(new Headers(tokenRequest?.init?.headers).has('authorization')).toBe(false);
    expect(await readFile(path.join(directory, 'zoom-auth.json'), 'utf8')).not.toContain('new-refresh');
    await expect(service.getAccount()).resolves.toEqual(account);
  });

  it('lists scheduled meetings, creates a meeting, and fetches a ZAK with the connected OAuth token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/users/me/meetings') && init?.method === 'POST') return jsonResponse({ id: 12345678901, topic: 'Launch planning', start_time: '2026-10-20T14:00:00Z', duration: 45, status: 'waiting' });
      if (url.includes('/users/me/meetings?')) return jsonResponse({ meetings: [{ id: 12345678900, topic: 'Town hall', start_time: '2026-10-20T14:00:00Z', duration: 60, status: 'waiting' }] });
      if (url.endsWith('/users/me/token?type=zak')) return jsonResponse({ token: 'short-lived-zak' });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { directory, service } = await createService(fetcher);
    await storeAuth(directory);

    await expect(service.listMeetings()).resolves.toMatchObject([{ id: '12345678900', topic: 'Town hall', durationMinutes: 60 }]);
    const created = await service.createMeeting({ selectedMeetingId: '', topic: ' Launch planning ', startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), durationMinutes: 45 });
    await expect(service.getZak()).resolves.toBe('short-lived-zak');

    expect(calls[0]?.url).toContain('type=upcoming');
    expect(calls[0]?.url).toContain('page_size=100');
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ topic: 'Launch planning', type: 2, duration: 45 });
    expect(calls[2]?.url).toBe('https://api.zoom.us/v2/users/me/token?type=zak');
    expect(created).toMatchObject({ id: '12345678901', topic: 'Launch planning', durationMinutes: 45 });
  });

  it('refreshes expired tokens as a public PKCE client and retries Zoom API once', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === 'https://zoom.us/oauth/token') return jsonResponse({ access_token: 'refreshed-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
      if (url.includes('/users/me/meetings?') && new Headers(init?.headers).get('authorization') === 'Bearer expired-access') return jsonResponse({ code: 124, message: 'Invalid access token.' }, 401);
      if (url.includes('/users/me/meetings?') && new Headers(init?.headers).get('authorization') === 'Bearer refreshed-access') return jsonResponse({ meetings: [] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { directory, service } = await createService(fetcher);
    await storeAuth(directory, { accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: Date.now() + 60 * 60 * 1000 });

    await expect(service.listMeetings()).resolves.toEqual([]);

    const tokenCall = calls.find((call) => call.url === 'https://zoom.us/oauth/token');
    expect(new URLSearchParams(String(tokenCall?.init?.body))).toEqual(new URLSearchParams({ client_id: 'zoom-public-client-id', refresh_token: 'old-refresh', grant_type: 'refresh_token' }));
    expect(new Headers(tokenCall?.init?.headers).has('authorization')).toBe(false);
    expect(calls.filter((call) => call.url.includes('/users/me/meetings?'))).toHaveLength(2);
    const stored = JSON.parse(secureStorage.decryptString(Buffer.from(JSON.parse(await readFile(path.join(directory, 'zoom-auth.json'), 'utf8')).encrypted, 'base64')));
    expect(stored.tokens).toMatchObject({ accessToken: 'refreshed-access', refreshToken: 'rotated-refresh' });
  });

  it('rejects invalid meeting details before calling Zoom', async () => {
    const fetcher: typeof fetch = vi.fn() as typeof fetch;
    const { directory, service } = await createService(fetcher);
    await storeAuth(directory);
    await expect(service.createMeeting({ selectedMeetingId: '', topic: '   ', startTime: '', durationMinutes: 60 })).rejects.toThrow('meeting name');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('removes only this device credential on disconnect because public OAuth has no client secret for token revocation', async () => {
    const fetcher: typeof fetch = vi.fn() as typeof fetch;
    const { directory, service } = await createService(fetcher);
    await storeAuth(directory);

    await service.disconnect();

    await expect(service.getAccount()).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
