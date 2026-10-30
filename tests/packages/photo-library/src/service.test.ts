// @vitest-environment node
import { mkdir, mkdtemp, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Commands } from '../../../../packages/photo-library/src/commands';
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

  it('returns a detached lightweight photo ID list for catalog housekeeping', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-photo-ids-'));
    const source = path.join(dir, 'image.png');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'gray' },
    })
      .png()
      .toFile(source);
    const service = await PhotoService.open(path.join(dir, 'catalog.json'));
    const { imported } = await service.importPaths([source]);

    const ids = service.photoIds();
    expect(ids).toEqual(imported);
    ids.push('not-in-catalog');
    expect(service.photoIds()).toEqual(imported);
  });

  it('catalog load validates activity, rejects duplicate photo IDs and cleans selection references', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-catalog-validation-'));
    const source = path.join(dir, 'image.png');
    const catalogPath = path.join(dir, 'catalog.json');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'gray' },
    }).png().toFile(source);
    const service = await PhotoService.open(catalogPath);
    await service.importPaths([source]);
    const id = service.state().photos[0].id;
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    catalog.selection = [id, id, 'removed-photo'];
    catalog.activity = [
      {
        id: 'activity-1',
        time: '2026-10-30T12:00:00.000Z',
        source: 'UI',
        action: 'Catalog loaded',
      },
    ];
    await writeFile(catalogPath, JSON.stringify(catalog));

    const reopened = await PhotoService.open(catalogPath);
    expect(reopened.state().selection).toEqual([id]);
    expect(reopened.state().activity).toEqual(catalog.activity);

    catalog.activity = {};
    await writeFile(catalogPath, JSON.stringify(catalog));
    await expect(PhotoService.open(catalogPath)).rejects.toThrow(/Cannot load catalog/);

    catalog.activity = [];
    catalog.photos.push(catalog.photos[0]);
    await writeFile(catalogPath, JSON.stringify(catalog));
    await expect(PhotoService.open(catalogPath)).rejects.toThrow(/Duplicate photo ID/);
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

  it('concurrent imports of the same original only add one catalog record', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-import-race-'));
    const file = path.join(dir, 'same.png');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'gray' },
    }).png().toFile(file);
    const service = await PhotoService.open(path.join(dir, 'catalog.json'));

    const results = await Promise.all([
      service.importPaths([file]),
      service.importPaths([file]),
    ]);

    expect(results.flatMap((result) => result.imported)).toHaveLength(1);
    expect(service.state().photos).toHaveLength(1);
    expect((await PhotoService.open(path.join(dir, 'catalog.json'))).state().photos).toHaveLength(1);
  });

  it('deduplicates a valid selection and leaves it unchanged when any ID is missing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-selection-validation-'));
    const files = ['one.png', 'two.png'].map((name) => path.join(dir, name));
    for (const file of files) {
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: 'gray' },
      }).png().toFile(file);
    }
    const service = await PhotoService.open(path.join(dir, 'catalog.json'));
    const imported = await service.importPaths(files);
    const [one, two] = imported.imported;

    await service.select([one, one, two]);
    expect(service.state().selection).toEqual([one, two]);
    await expect(service.select([one, 'missing'])).rejects.toThrow(/NOT_FOUND/);
    expect(service.state().selection).toEqual([one, two]);
  });

  it('serializes concurrent edits against the same expected revision', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-edit-race-'));
    const file = path.join(dir, 'p.png');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'gray' },
    }).png().toFile(file);
    const service = await PhotoService.open(path.join(dir, 'catalog.json'));
    await service.importPaths([file]);
    const id = service.state().photos[0].id;

    const results = await Promise.allSettled([
      service.edit([{ id, expectedRevision: 0, patch: { exposure: 1 } }]),
      service.edit([{ id, expectedRevision: 0, patch: { brightness: 20 } }]),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') expect(rejected.reason.message).toMatch(/CONFLICT/);
    const photo = service.photo(id);
    expect(photo.revision).toBe(1);
    expect([[1, 0], [0, 20]]).toContainEqual([
      photo.recipe.exposure,
      photo.recipe.brightness,
    ]);
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

  it('removes selected catalog records as one atomic operation while preserving original files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-remove-'));
    const sourcePaths = ['one.png', 'two.png', 'three.png'].map((name) => path.join(dir, name));
    for (const [index, source] of sourcePaths.entries()) {
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: index ? 'blue' : 'red' },
      }).png().toFile(source);
    }
    const originals = await Promise.all(sourcePaths.map((source) => readFile(source)));
    const service = await PhotoService.open(path.join(dir, 'catalog.json'));
    const commands = new Commands(service, async () => Buffer.from('rendered'));
    const imported = await service.importPaths(sourcePaths);
    await service.select(imported.imported);

    await expect(commands.run('remove_photos_from_library', { ids: [imported.imported[0], 'missing'] }))
      .rejects.toThrow(/NOT_FOUND/);
    expect(service.state().photos).toHaveLength(3);

    await expect(commands.run('remove_photos_from_library', { ids: [imported.imported[0], imported.imported[1]] }))
      .resolves.toEqual([imported.imported[0], imported.imported[1]]);

    expect(service.state().photos.map((photo) => photo.id)).toEqual([imported.imported[2]]);
    expect(service.state().selection).toEqual([imported.imported[2]]);
    expect(() => service.photo(imported.imported[0])).toThrow(/NOT_FOUND/);
    expect(await Promise.all(sourcePaths.map((source) => readFile(source)))).toEqual(originals);

    const reopened = await PhotoService.open(path.join(dir, 'catalog.json'));
    expect(reopened.state().photos.map((photo) => photo.id)).toEqual([imported.imported[2]]);
    expect(reopened.state().selection).toEqual([imported.imported[2]]);
  });

  it('relink refreshes source modification time and keeps undo history bounded', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-relink-history-'));
    const original = path.join(dir, 'original.png');
    const replacement = path.join(dir, 'replacement.png');
    const mtime = new Date('2020-01-02T03:04:05.000Z');
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'red' },
    }).png().toFile(original);
    await sharp({
      create: { width: 10, height: 6, channels: 3, background: 'blue' },
    }).png().toFile(replacement);
    await utimes(replacement, mtime, mtime);
    const expectedMtime = (await stat(replacement)).mtime.toISOString();
    const catalogPath = path.join(dir, 'catalog.json');
    const service = await PhotoService.open(catalogPath);
    await service.importPaths([original]);
    const id = service.state().photos[0].id;
    await service.edit([
      {
        id,
        expectedRevision: 0,
        patch: { exposure: 0.5, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
      },
    ]);
    const persisted = JSON.parse(await readFile(catalogPath, 'utf8'));
    const priorRecipe = service.photo(id).recipe;
    persisted.photos[0].history = Array.from({ length: 100 }, () => priorRecipe);
    await writeFile(catalogPath, JSON.stringify(persisted));
    const boundaryService = await PhotoService.open(catalogPath);
    await boundaryService.relink(id, replacement);

    const photo = boundaryService.photo(id);
    expect(photo.path).toBe(replacement);
    expect(photo.modifiedAt).toBe(expectedMtime);
    expect(photo.recipe.crop).toBeNull();
    expect(photo.recipe.exposure).toBe(0.5);
    expect(photo.revision).toBe(2);
    expect(photo.history).toHaveLength(100);

    const reopened = await PhotoService.open(catalogPath);
    expect(reopened.photo(id).modifiedAt).toBe(expectedMtime);
    expect(reopened.photo(id).history).toHaveLength(100);
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
