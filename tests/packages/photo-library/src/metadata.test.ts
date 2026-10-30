// @vitest-environment node
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Commands } from '../../../../packages/photo-library/src/commands';
import { PhotoService } from '../../../../packages/photo-library/src/service';

describe('photo metadata commands', () => {
  it('updates selected metadata in one persisted event and rejects invalid batches atomically', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-metadata-batch-'));
    const files = ['one.png', 'two.png'].map((name) => path.join(dir, name));
    for (const [index, file] of files.entries()) {
      await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 3,
          background: index ? 'blue' : 'red',
        },
      })
        .png()
        .toFile(file);
    }
    const catalogPath = path.join(dir, 'catalog.json');
    const service = await PhotoService.open(catalogPath);
    const imported = await service.importPaths(files);
    const ids = imported.imported;
    const commands = new Commands(service, async () => Buffer.from('rendered'));
    let changes = 0;
    service.on('change', () => changes++);
    const before = await readFile(catalogPath);

    await expect(
      commands.run('update_photos_metadata', {
        ids: [ids[0], 'missing'],
        rating: 4,
        favorite: true,
      }),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(
      commands.run('update_photos_metadata', {
        ids: [ids[0], ids[0]],
        rating: 4,
      }),
    ).rejects.toThrow(/Duplicate photo IDs/);

    expect(changes).toBe(0);
    expect(await readFile(catalogPath)).toEqual(before);
    expect(service.state().photos.map(({ rating, favorite }) => [rating, favorite])).toEqual([
      [0, false],
      [0, false],
    ]);

    await expect(
      commands.run('update_photos_metadata', {
        ids,
        rating: 4,
        favorite: true,
      }),
    ).resolves.toEqual(ids);

    expect(changes).toBe(1);
    const updated = await PhotoService.open(catalogPath);
    expect(updated.state().photos.map(({ rating, favorite, revision, history }) => [
      rating,
      favorite,
      revision,
      history.length,
    ])).toEqual([
      [4, true, 0, 0],
      [4, true, 0, 0],
    ]);
    expect(updated.state().activity).toHaveLength(2);
  });
});
