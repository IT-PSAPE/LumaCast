// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load(text: string): unknown };
const apps = ['cast', 'stream', 'flux'];

async function bounds(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 128) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { width: info.width, height: info.height, left, top, right, bottom };
}

describe.each(apps)('%s application icons', (app) => {
  const appDir = path.join(root, 'apps', app);
  const resource = (name: string) => readFileSync(path.join(appDir, 'resources', name));

  it('keeps the Dock artwork centered with the same transparent margin', async () => {
    expect(await bounds(resource('icon-mac.png'))).toEqual({
      width: 1024, height: 1024, left: 100, top: 100, right: 923, bottom: 923,
    });
    // The platform inset must not leak into Windows/Linux or tiny favicons.
    expect(await bounds(resource('icon.png'))).toEqual({
      width: 1024, height: 1024, left: 0, top: 0, right: 1023, bottom: 1023,
    });
    expect(await bounds(readFileSync(path.join(appDir, 'renderer/public/favicon.png')))).toMatchObject({
      width: 32, height: 32, left: 0, top: 0, right: 31, bottom: 31,
    });
  });

  it('uses the same padded artwork in every standard and Retina ICNS frame', async () => {
    const icns = resource('icon.icns');
    expect(icns.toString('ascii', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const frames: Record<string, number> = {
      icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024,
      ic11: 32, ic12: 64, ic13: 256, ic14: 512,
    };
    const seen: string[] = [];
    let offset = 8;
    while (offset < icns.length) {
      const type = icns.toString('ascii', offset, offset + 4);
      const length = icns.readUInt32BE(offset + 4);
      expect(length).toBeGreaterThan(8);
      const size = frames[type];
      expect(size).toBeDefined();
      const png = icns.subarray(offset + 8, offset + length);
      const expected = await sharp(resource('icon-mac.png')).resize(size, size).raw().toBuffer();
      expect((await sharp(png).metadata()).width).toBe(size);
      expect((await sharp(png).raw().toBuffer()).equals(expected)).toBe(true);
      seen.push(type);
      offset += length;
    }
    expect(offset).toBe(icns.length);
    expect(seen.sort()).toEqual(Object.keys(frames).sort());
  });

  it('provides readable Windows frames at small, large, and high DPI sizes', async () => {
    const ico = resource('icon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const seen: number[] = [];
    for (let index = 0; index < count; index++) {
      const entry = 6 + index * 16;
      const size = ico[entry] || 256;
      expect(ico[entry + 1] || 256).toBe(size);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(offset, offset + length);
      expect(png.length).toBe(length);
      const expected = await sharp(resource('icon.png')).resize(size, size).raw().toBuffer();
      expect((await sharp(png).raw().toBuffer()).equals(expected)).toBe(true);
      seen.push(size);
    }
    expect(seen).toEqual([16, 32, 48, 64, 128, 256]);
  });

  it('ships the platform icons and runtime PNG in its own app package', () => {
    const config = yaml.load(readFileSync(path.join(appDir, 'electron-builder.yml'), 'utf8')) as {
      directories: { buildResources: string };
      files: string[];
      mac: { icon: string };
      win: { icon: string };
      linux?: { icon: string };
    };
    expect(config.directories.buildResources).toBe('resources');
    expect(config.files).toContain('resources/**/*');
    expect(config.mac.icon).toBe('resources/icon.icns');
    expect(config.win.icon).toBe('resources/icon.ico');
    if (app !== 'stream') expect(config.linux?.icon).toBe('resources/icon.png');
  });
});
