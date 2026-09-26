// @vitest-environment node
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PhotoService } from '../../../../packages/photo-library/src/service';

describe('PhotoService catalog', () => {
  it('catalog preserves originals, persists edits, rejects conflicts and atomically validates batches', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-core-'));
    const source = path.join(dir, 'image.png');
    await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#786050' },
    })
      .png()
      .toFile(source);
    const before = await readFile(source);
    const service = await PhotoService.open(path.join(dir, 'catalog.json'));
    const result = await service.importPaths([source, source]);
    expect(result.imported.length).toBe(1);
    const photo = service.state().photos[0];
    await service.edit([
      { id: photo.id, expectedRevision: 0, patch: { exposure: 1 } },
    ]);
    await expect(
      service.edit([
        { id: photo.id, expectedRevision: 0, patch: { exposure: 2 } },
      ]),
    ).rejects.toThrow(/CONFLICT/);
    await expect(
      service.edit([
        { id: photo.id, expectedRevision: 1, patch: { brightness: 20 } },
        { id: 'missing', expectedRevision: 0, patch: { brightness: 20 } },
      ]),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(service.photo(photo.id).recipe.brightness).toBe(0);
    await service.history(photo.id, 1, 'undo');
    expect(service.photo(photo.id).recipe.exposure).toBe(0);
    await service.history(photo.id, 2, 'redo');
    expect(service.photo(photo.id).recipe.exposure).toBe(1);
    await service.metadata(photo.id, { rating: 5, favorite: true });
    const reopened = await PhotoService.open(path.join(dir, 'catalog.json'));
    expect(reopened.photo(photo.id).revision).toBe(3);
    expect(reopened.photo(photo.id).rating).toBe(5);
    expect(await readFile(source)).toEqual(before);
  });

  it('import reports corrupt images and scans folders without duplicate paths', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-import-'));
    await mkdir(path.join(dir, 'nested'));
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: 'red' },
    })
      .png()
      .toFile(path.join(dir, 'nested', 'ok.png'));
    await writeFile(path.join(dir, 'bad.jpg'), 'bad');
    await writeFile(path.join(dir, 'notes.txt'), 'ignored');
    const s = await PhotoService.open(path.join(dir, 'catalog.json'));
    const r = await s.importPaths([dir]);
    expect(r.imported.length).toBe(1);
    expect(r.errors.some((e) => e.path.endsWith('bad.jpg'))).toBe(true);
    expect((await s.importPaths([dir])).imported.length).toBe(0);
  });

  it('partial recipe patches never reset unrelated adjustments', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-patch-'));
    const file = path.join(dir, 'p.png');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'gray' },
    })
      .png()
      .toFile(file);
    const s = await PhotoService.open(path.join(dir, 'catalog.json'));
    await s.importPaths([file]);
    const id = s.state().photos[0].id;
    await s.edit([{ id, expectedRevision: 0, patch: { exposure: 1.5 } }]);
    await s.edit([{ id, expectedRevision: 1, patch: { rotation: 1 } }]);
    expect(s.photo(id).recipe.exposure).toBe(1.5);
    expect(s.photo(id).recipe.rotation).toBe(1);
  });

  it('failed catalog replacement leaves in-memory edits and prior catalog intact', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-save-'));
    const file = path.join(dir, 'p.png'),
      catalog = path.join(dir, 'catalog.json');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'red' },
    })
      .png()
      .toFile(file);
    const s = await PhotoService.open(catalog);
    await s.importPaths([file]);
    const p = s.state().photos[0];
    const saved = await readFile(catalog);
    await rename(catalog, `${catalog}.backup`);
    await mkdir(catalog);
    await expect(
      s.edit([{ id: p.id, expectedRevision: 0, patch: { exposure: 1 } }]),
    ).rejects.toThrow();
    expect(s.photo(p.id).revision).toBe(0);
    expect(s.photo(p.id).recipe.exposure).toBe(0);
    expect(await readFile(`${catalog}.backup`)).toEqual(saved);
  });
});
