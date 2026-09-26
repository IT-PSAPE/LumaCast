import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppRelease, InstalledApp, UpdateMetadata } from '@lumacast/suite';
import { OperationQueue, type OperationQueueDeps } from '../../../../apps/cloud/main/suite/operations';
import { PermissionError } from '../../../../apps/cloud/main/suite/permissions';
import type { PlatformAdapter, InstallRequest, UninstallRequest } from '../../../../apps/cloud/main/platform/adapter';
import type { OperationSnapshot, OperationStatus } from '../../../../apps/cloud/shared/desktop-api';

function sha512Base64(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('base64');
}

interface Installable {
  release: AppRelease;
  metadata: UpdateMetadata;
  url: string;
  payload: Buffer;
}

function buildInstallable(version: string, payload: Buffer): Installable {
  const fileName = `LumaCast-${version}-arm64-mac.zip`;
  const sha512 = sha512Base64(payload);
  const size = payload.length;
  const url = `https://example.com/${version}/${fileName}`;
  const release: AppRelease = {
    app: 'cast',
    version,
    tag: `cast-v${version}`,
    legacy: false,
    publishedAt: null,
    notesUrl: `https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v${version}`,
    assets: [
      { name: 'latest-mac.yml', browser_download_url: `https://example.com/${version}/latest-mac.yml`, size: 1 },
      { name: fileName, browser_download_url: url, size },
    ],
  };
  const metadata: UpdateMetadata = {
    version,
    files: [{ url: fileName, sha512, size }],
    path: fileName,
    sha512,
    releaseDate: null,
  };
  return { release, metadata, url, payload };
}

function chunkedBody(buffer: Buffer, chunkSize: number, delayMs = 0): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        yield buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
      }
    },
  };
}

