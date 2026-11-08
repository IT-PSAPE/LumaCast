// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExportManager,
  MAX_EXPORT_HISTORY_JOBS,
  MAX_EXPORT_HISTORY_PHOTOS,
  MAX_PENDING_EXPORT_JOBS,
  MAX_PENDING_EXPORT_PHOTOS,
  type Renderer,
} from '../../../../packages/photo-library/src/export';
import { PhotoService } from '../../../../packages/photo-library/src/service';
import { neutralRecipe, type ExportOptions, type Photo } from '../../../../packages/photo-model/src/model';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(render?: Renderer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumaflux-export-bounds-'));
  const service = await PhotoService.open(path.join(directory, 'catalog.json'));
  const gate = deferred();
  const started = deferred();
  const calls: string[] = [];
  const manager = new ExportManager(service, render ?? (async (file) => {
    calls.push(path.basename(file));
    started.resolve();
    await gate.promise;
    throw new Error('synthetic render failure');
  }));
  const snapshots = vi.spyOn(service, 'photosByIds').mockImplementation((ids) => ids.map((id): Photo => {
    if (id === 'missing') throw new Error('NOT_FOUND: Photo missing');
    return {
      id,
      path: path.join(directory, `${id}.png`),
      name: `${id}.png`,
      folder: directory,
      width: 1,
      height: 1,
      format: 'png',
      size: 1,
      importedAt: '2026-11-08T00:00:00.000Z',
      modifiedAt: '2026-11-08T00:00:00.000Z',
      rating: 0,
      favorite: false,
      recipe: neutralRecipe(),
      revision: 0,
      history: [],
      future: [],
    };
  }));
  const options = (ids: string[]): ExportOptions => ({ ids, directory, format: 'png', quality: 90, suffix: '-export' });
  cleanups.push(async () => {
    manager.cancelAll();
    gate.resolve();
    await manager.idle();
    await rm(directory, { recursive: true, force: true });
  });
  return { manager, service, gate, started, calls, snapshots, options };
}

const ids = (count: number) => Array.from({ length: count }, (_, i) => `photo-${i}`);

