// @vitest-environment node
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderPool } from '../../../../packages/photo-imaging/src/pool';
import { neutralRecipe } from '../../../../packages/photo-model/src/model';

describe('RenderPool', () => {
  it('workers return decodable buffers under concurrent load and reject after shutdown', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-pool-'));
    const file = path.join(dir, 'p.png');
    await sharp({
      create: { width: 16, height: 8, channels: 3, background: 'blue' },
    })
      .png()
      .toFile(file);
    const pool = new RenderPool();
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          pool.render(file, neutralRecipe(), { format: 'png' }),
        ),
      );
      for (const result of results) {
        expect(Buffer.isBuffer(result)).toBe(true);
        expect((await sharp(result).metadata()).width).toBe(16);
      }
    } finally {
      await pool.close();
    }
    await expect(pool.render(file, neutralRecipe())).rejects.toThrow(/closed/);
  });
});

type SpawnedWorker = {
  entry: URL | string;
  execArgv: string[];
  terminated: boolean;
};

/**
 * Loads a fresh copy of the pool module with `existsSync` and `Worker` stubbed,
 * so the entry-selection and loader decisions can be asserted without spawning
 * a real thread. `present` decides which worker files exist next to the module.
 */
async function loadPool(
  present: (candidate: string) => boolean,
): Promise<{
  RenderPool: typeof RenderPool;
  spawned: SpawnedWorker[];
}> {
  const spawned: SpawnedWorker[] = [];
  class FakeWorker {
    private readonly record: SpawnedWorker;
    constructor(entry: URL | string, options?: { execArgv?: string[] }) {
      this.record = { entry, execArgv: options?.execArgv ?? [], terminated: false };
      spawned.push(this.record);
    }
    on() {
      return this;
    }
    postMessage() {}
    async terminate() {
      this.record.terminated = true;
      return 0;
    }
  }
  vi.resetModules();
  vi.doMock('node:fs', () => ({
    existsSync: (candidate: string) => present(String(candidate)),
  }));
  vi.doMock('node:worker_threads', () => ({ Worker: FakeWorker }));
  const module = await import('../../../../packages/photo-imaging/src/pool');
  return { RenderPool: module.RenderPool, spawned };
}

const isCompiledWorker = (candidate: string) => candidate.endsWith('worker.js');
const isSourceWorker = (candidate: string) => candidate.endsWith('worker.ts');
const nothingExists = () => false;

const entryPath = (entry: URL | string) =>
  typeof entry === 'string' ? entry : entry.pathname;

describe('RenderPool worker entry selection', () => {
  afterEach(() => {
    vi.doUnmock('node:fs');
    vi.doUnmock('node:worker_threads');
    vi.resetModules();
  });

  it('uses the compiled worker with no source loader when worker.js exists', async () => {
    const { RenderPool: Pool, spawned } = await loadPool(isCompiledWorker);
    const pool = new Pool(1);
    await pool.close();

    expect(spawned).toHaveLength(1);
    expect(entryPath(spawned[0]!.entry)).toMatch(/worker\.js$/);
    expect(spawned[0]!.execArgv).toEqual([]);
  });

  it('falls back to the package source worker through tsx when only worker.ts exists', async () => {
    const { RenderPool: Pool, spawned } = await loadPool(isSourceWorker);
    const pool = new Pool(1);
    await pool.close();

    expect(entryPath(spawned[0]!.entry)).toMatch(/worker\.ts$/);
    expect(spawned[0]!.execArgv).toEqual(['--import', 'tsx']);
  });

  it('fails at construction with an actionable error when a bundle carries no worker', async () => {
    // A bundled build has neither worker.js nor worker.ts beside the module, so
    // silently falling back to a missing source file would surface later as an
    // opaque worker exit per render.
    const { RenderPool: Pool, spawned } = await loadPool(nothingExists);

    expect(() => new Pool(1)).toThrow(/Image worker not found/);
    expect(() => new Pool(1)).toThrow(/renderWorkerEntry/);
    expect(spawned).toEqual([]);
  });

  it('loads an explicit .ts entry through tsx, exactly like the default source path', async () => {
    const { RenderPool: Pool, spawned } = await loadPool(nothingExists);
    const entry = path.join(tmpdir(), 'explicit-worker.ts');
    const pool = new Pool(1, entry);
    await pool.close();

    expect(spawned[0]!.entry).toBe(entry);
    expect(spawned[0]!.execArgv).toEqual(['--import', 'tsx']);
  });

  it('runs an explicit emitted .js entry with no source loader', async () => {
    const { RenderPool: Pool, spawned } = await loadPool(nothingExists);
    const entry = path.join(tmpdir(), 'imaging', 'render-worker.js');
    const pool = new Pool(1, entry);
    await pool.close();

    expect(spawned[0]!.entry).toBe(entry);
    expect(spawned[0]!.execArgv).toEqual([]);
  });

  it('accepts an explicit entry as a URL as well as a path string', async () => {
    const { RenderPool: Pool, spawned } = await loadPool(nothingExists);
    const entry = pathToFileURL(
      path.join(tmpdir(), 'imaging', 'render-worker.js'),
    );
    const pool = new Pool(1, entry);
    await pool.close();

    expect(entryPath(spawned[0]!.entry)).toMatch(/render-worker\.js$/);
    expect(spawned[0]!.execArgv).toEqual([]);
  });

  it('caps concurrency and terminates every worker on close', async () => {
    const { RenderPool: Pool, spawned } = await loadPool(isSourceWorker);
    const pool = new Pool(3);
    await pool.close();

    expect(spawned).toHaveLength(2);
    for (const worker of spawned) expect(worker.terminated).toBe(true);
  });
});
