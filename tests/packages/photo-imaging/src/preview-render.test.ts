// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ByteCache } from '../../../../packages/photo-imaging/src/cache';
import { renderImage } from '../../../../packages/photo-imaging/src/render';
import { neutralRecipe } from '../../../../packages/photo-model/src/model';

describe('preview source cache', () => {
  it('preview cache evicts least-recent entries and bypasses oversized buffers', () => {
    const cache = new ByteCache<string>(10);
    cache.set('a', 'A', 5);
    cache.set('b', 'B', 5);
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C', 5);
    expect(cache.get('b')).toBeUndefined();
    cache.set('large', 'Large', 11);
    expect(cache.get('large')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
  });

  it('preview caches preserve source pixels across edits and invalidate replaced files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lf-preview-'));
    const file = path.join(dir, 'source.png');
    try {
      await sharp({
        create: { width: 300, height: 200, channels: 3, background: '#bb5533' },
      })
        .png()
        .toFile(file);
      const options = {
        format: 'png' as const,
        maxDimension: 160,
        preview: true,
      };
      const recipe = { ...neutralRecipe(), straighten: 5 };
      const before = await renderImage(file, recipe, options);
      const edited = await renderImage(file, { ...recipe, exposure: 1 }, options);
      expect(edited).not.toEqual(before);
      expect(await renderImage(file, recipe, options)).toEqual(before);
      expect(
        before,
      ).toEqual(
        await renderImage(file, recipe, { format: 'png', maxDimension: 160 }),
      );
      await sharp({
        create: { width: 300, height: 200, channels: 3, background: '#33aaff' },
      })
        .png()
        .toFile(file);
      expect(await renderImage(file, recipe, options)).not.toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