describe('ExportManager resource bounds', () => {
  it('atomically admits the exact global photo boundary and releases cancelled queued snapshots', async () => {
    const f = await fixture();
    const first = await f.manager.start(f.options(ids(MAX_PENDING_EXPORT_PHOTOS - 1)));
    await f.started.promise;
    const second = await f.manager.start(f.options(['last', 'last']));
    expect(second).toMatchObject({ status: 'queued', total: 1 });
    second.outputs.push('detached');
    expect(f.manager.get(second.id).outputs).toEqual([]);
    const before = f.service.state().jobs;
    const snapshotCalls = f.snapshots.mock.calls.length;

    await expect(f.manager.start(f.options(['overflow']))).rejects.toThrow(/QUEUE_FULL/);
    expect(f.snapshots).toHaveBeenCalledTimes(snapshotCalls);
    expect(f.service.state().jobs).toEqual(before);
    expect(f.calls).toHaveLength(1);

    const cancelled = f.manager.cancel(second.id);
    cancelled.errors.push({ id: 'detached', message: 'detached' });
    expect(f.manager.get(second.id).errors).toEqual([]);
    await expect(f.manager.start(f.options(['missing']))).rejects.toThrow(/NOT_FOUND/);
    expect(f.service.state().jobs).toHaveLength(2);
    const replacement = await f.manager.start(f.options(['replacement']));
    expect(replacement.total).toBe(1);
    f.manager.cancel(first.id);
    const beforeCancelledRefusal = f.service.state().jobs;
    await expect(f.manager.start(f.options(['still-full']))).rejects.toThrow(/QUEUE_FULL/);
    expect(f.service.state().jobs).toEqual(beforeCancelledRefusal);
    expect(f.manager.get(first.id).status).toBe('cancelled');
  });

  it('does not reserve capacity or create a job when a later photo ID is missing', async () => {
    const f = await fixture();
    await expect(f.manager.start(f.options(['valid', 'missing']))).rejects.toThrow(/NOT_FOUND/);
    expect(f.service.jobs).toEqual([]);
    const accepted = await f.manager.start(f.options(ids(MAX_PENDING_EXPORT_PHOTOS)));
    expect(accepted.total).toBe(MAX_PENDING_EXPORT_PHOTOS);
  });

  it('serializes concurrent admissions competing for the last photo slot', async () => {
    const f = await fixture();
    await f.manager.start(f.options(ids(MAX_PENDING_EXPORT_PHOTOS - 1)));
    await f.started.promise;
    const results = await Promise.allSettled([
      f.manager.start(f.options(['last-a'])),
      f.manager.start(f.options(['last-b'])),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.message).toMatch(/QUEUE_FULL/);
    expect(f.service.jobs).toHaveLength(2);
    expect(f.service.jobs.reduce((total, job) => total + job.total, 0)).toBe(MAX_PENDING_EXPORT_PHOTOS);
    expect(f.snapshots).toHaveBeenCalledTimes(2);
  });

  it('bounds small outstanding batches by job count and preserves FIFO after queued cancellation', async () => {
    const f = await fixture();
    const jobs = [];
    for (let i = 0; i < MAX_PENDING_EXPORT_JOBS; i++)
      jobs.push(await f.manager.start(f.options([`batch-${i}`])));
    const before = f.service.state().jobs;
    await expect(f.manager.start(f.options(['overflow']))).rejects.toThrow(/QUEUE_FULL/);
    expect(f.service.state().jobs).toEqual(before);
    f.manager.cancel(jobs[1]!.id);
    const replacement = await f.manager.start(f.options(['replacement']));
    expect(replacement.status).toBe('queued');
    f.gate.resolve();
    await f.manager.idle();
    expect(f.calls).toEqual(['batch-0.png', ...Array.from({ length: MAX_PENDING_EXPORT_JOBS - 2 }, (_, i) => `batch-${i + 2}.png`), 'replacement.png']);
    expect(f.manager.get(jobs[1]!.id).status).toBe('cancelled');
    expect(f.manager.get(replacement.id)).toMatchObject({ status: 'failed', done: 1 });
  });

  it('keeps idle waiting for a cancelled current render after the latest queued batch is cancelled', async () => {
    const f = await fixture();
    const first = await f.manager.start(f.options(['current']));
    await f.started.promise;
    const latest = await f.manager.start(f.options(['latest']));
    f.manager.cancel(latest.id);
    f.manager.cancel(first.id);
    let idle = false;
    const waiting = f.manager.idle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    f.gate.resolve();
    await waiting;
    expect(idle).toBe(true);
    expect(f.calls).toEqual(['current.png']);
    expect(f.manager.get(latest.id)).toMatchObject({ status: 'cancelled', done: 0, outputs: [] });
    const retried = await f.manager.start(f.options(ids(MAX_PENDING_EXPORT_PHOTOS)));
    expect(retried.total).toBe(MAX_PENDING_EXPORT_PHOTOS);
  });

  it('retains exact recent results, expires oldest IDs and preserves their exported files', async () => {
    let fail = false;
    const f = await fixture(async () => {
      if (fail) throw new Error('synthetic render failure');
      return Buffer.from('rendered');
    });
    const exported = await f.manager.start(f.options(['written']));
    await f.manager.idle();
    const output = f.manager.get(exported.id).outputs[0]!;
    fail = true;
    const jobs = [];
    const finalSnapshots: string[][] = [];
    f.service.on('change', () => {
      finalSnapshots.push(f.service.state().jobs.map((job) => job.id));
    });
    for (let i = 0; i < MAX_EXPORT_HISTORY_JOBS; i++) {
      const job = await f.manager.start(f.options([`failed-${i}`]));
      jobs.push(job);
      await f.manager.idle();
    }
    expect(f.service.jobs.map((job) => job.id)).toEqual(jobs.map((job) => job.id).reverse());
    expect(finalSnapshots.at(-1)).toEqual(f.service.jobs.map((job) => job.id));
    expect(() => f.manager.get(exported.id)).toThrow(/NOT_FOUND/);
    expect(await readFile(output, 'utf8')).toBe('rendered');
    const retained = f.manager.get(jobs[0]!.id);
    expect(retained).toMatchObject({ status: 'failed', done: 1, errors: [{ id: 'failed-0', message: 'synthetic render failure' }] });
    expect(f.manager.cancel(retained.id)).toEqual(retained);
    const detached = f.manager.get(retained.id);
    detached.errors.length = 0;
    expect(f.manager.get(retained.id).errors).toHaveLength(1);
  });

  it('bounds terminal history by total photos without truncating retained per-photo errors', async () => {
    const f = await fixture(async () => { throw new Error('synthetic render failure'); });
    const oldest = await f.manager.start(f.options(ids(6000)));
    await f.manager.idle();
    const recent = await f.manager.start(f.options(ids(4000)));
    await f.manager.idle();
    expect(f.service.jobs.reduce((total, job) => total + job.total, 0)).toBe(MAX_EXPORT_HISTORY_PHOTOS);
    expect(f.manager.get(oldest.id).errors).toHaveLength(6000);
    const newest = await f.manager.start(f.options(['newest']));
    await f.manager.idle();
    expect(f.service.jobs.map((job) => job.id)).toEqual([newest.id, recent.id]);
    expect(f.manager.get(recent.id).errors).toHaveLength(4000);
    expect(() => f.manager.get(oldest.id)).toThrow(/NOT_FOUND/);
  });

  it('applies the terminal photo budget to cancelled queued batches without holding their capacity', async () => {
    const f = await fixture();
    const active = await f.manager.start(f.options(['active']));
    await f.started.promise;
    const large = await f.manager.start(f.options(ids(MAX_EXPORT_HISTORY_PHOTOS - 1)));
    f.manager.cancel(large.id);
    const recent = await f.manager.start(f.options(['recent']));
    f.manager.cancel(recent.id);
    expect(f.service.jobs.filter((job) => job.status === 'cancelled').reduce((total, job) => total + job.total, 0)).toBe(MAX_EXPORT_HISTORY_PHOTOS);
    const newest = await f.manager.start(f.options(['newest']));
    f.manager.cancel(newest.id);
    expect(f.service.jobs.map((job) => job.id)).toEqual([newest.id, recent.id, active.id]);
    expect(() => f.manager.get(large.id)).toThrow(/NOT_FOUND/);
    expect(f.manager.get(active.id).status).toBe('running');
  });

  it('keeps physically active cancelled jobs through terminal-history churn and cleanup', async () => {
    const f = await fixture();
    const active = await f.manager.start(f.options(['active']));
    await f.started.promise;
    f.manager.cancel(active.id);
    for (let i = 0; i <= MAX_EXPORT_HISTORY_JOBS; i++) {
      const job = await f.manager.start(f.options([`cancelled-${i}`]));
      expect(f.manager.cancel(job.id).status).toBe('cancelled');
    }
    expect(f.service.jobs).toHaveLength(MAX_EXPORT_HISTORY_JOBS + 1);
    expect(f.manager.get(active.id).status).toBe('cancelled');
    expect(f.service.jobs.at(-1)?.id).toBe(active.id);
    f.gate.resolve();
    await f.manager.idle();
    expect(f.service.jobs).toHaveLength(MAX_EXPORT_HISTORY_JOBS);
    expect(() => f.manager.get(active.id)).toThrow(/NOT_FOUND/);
  });

  it('cancels every outstanding job for shutdown while older jobs are evicted from history', async () => {
    const f = await fixture();
    await f.manager.start(f.options(['current']));
    await f.started.promise;
    await f.manager.start(f.options(['old-a']));
    await f.manager.start(f.options(['old-b']));
    for (let i = 0; i <= MAX_EXPORT_HISTORY_JOBS; i++) {
      const job = await f.manager.start(f.options([`cancelled-${i}`]));
      f.manager.cancel(job.id);
    }
    expect(f.service.jobs.filter((job) => job.status === 'queued')).toHaveLength(2);
    f.manager.cancelAll();
    expect(f.service.jobs.every((job) => job.status === 'cancelled')).toBe(true);
    f.gate.resolve();
    await f.manager.idle();
    expect(f.calls).toEqual(['current.png']);
    expect(f.service.jobs).toHaveLength(MAX_EXPORT_HISTORY_JOBS);
  });

  it('keeps per-photo partial failures and output options unchanged', async () => {
    const render = vi.fn<Renderer>(async (file) => {
      if (file.endsWith('bad.png')) throw new Error('bad source');
      return Buffer.from('rendered');
    });
    const f = await fixture(render);
    const job = await f.manager.start({ ...f.options(['good', 'bad', 'other']), format: 'webp', quality: 73, maxDimension: 1200, suffix: '-copy' });
    await f.manager.idle();
    const result = f.manager.get(job.id);
    expect(result).toMatchObject({ status: 'completed', total: 3, done: 3, errors: [{ id: 'bad', message: 'bad source' }] });
    expect(result.outputs.map((output) => path.basename(output))).toEqual(['good-copy.webp', 'other-copy.webp']);
    expect(render.mock.calls.map((call) => call[2])).toEqual(Array.from({ length: 3 }, () => ({ format: 'webp', quality: 73, maxDimension: 1200 })));
  });
});
