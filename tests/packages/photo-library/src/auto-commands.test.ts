// @vitest-environment node
// The Auto command test reaches into the app's MCP editing guide, tests-only,
// to assert the guide text the command surface documents itself against.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { editingGuide } from '../../../../apps/flux/main/mcp/editing-guide';
import {
  inspectImage,
  renderImage,
} from '../../../../packages/photo-imaging/src/render';
import { Commands } from '../../../../packages/photo-library/src/commands';
import { PhotoService } from '../../../../packages/photo-library/src/service';

const APP_DIR = path.resolve(__dirname, '../../../../apps/flux');

describe('Auto commands', () => {
  it('Auto commands preserve originals, use JPEG metadata, retain history and reject stale edits', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lumaflux-auto-command-'));
    try {
      const file = path.join(dir, 'camera.jpg');
      const pixels = Buffer.alloc(96 * 64 * 3);
      for (let i = 0; i < pixels.length; i++) pixels[i] = 20 + (i % 96);
      await sharp(pixels, { raw: { width: 96, height: 64, channels: 3 } })
        .withExif({
          IFD0: { Make: 'Canon', Model: 'Canon EOS 5D Mark II' },
          IFD2: {
            LensModel: 'Canon EF 50mm f/1.8 II',
            FocalLength: '50/1',
            FNumber: '4/1',
          },
        })
        .jpeg()
        .toFile(file);
      const original = await readFile(file),
        info = await inspectImage(file);
      expect(info.metadata!.Lens).toMatch(/50mm/);
      const service = await PhotoService.open(path.join(dir, 'catalog.json'));
      await service.importPaths([file]);
      const p = service.state().photos[0],
        commands = new Commands(service, renderImage);
      const match = (await commands.run('get_lens_match', {
        id: p.id,
      })) as { profile: unknown; message?: string };
      expect(match.profile, match.message).toBeTruthy();
      await commands.run('auto_lens_correction', {
        id: p.id,
        expectedRevision: 0,
      });
      expect(service.photo(p.id).recipe.lensProfile).toBeTruthy();
      const preview = await renderImage(file, service.photo(p.id).recipe, {
        preview: true,
        maxDimension: 96,
      });
      expect(preview.length).toBeGreaterThan(0);
      const persisted = await PhotoService.open(path.join(dir, 'catalog.json'));
      expect(persisted.photo(p.id).recipe.lensProfile).toEqual(
        service.photo(p.id).recipe.lensProfile,
      );
      await expect(
        commands.run('auto_adjust', { id: p.id, expectedRevision: 0 }),
      ).rejects.toThrow(/REVISION_CONFLICT/);
      const suggested = (await commands.run('suggest_adjustments', {
        id: p.id,
      })) as { expectedRevision: number };
      expect(service.photo(p.id).revision).toBe(1);
      expect(suggested.expectedRevision).toBe(1);
      await commands.run('auto_adjust', { id: p.id, expectedRevision: 1 });
      expect(service.photo(p.id).revision).toBe(2);
      expect(service.photo(p.id).recipe.lensProfile).toBeTruthy();
      await commands.run('undo', { id: p.id, expectedRevision: 2 });
      expect(service.photo(p.id).recipe.exposure).toBe(0);
      expect(service.photo(p.id).recipe.lensProfile).toBeTruthy();
      let concurrent = false;
      const delayed = new Commands(service, async (...args) => {
        if (!concurrent) {
          concurrent = true;
          await service.edit(
            [{ id: p.id, expectedRevision: 3, patch: { exposure: 0.4 } }],
            'concurrent editor',
          );
        }
        return renderImage(...args);
      });
      await expect(
        delayed.run('auto_adjust', { id: p.id, expectedRevision: 3 }),
      ).rejects.toThrow(/CONFLICT/);
      expect(service.photo(p.id).recipe.exposure).toBe(0.4);
      expect(await readFile(file)).toEqual(original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Packaged MCP guide and installable skill remain identical', async () => {
    expect(
      await readFile(
        path.join(APP_DIR, 'skills', 'professional-photo-editing', 'SKILL.md'),
        'utf8',
      ),
    ).toBe(editingGuide);
    expect(editingGuide).toMatch(/composition/i);
    expect(editingGuide).toMatch(/8-bit/);
    expect(editingGuide).toMatch(/referenceId/);
  });
});
