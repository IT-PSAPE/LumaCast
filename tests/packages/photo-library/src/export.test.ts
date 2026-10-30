// @vitest-environment node
import { mkdtemp, readFile, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { renderImage } from '../../../../packages/photo-imaging/src/render';
import { ExportManager } from '../../../../packages/photo-library/src/export';
import { PhotoService } from '../../../../packages/photo-library/src/service';

const gatedExportWrite = vi.hoisted(() => ({
  active: false,
  started: undefined as (() => void) | undefined,
  gate: undefined as Promise<void> | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (gatedExportWrite.active && String(args[0]).includes('.lumaflux-')) {
        gatedExportWrite.started?.();
        await gatedExportWrite.gate;
      }
      return actual.writeFile(...args);
    },
  };
});

describe('ExportManager', () => {
  it('export snapshots recipes, resizes, and never overwrites sources or existing files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-export-'));
    const source = path.join(dir, 'photo.png');
    await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#505050' },
    })
      .png()
      .toFile(source);
    const original = await readFile(source);
    const s = await PhotoService.open(path.join(dir, 'catalog.json'));
    await s.importPaths([source]);
    const p = s.state().photos[0];
    const exports = new ExportManager(s, renderImage);
    const options = {
      ids: [p.id],
      directory: dir,
      format: 'png' as const,
      quality: 90,
      maxDimension: 32,
      suffix: '',
    };
    const j = await exports.start(options);
    await exports.idle();
    const result = exports.get(j.id);
    expect(result.status).toBe('completed');
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0]).not.toBe(source);
    expect((await sharp(result.outputs[0]).metadata()).width).toBe(32);
    expect(await readFile(source)).toEqual(original);
    const j2 = await exports.start(options);
    await exports.idle();
    expect(exports.get(j2.id).outputs[0]).not.toBe(result.outputs[0]);
  });

  it('renders the recipe snapshot captured when the export job starts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-export-snapshot-'));
    const source = path.join(dir, 'photo.png');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'gray' },
    })
      .png()
      .toFile(source);
    const service = await PhotoService.open(path.join(dir, 'catalog.json'));
    await service.importPaths([source]);
    const photo = service.state().photos[0];
    let renderStarted!: () => void;
    let releaseRender!: () => void;
    const started = new Promise<void>((resolve) => {
      renderStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const exports = new ExportManager(service, async (_file, recipe) => {
      renderStarted();
      await gate;
      return Buffer.from(JSON.stringify({ exposure: recipe.exposure }));
    });
    const job = await exports.start({
      ids: [photo.id],
      directory: dir,
      format: 'png',
      quality: 90,
      suffix: '-snapshot',
    });
    await started;
    await service.edit([
      { id: photo.id, expectedRevision: 0, patch: { exposure: 1 } },
    ]);
    releaseRender();
    await exports.idle();

    expect(service.photo(photo.id).recipe.exposure).toBe(1);
    expect(
      JSON.parse(
        (await readFile(exports.get(job.id).outputs[0]!)).toString('utf8'),
      ),
    ).toEqual({ exposure: 0 });
  });

  it('queued export cancellation and missing-file failures have explicit outcomes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-cancel-'));
    const file = path.join(dir, 'photo.png');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'red' },
    })
      .png()
      .toFile(file);
    const s = await PhotoService.open(path.join(dir, 'catalog.json'));
    await s.importPaths([file]);
    const id = s.state().photos[0].id;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new ExportManager(s, async (...args) => {
      await gate;
      return renderImage(...args);
    });
    const opts = {
      ids: [id],
      directory: dir,
      format: 'png' as const,
      quality: 90,
      suffix: '-copy',
    };
    const first = await manager.start(opts);
    const second = await manager.start(opts);
    manager.cancel(second.id);
    release();
    await manager.idle();
    expect(manager.get(first.id).status).toBe('completed');
    expect(manager.get(second.id).status).toBe('cancelled');
    expect(manager.get(second.id).outputs.length).toBe(0);
    await unlink(file);
    const third = await manager.start(opts);
    await manager.idle();
    expect(manager.get(third.id).status).toBe('failed');
    expect(manager.get(third.id).errors.length).toBe(1);
  });

  it('does not publish the current photo when cancelled during its temporary write', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-cancel-write-'));
    const file = path.join(dir, 'photo.png');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'red' },
    })
      .png()
      .toFile(file);
    const service = await PhotoService.open(path.join(dir, 'catalog.json'));
    await service.importPaths([file]);

    let writeStarted!: () => void;
    let releaseWrite!: () => void;
    const writing = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    gatedExportWrite.active = true;
    gatedExportWrite.started = writeStarted;
    gatedExportWrite.gate = gate;
    const manager = new ExportManager(service, async () => Buffer.from('rendered'));

    const job = await manager.start({
      ids: [service.state().photos[0].id],
      directory: dir,
      format: 'png',
      quality: 90,
      suffix: '-cancelled',
    });
    await writing;
    manager.cancel(job.id);
    releaseWrite();
    await manager.idle();
    gatedExportWrite.active = false;
    gatedExportWrite.started = undefined;
    gatedExportWrite.gate = undefined;

    expect(manager.get(job.id).status).toBe('cancelled');
    expect(manager.get(job.id).outputs).toEqual([]);
    expect(await readdir(dir)).not.toContain('photo-cancelled.png');
    expect((await readdir(dir)).some((name) => name.startsWith('.lumaflux-'))).toBe(false);
  });
});
