// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderImage } from '../../../../packages/photo-imaging/src/render';
import { neutralRecipe } from '../../../../packages/photo-model/src/model';

describe('straightening geometry', () => {
  it('straightening opaque images never introduces transparent corners', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lf-geometry-'));
    try {
      for (const [width, height] of [
        [300, 200],
        [200, 300],
      ]) {
        const file = path.join(dir, `${width}.png`);
        await sharp({
          create: { width, height, channels: 3, background: '#ca7090' },
        })
          .png()
          .toFile(file);
        for (const rotation of [0, 1])
          for (const straighten of [-45, -30, -5, 5, 30, 45]) {
            const result = await renderImage(
              file,
              { ...neutralRecipe(), rotation, straighten },
              { format: 'png' },
            );
            const { data, info } = await sharp(result)
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            for (let i = 3; i < data.length; i += 4)
              expect(
                data[i],
                `${width}x${height}, rotation ${rotation}, angle ${straighten}, pixel ${i}`,
              ).toBe(255);
            expect(info.width > 0 && info.height > 0).toBe(true);
          }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
