// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RenderPool } from '../../../../packages/photo-imaging/src/pool';
import { inspectImage, renderImage } from '../../../../packages/photo-imaging/src/render';
import { neutralRecipe } from '../../../../packages/photo-model/src/model';
import { Commands } from '../../../../packages/photo-library/src/commands';
import { PhotoService } from '../../../../packages/photo-library/src/service';

// Original synthetic uncompressed Bayer DNG, with no embedded preview.
// TIFF/DNG tags describe a 16-bit RGGB sensor and an identity color matrix.
function dng(orientation = 1, width = 64, height = 48) {
  const entries: { tag: number; type: number; count: number; data: Buffer }[] =
    [];
  const add = (tag: number, type: number, values: number[] | string) => {
    const size = (
      { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 10: 4 } as Record<number, number>
    )[type];
    const data =
      typeof values === 'string'
        ? Buffer.from(values + '\0')
        : Buffer.alloc(values.length * size);
    if (typeof values !== 'string')
      values.forEach((v, i) => {
        if (size === 1) data.writeUInt8(v, i);
        else if (size === 2) data.writeUInt16LE(v, i * 2);
        else data.writeInt32LE(v, i * 4);
      });
    entries.push({
      tag,
      type,
      count: data.length / size / ([5, 10].includes(type) ? 2 : 1),
      data,
    });
  };
  add(254, 4, [0]);
  add(256, 4, [width]);
  add(257, 4, [height]);
  add(258, 3, [16]);
  add(259, 3, [1]);
  add(262, 3, [32803]);
  add(271, 2, 'Lumaflux');
  add(272, 2, 'Synthetic RAW');
  add(273, 4, [0]);
  add(274, 3, [orientation]);
  add(277, 3, [1]);
  add(278, 4, [height]);
  add(279, 4, [width * height * 2]);
  add(284, 3, [1]);
  add(33421, 3, [2, 2]);
  add(33422, 1, [0, 1, 1, 2]);
  add(50706, 1, [1, 4, 0, 0]);
  add(50707, 1, [1, 1, 0, 0]);
  add(50708, 2, 'Lumaflux Synthetic RAW');
  add(50717, 4, [65535]);
  add(50721, 10, [1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1]);
  add(50728, 5, [1, 1, 1, 1, 1, 1]);
  add(50778, 3, [21]);
  entries.sort((a, b) => a.tag - b.tag);
  let offset = 8 + 2 + entries.length * 12 + 4;
  const extra = entries.reduce(
    (n, e) => n + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0),
    0,
  );
  const pixelsOffset = offset + extra;
  const out = Buffer.alloc(pixelsOffset + width * height * 2);
  out.write('II');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(8, 4);
  out.writeUInt16LE(entries.length, 8);
  entries.forEach((e, i) => {
    const pos = 10 + i * 12;
    out.writeUInt16LE(e.tag, pos);
    out.writeUInt16LE(e.type, pos + 2);
    out.writeUInt32LE(e.count, pos + 4);
    if (e.tag === 273) e.data.writeUInt32LE(pixelsOffset);
    if (e.data.length <= 4) e.data.copy(out, pos + 8);
    else {
      out.writeUInt32LE(offset, pos + 8);
      e.data.copy(out, offset);
      offset += e.data.length + (e.data.length % 2);
    }
  });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out.writeUInt16LE(
        5000 + x * 160 + y * 80,
        pixelsOffset + (y * width + x) * 2,
      );
  return out;
}

describe('RAW pipeline', () => {
  it('RAW sensor data imports, edits, orients, exports and survives catalog reopen without changing original', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-raw-'));
    const pool = new RenderPool(1);
    try {
      const file = path.join(dir, 'sensor.DNG');
      const original = dng(6);
      await writeFile(file, original);
      const info = await inspectImage(file);
      expect(info.format).toBe('dng');
      expect([info.width, info.height]).toEqual([48, 64]);
      expect(info.metadata!.Camera).toMatch(/Synthetic RAW/);
      const catalog = path.join(dir, 'catalog.json');
      const service = await PhotoService.open(catalog);
      const listing = (await new Commands(service, renderImage).run(
        'browse_folder',
        { path: dir },
      )) as { files: { name: string }[] };
      expect(listing.files.some((f) => f.name === 'sensor.DNG')).toBe(true);
      const imported = await service.importPaths([dir]);
      expect(imported.errors).toEqual([]);
      expect(imported.imported.length).toBe(1);
      const id = imported.imported[0];
      await service.edit([
        { id, expectedRevision: 0, patch: { exposure: 1, rotation: 1 } },
      ]);
      const recipe = service.photo(id).recipe;
      const base = await renderImage(file, neutralRecipe());
      const edited = await pool.render(file, recipe, { format: 'jpeg' });
      expect([
        (await sharp(edited).metadata()).width,
        (await sharp(edited).metadata()).height,
      ]).toEqual([64, 48]);
      expect(
        (await sharp(edited).stats()).channels[0].mean,
      ).toBeGreaterThan((await sharp(base).stats()).channels[0].mean);
      const preview = await pool.render(file, recipe, {
        preview: true,
        maxDimension: 32,
      });
      expect((await sharp(preview).metadata()).width).toBe(32);
      await service.history(id, 1, 'undo');
      expect(service.photo(id).recipe.exposure).toBe(0);
      expect((await PhotoService.open(catalog)).photo(id).format).toBe('dng');
      expect(await readFile(file)).toEqual(original);
      // A replacement at the same path must invalidate the decoded-source cache.
      await writeFile(file, dng(1));
      expect((await inspectImage(file)).width).toBe(64);
    } finally {
      await pool.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('invalid RAW files report per-file errors and do not prevent valid imports', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-bad-raw-'));
    try {
      const bad = path.join(dir, 'broken.cr3');
      await writeFile(bad, 'not a RAW image');
      await writeFile(path.join(dir, 'valid.dng'), dng());
      const service = await PhotoService.open(path.join(dir, 'catalog.json'));
      const result = await service.importPaths([dir]);
      expect(result.imported.length).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toMatch(/Cannot decode RAW/);
      await expect(renderImage(bad, neutralRecipe())).rejects.toThrow(
        /Cannot decode RAW/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
