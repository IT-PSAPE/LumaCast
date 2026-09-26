// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderImage } from '../../../../packages/photo-imaging/src/render';
import { neutralRecipe } from '../../../../packages/photo-model/src/model';
import { PhotoService } from '../../../../packages/photo-library/src/service';

describe('corrections through the library', () => {
  it('corrections persist, undo and invalidate previews without modifying originals', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lf-corrections-')),
      file = path.join(dir, 'photo.png'),
      catalog = path.join(dir, 'catalog.json');
    try {
      const data = Buffer.alloc(160 * 120 * 3);
      for (let i = 0; i < data.length; i++) data[i] = (i * 73) % 256;
      await sharp(data, { raw: { width: 160, height: 120, channels: 3 } })
        .png()
        .toFile(file);
      const source = await readFile(file);
      const service = await PhotoService.open(catalog);
      await service.importPaths([file]);
      const p = service.state().photos[0];
      await service.edit([
        {
          id: p.id,
          expectedRevision: 0,
          patch: { crop: { x: 0, y: 0, width: 0.5, height: 0.5 } },
        },
      ]);
      const patch = {
        lensDistortion: 45,
        lensVignette: 20,
        lensRed: 5,
        lensBlue: -5,
        noiseLuminance: 60,
        noiseColor: 70,
      };
      await service.edit([{ id: p.id, expectedRevision: 1, patch }]);
      expect(service.photo(p.id).recipe.crop).toBeNull();
      const reopened = await PhotoService.open(catalog);
      expect(reopened.photo(p.id).recipe.noiseColor).toBe(70);
      const recipe = reopened.photo(p.id).recipe,
        opts = { format: 'png' as const, maxDimension: 160, preview: true };
      const edited = await renderImage(file, recipe, opts),
        neutral = await renderImage(file, neutralRecipe(), opts);
      expect(edited).not.toEqual(neutral);
      expect(
        await renderImage(file, recipe, { format: 'png', maxDimension: 160 }),
      ).toEqual(edited);
      expect(await renderImage(file, recipe, opts)).toEqual(edited);
      expect(
        await renderImage(file, { ...recipe, lensDistortion: -45 }, opts),
      ).not.toEqual(edited);
      expect(
        await renderImage(
          file,
          { ...recipe, noiseLuminance: 0, noiseColor: 0 },
          opts,
        ),
      ).not.toEqual(edited);
      await reopened.history(p.id, 2, 'undo', 'UI');
      expect(reopened.photo(p.id).recipe.noiseColor).toBe(0);
      expect(reopened.photo(p.id).recipe.crop).toBeTruthy();
      expect(await readFile(file)).toEqual(source);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
