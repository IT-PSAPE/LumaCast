// @vitest-environment node
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Commands } from '../../../../packages/photo-library/src/commands';
import { ExportManager, exportSchema } from '../../../../packages/photo-library/src/export';
import { PhotoService } from '../../../../packages/photo-library/src/service';
import { MAX_PHOTO_BATCH_SIZE, neutralRecipe } from '../../../../packages/photo-model/src/model';

describe('large photo batches', () => {
  it('atomically edits and exports 1000 photos, rolls back a missing target, and rejects 10001', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-large-batch-'));
    const catalogPath = path.join(dir, 'catalog.json');
    const sourcePath = path.join(dir, 'source.png');
    const exportDirectory = path.join(dir, 'exports');
    await mkdir(exportDirectory);
    await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'gray' },
    })
      .png()
      .toFile(sourcePath);

    const sourceStat = await stat(sourcePath);
    const recipe = neutralRecipe();
    const timestamp = new Date().toISOString();
    const photos = Array.from({ length: 1000 }, (_, index) => ({
      id: `photo-${index}`,
      path: sourcePath,
      name: `photo-${index}.png`,
      folder: dir,
      width: 2,
      height: 2,
      format: 'png',
      size: sourceStat.size,
      importedAt: timestamp,
      modifiedAt: sourceStat.mtime.toISOString(),
      rating: 0,
      favorite: false,
      recipe,
      revision: 0,
      history: [],
      future: [],
    }));
    await writeFile(
      catalogPath,
      JSON.stringify({ version: 1, photos, selection: [], activity: [] }),
    );
    const service = await PhotoService.open(catalogPath);
    const commands = new Commands(service, async () => Buffer.from('rendered'));
    const ids = photos.map((photo) => photo.id);
    let changes = 0;
    service.on('change', () => changes++);

    const edits = ids.map((id) => ({
      id,
      expectedRevision: 0,
      patch: { exposure: 0.25 },
    }));
    const editResult = await commands.run('apply_batch_edits', { edits });
    expect(editResult).toHaveLength(1000);
    expect(service.photo(ids[999]!).revision).toBe(1);
    expect(service.photo(ids[999]!).recipe.exposure).toBe(0.25);
    expect(changes).toBe(1);

    const savedBeforeFailure = await readFile(catalogPath);
    const invalidBatch = ids.map((id) => ({
      id,
      expectedRevision: 1,
      patch: { exposure: 1 },
    }));
    invalidBatch[999]!.id = 'missing-photo';
    await expect(commands.run('apply_batch_edits', { edits: invalidBatch })).rejects.toThrow(/NOT_FOUND/);
    expect(service.photo(ids[0]!).recipe.exposure).toBe(0.25);
    expect(service.photo(ids[999]!).revision).toBe(1);
    expect(changes).toBe(1);
    expect(await readFile(catalogPath)).toEqual(savedBeforeFailure);

    let renderCount = 0;
    let wrongRecipe = false;
    const exports = new ExportManager(service, async (_file, exportRecipe) => {
      renderCount++;
      if (exportRecipe.exposure !== 0.25) wrongRecipe = true;
      return Buffer.from('rendered');
    });
    const job = await exports.start({
      ids,
      directory: exportDirectory,
      format: 'png',
      quality: 90,
      suffix: '-large-batch',
    });
    await exports.idle();
    expect(exports.get(job.id).status).toBe('completed');
    expect(exports.get(job.id).outputs).toHaveLength(1000);
    expect(renderCount).toBe(1000);
    expect(wrongRecipe).toBe(false);

    const tooManyIds = Array.from(
      { length: MAX_PHOTO_BATCH_SIZE + 1 },
      (_, index) => `too-many-${index}`,
    );
    expect(() =>
      exportSchema.parse({
        ids: tooManyIds,
        directory: exportDirectory,
        format: 'png',
        quality: 90,
        suffix: '',
      }),
    ).toThrow();
    await expect(
      commands.run('update_photos_metadata', { ids: tooManyIds, rating: 1 }),
    ).rejects.toThrow();
    await expect(
      commands.run('apply_batch_edits', {
        edits: tooManyIds.map((id) => ({
          id,
          expectedRevision: 0,
          patch: { exposure: 0.5 },
        })),
      }),
    ).rejects.toThrow();
  }, 15_000);
});