function fakeFetch(installables: Installable[], opts?: { chunkDelayMs?: number }): typeof globalThis.fetch {
  return (async (input: unknown) => {
    const url = String(input);
    const found = installables.find((i) => i.url === url);
    if (!found) throw new Error(`unexpected fetch url: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      body: chunkedBody(found.payload, 16, opts?.chunkDelayMs ?? 0),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}

function fakeCatalog(installables: Installable[]) {
  return {
    releasesFor: () => installables.map((i) => i.release),
    metadataFor: async (release: AppRelease) => {
      const found = installables.find((i) => i.release.version === release.version);
      if (!found) throw new Error(`no metadata for ${release.version}`);
      return found.metadata;
    },
  };
}

interface AdapterHooks {
  install?: (request: InstallRequest) => Promise<InstalledApp>;
  uninstall?: (request: UninstallRequest) => Promise<void>;
}

function fakeAdapter(hooks: AdapterHooks = {}): PlatformAdapter {
  return {
    platform: 'darwin',
    installLocations: () => ({ user: '/Users/test/Applications', system: '/Applications' }),
    systemScopeWritable: async () => true,
    discover: async () => null,
    install:
      hooks.install ??
      (async (request) => ({ app: request.app.id, version: '0.0.0', location: '/Applications/LumaCast.app', scope: 'user' })),
    uninstall: hooks.uninstall ?? (async () => {}),
    launch: async () => {},
    revealPath: (installed) => installed.location,
  };
}

/**
 * Collects every 'change' event from the moment it is created, so a status
 * transition that happens synchronously inside `enqueueInstall`/
 * `enqueueUninstall` (before the caller can attach its own listener) is never
 * missed: `waitFor` checks what has already been recorded before waiting for
 * more.
 */
function createTracker(queue: OperationQueue) {
  const events: OperationSnapshot[] = [];
  const waiters: Array<{ predicate: (op: OperationSnapshot) => boolean; resolve: (op: OperationSnapshot) => void }> = [];
  queue.on('change', (op) => {
    events.push(op);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i]!.predicate(op)) {
        const [waiter] = waiters.splice(i, 1);
        waiter!.resolve(op);
      }
    }
  });
  return {
    events,
    statusesFor(id: string): OperationStatus[] {
      return events.filter((e) => e.id === id).map((e) => e.status);
    },
    waitFor(predicate: (op: OperationSnapshot) => boolean): Promise<OperationSnapshot> {
      const already = events.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
    waitForTerminal(id: string): Promise<OperationSnapshot> {
      return this.waitFor((op) => op.id === id && ['done', 'failed', 'cancelled'].includes(op.status));
    },
  };
}

let downloadsDir: string;

beforeEach(async () => {
  downloadsDir = await mkdtemp(path.join(tmpdir(), 'lumacloud-operations-'));
});

afterEach(async () => {
  await rm(downloadsDir, { recursive: true, force: true });
});

function baseDeps(overrides: Partial<OperationQueueDeps> = {}): OperationQueueDeps {
  return {
    catalog: fakeCatalog([]),
    adapter: fakeAdapter(),
    settings: { get: () => ({ installScope: 'user', checkOnLaunch: true, grants: [] }) },
    discover: async () => null,
    platform: 'darwin',
    arch: 'arm64',
    downloadsDir,
    idFactory: (() => {
      let n = 0;
      return () => `op-${(n += 1)}`;
    })(),
    ...overrides,
  };
}

describe('apps/cloud OperationQueue install', () => {
  it('runs the full status sequence and reports kind "install" for a fresh install', async () => {
    const installable = buildInstallable('1.1.0', Buffer.from('cast-installer-bytes'.repeat(20)));
    const queue = new OperationQueue(
      baseDeps({
        catalog: fakeCatalog([installable]),
        fetch: fakeFetch([installable]),
        discover: async () => null,
      }),
    );
    const tracker = createTracker(queue);

    const queued = await queue.enqueueInstall({ app: 'cast' });
    expect(queued.kind).toBe('install');
    expect(queued.version).toBe('1.1.0');

    const finished = await tracker.waitForTerminal(queued.id);
    expect(finished.status).toBe('done');
    expect(tracker.statusesFor(queued.id)).toEqual([
      'queued',
      'downloading',
      'verifying',
      'installing',
      'done',
    ]);

    // The downloaded artifact is deleted after a successful install.
    const files = await readdir(path.join(downloadsDir, 'cast')).catch(() => []);
    expect(files).toEqual([]);
  });

  it('decides "update" when the requested/latest version is newer than what is installed', async () => {
    const v100 = buildInstallable('1.0.0', Buffer.from('a'.repeat(64)));
    const v110 = buildInstallable('1.1.0', Buffer.from('b'.repeat(64)));
    const installed: InstalledApp = { app: 'cast', version: '1.0.0', location: '/x', scope: 'user' };
    const queue = new OperationQueue(
      baseDeps({
        catalog: fakeCatalog([v110, v100]),
        fetch: fakeFetch([v110, v100]),
        discover: async () => installed,
      }),
    );
    const snapshot = await queue.enqueueInstall({ app: 'cast' });
    expect(snapshot.kind).toBe('update');
    expect(snapshot.version).toBe('1.1.0');
  });

  it('decides "downgrade" when an older version is explicitly requested', async () => {
    const v100 = buildInstallable('1.0.0', Buffer.from('a'.repeat(64)));
    const v110 = buildInstallable('1.1.0', Buffer.from('b'.repeat(64)));
    const installed: InstalledApp = { app: 'cast', version: '1.1.0', location: '/x', scope: 'user' };
    const queue = new OperationQueue(
      baseDeps({
        catalog: fakeCatalog([v110, v100]),
        fetch: fakeFetch([v110, v100]),
        discover: async () => installed,
      }),
    );
    const snapshot = await queue.enqueueInstall({ app: 'cast', version: '1.0.0' });
    expect(snapshot.kind).toBe('downgrade');
  });

  it('decides "install" (reinstall) when the requested version equals what is installed', async () => {
    const v100 = buildInstallable('1.0.0', Buffer.from('a'.repeat(64)));
    const installed: InstalledApp = { app: 'cast', version: '1.0.0', location: '/x', scope: 'user' };
    const queue = new OperationQueue(
      baseDeps({
        catalog: fakeCatalog([v100]),
        fetch: fakeFetch([v100]),
        discover: async () => installed,
      }),
    );
    const snapshot = await queue.enqueueInstall({ app: 'cast', version: '1.0.0' });
    expect(snapshot.kind).toBe('install');
  });

  it('throws when the requested version is not in the catalog', async () => {
    const v100 = buildInstallable('1.0.0', Buffer.from('a'.repeat(32)));
    const queue = new OperationQueue(baseDeps({ catalog: fakeCatalog([v100]) }));
    await expect(queue.enqueueInstall({ app: 'cast', version: '9.9.9' })).rejects.toThrow(/not in the release catalog/);
    expect(queue.operations()).toEqual([]);
  });

  it('throws when the catalog has not loaded yet', async () => {
    const queue = new OperationQueue(baseDeps({ catalog: { releasesFor: () => null, metadataFor: async () => { throw new Error('unused'); } } }));
    await expect(queue.enqueueInstall({ app: 'cast' })).rejects.toThrow(/has not loaded/);
  });

  it('refuses to install Cloud itself', async () => {
    const queue = new OperationQueue(baseDeps());
    await expect(queue.enqueueInstall({ app: 'cloud' })).rejects.toBeInstanceOf(PermissionError);
    expect(queue.operations()).toEqual([]);
  });

  it('surfaces an adapter install failure as a failed operation, keeping the downloaded artifact', async () => {
    const installable = buildInstallable('1.0.0', Buffer.from('c'.repeat(64)));
    const queue = new OperationQueue(
      baseDeps({
        catalog: fakeCatalog([installable]),
        fetch: fakeFetch([installable]),
        adapter: fakeAdapter({
          install: async () => {
            throw new Error('disk full');
          },
        }),
      }),
    );
    const tracker = createTracker(queue);
    const queued = await queue.enqueueInstall({ app: 'cast' });
    const finished = await tracker.waitForTerminal(queued.id);

    expect(finished.status).toBe('failed');
    expect(finished.error).toBe('disk full');

    const files = await readdir(path.join(downloadsDir, 'cast'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('cancels a downloading operation and never reaches adapter.install', async () => {
    const installable = buildInstallable('1.0.0', Buffer.from('d'.repeat(4000)));
    let installCalled = false;
    const queue = new OperationQueue(
      baseDeps({
        catalog: fakeCatalog([installable]),
        fetch: fakeFetch([installable], { chunkDelayMs: 5 }),
        adapter: fakeAdapter({
          install: async (request) => {
            installCalled = true;
            return { app: request.app.id, version: '1.0.0', location: '/x', scope: 'user' };
          },
        }),
      }),
    );
    const tracker = createTracker(queue);
    const queued = await queue.enqueueInstall({ app: 'cast' });
    await tracker.waitFor((op) => op.id === queued.id && op.status === 'downloading');

    await queue.cancel(queued.id);

    const finished = tracker.events.filter((e) => e.id === queued.id).at(-1)!;
    expect(finished.status).toBe('cancelled');
    expect(installCalled).toBe(false);
  });

  it('cancels a queued (not yet started) operation immediately', async () => {
    const first = buildInstallable('1.0.0', Buffer.from('e'.repeat(4000)));
    const queue = new OperationQueue(
      baseDeps({
        catalog: fakeCatalog([first]),
        fetch: fakeFetch([first], { chunkDelayMs: 5 }),
      }),
    );
    const tracker = createTracker(queue);

    // Starts running immediately (becomes the active operation).
    const running = await queue.enqueueInstall({ app: 'cast' });
    // Queued behind it; cancel before it ever starts.
    const queuedOnly = await queue.enqueueInstall({ app: 'cast' });
    expect(queuedOnly.status).toBe('queued');

    await queue.cancel(queuedOnly.id);
    expect(tracker.statusesFor(queuedOnly.id)).toEqual(['queued', 'cancelled']);

    await queue.cancel(running.id).catch(() => {});
  });

  it('rejects cancelling an operation that is already installing', async () => {
    const installable = buildInstallable('1.0.0', Buffer.from('g'.repeat(32)));
    let releaseInstall: (() => void) | undefined;
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    const queue = new OperationQueue(
      baseDeps({
        catalog: fakeCatalog([installable]),
        fetch: fakeFetch([installable]),
        adapter: fakeAdapter({
          install: async (request) => {
            await installGate;
            return { app: request.app.id, version: '1.0.0', location: '/x', scope: 'user' };
          },
        }),
      }),
    );
    const tracker = createTracker(queue);
    const queued = await queue.enqueueInstall({ app: 'cast' });
    await tracker.waitFor((op) => op.id === queued.id && op.status === 'installing');

    await expect(queue.cancel(queued.id)).rejects.toThrow(/cannot be cancelled/);

    releaseInstall!();
    await tracker.waitForTerminal(queued.id);
  });

  it('rejects cancelling an unknown operation id', async () => {
    const queue = new OperationQueue(baseDeps());
    await expect(queue.cancel('does-not-exist')).rejects.toThrow(/Unknown operation/);
  });
});

describe('apps/cloud OperationQueue uninstall', () => {
  it('runs removing -> done and reports the installed version', async () => {
    const installed: InstalledApp = { app: 'cast', version: '1.0.0', location: '/Applications/LumaCast.app', scope: 'user' };
    const queue = new OperationQueue(baseDeps({ discover: async () => installed }));
    const tracker = createTracker(queue);

    const queued = await queue.enqueueUninstall({ app: 'cast' });
    expect(queued.kind).toBe('uninstall');
    expect(queued.version).toBe('1.0.0');

    const finished = await tracker.waitForTerminal(queued.id);
    expect(finished.status).toBe('done');
    expect(tracker.statusesFor(queued.id)).toEqual(['queued', 'removing', 'done']);
  });

  it('fails when the app is not installed', async () => {
    const queue = new OperationQueue(baseDeps({ discover: async () => null }));
    await expect(queue.enqueueUninstall({ app: 'cast' })).rejects.toThrow(/not installed/);
  });

  it('surfaces an adapter uninstall failure', async () => {
    const installed: InstalledApp = { app: 'cast', version: '1.0.0', location: '/x', scope: 'user' };
    const queue = new OperationQueue(
      baseDeps({
        discover: async () => installed,
        adapter: fakeAdapter({
          uninstall: async () => {
            throw new Error('permission denied');
          },
        }),
      }),
    );
    const tracker = createTracker(queue);
    const queued = await queue.enqueueUninstall({ app: 'cast' });
    const finished = await tracker.waitForTerminal(queued.id);
    expect(finished.status).toBe('failed');
    expect(finished.error).toBe('permission denied');
  });

  it('refuses to uninstall Cloud itself', async () => {
    const queue = new OperationQueue(baseDeps({ discover: async () => ({ app: 'cloud', version: '1.0.0', location: '/x', scope: 'unknown' }) }));
    await expect(queue.enqueueUninstall({ app: 'cloud' })).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('apps/cloud OperationQueue history', () => {
  it('keeps only the last 50 finished operations', async () => {
    const installed: InstalledApp = { app: 'cast', version: '1.0.0', location: '/x', scope: 'user' };
    const queue = new OperationQueue(baseDeps({ discover: async () => installed }));
    const tracker = createTracker(queue);

    for (let i = 0; i < 55; i += 1) {
      const queued = await queue.enqueueUninstall({ app: 'cast' });
      await tracker.waitForTerminal(queued.id);
      // Re-arm discover for the next iteration (the fake adapter's uninstall
      // is a no-op, so the app is still "installed" as far as this queue's
      // discover callback is concerned).
    }

    expect(queue.operations()).toHaveLength(50);
  });
});
