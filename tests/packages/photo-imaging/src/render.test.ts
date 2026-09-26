// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectImage, renderImage } from '../../../../packages/photo-imaging/src/render';
import { neutralRecipe, recipeSchema } from '../../../../packages/photo-model/src/model';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-imaging-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makePng(opts: {
  w: number;
  h: number;
  channels?: 3 | 4;
  fill: [number, number, number, number];
}): Promise<string> {
  const p = path.join(
    dir,
    `f${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
  );
  await sharp({
    create: {
      width: opts.w,
      height: opts.h,
      channels: opts.channels ?? 4,
      background: {
        r: opts.fill[0],
        g: opts.fill[1],
        b: opts.fill[2],
        alpha: opts.fill[3] / 255,
      },
    },
  })
    .png()
    .toFile(p);
  return p;
}

async function centerPixel(
  buf: Buffer,
): Promise<{ r: number; g: number; b: number; a: number }> {
  const img = sharp(buf);
  const md = await img.metadata();
  const w = md.width!,
    h = md.height!;
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const cx = Math.floor(w / 2),
    cy = Math.floor(h / 2);
  const off = (cy * w + cx) * info.channels;
  return {
    r: data[off],
    g: data[off + 1],
    b: data[off + 2],
    a: info.channels >= 4 ? data[off + 3] : 255,
  };
}

async function avgLuminance(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    sum +=
      0.2126 * data[i] +
      0.7152 * (data[i + 1] ?? data[i]) +
      0.0722 * (data[i + 2] ?? data[i]);
  }
  return sum / (data.length / info.channels);
}

describe('geometry', () => {
  it('neutral recipe produces identical image', async () => {
    const p = await makePng({ w: 64, h: 64, fill: [128, 100, 80, 255] });
    const original = await readFile(p);
    const out = await renderImage(p, neutralRecipe());
    const origMeta = await sharp(original).metadata();
    const outMeta = await sharp(out).metadata();
    expect(outMeta.width).toBe(origMeta.width);
    expect(outMeta.height).toBe(origMeta.height);
    const oPx = await centerPixel(original);
    const nPx = await centerPixel(out);
    expect(nPx.r).toBe(oPx.r);
    expect(nPx.g).toBe(oPx.g);
    expect(nPx.b).toBe(oPx.b);
  });

  it('rotation changes dimensions', async () => {
    const p = await makePng({ w: 100, h: 50, fill: [200, 100, 50, 255] });
    const r1 = await renderImage(p, recipeSchema.parse({ rotation: 1 }));
    const r2 = await renderImage(p, recipeSchema.parse({ rotation: 0 }));
    const m1 = await sharp(r1).metadata();
    const m2 = await sharp(r2).metadata();
    expect(m1.width).toBe(m2.height);
    expect(m1.height).toBe(m2.width);
  });

  it('flip preserves dimensions', async () => {
    const p = await makePng({ w: 48, h: 32, fill: [100, 200, 50, 255] });
    const out = await renderImage(p, recipeSchema.parse({ flipX: true }));
    const oMeta = await sharp(await readFile(p)).metadata();
    const nMeta = await sharp(out).metadata();
    expect(nMeta.width).toBe(oMeta.width);
    expect(nMeta.height).toBe(oMeta.height);
  });

  it('crop reduces dimensions', async () => {
    const p = await makePng({ w: 200, h: 100, fill: [50, 150, 200, 255] });
    const out = await renderImage(
      p,
      recipeSchema.parse({ crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }),
    );
    const meta = await sharp(out).metadata();
    // 200*0.5=100, 100*0.5=50, each ±1 rounding.
    expect(meta.width!).toBeLessThanOrEqual(101);
    expect(meta.height!).toBeLessThanOrEqual(51);
    expect(meta.width!).toBeGreaterThanOrEqual(99);
    expect(meta.height!).toBeGreaterThanOrEqual(49);
  });

  it('rotation plus crop applies in correct order', async () => {
    const p = await makePng({ w: 100, h: 50, fill: [200, 100, 50, 255] });
    // Rotate 90 then crop center 50%.
    const out = await renderImage(
      p,
      recipeSchema.parse({
        rotation: 1,
        crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      }),
    );
    const meta = await sharp(out).metadata();
    // After 90 rotation: 50x100; crop 50% -> ~25x50.
    expect(meta.width!).toBeLessThanOrEqual(27);
    expect(meta.height!).toBeLessThanOrEqual(52);
  });
});

describe('exposure', () => {
  it('positive exposure brightens', async () => {
    const p = await makePng({ w: 16, h: 16, fill: [100, 100, 100, 255] });
    const base = await avgLuminance(
      await renderImage(p, recipeSchema.parse({ exposure: 0 })),
    );
    const bright = await avgLuminance(
      await renderImage(p, recipeSchema.parse({ exposure: 2 })),
    );
    expect(bright, `bright ${bright} should be > base ${base}`).toBeGreaterThan(base);
  });

  it('negative exposure darkens', async () => {
    const p = await makePng({ w: 16, h: 16, fill: [200, 200, 200, 255] });
    const base = await avgLuminance(
      await renderImage(p, recipeSchema.parse({ exposure: 0 })),
    );
    const dark = await avgLuminance(
      await renderImage(p, recipeSchema.parse({ exposure: -2 })),
    );
    expect(dark, `dark ${dark} should be < base ${base}`).toBeLessThan(base);
  });

  it('one EV doubles linear light rather than gamma encoded channel values', async () => {
    const p = await makePng({ w: 4, h: 4, fill: [100, 100, 100, 255] });
    const out = await centerPixel(
      await renderImage(p, recipeSchema.parse({ exposure: 1 })),
    );
    const lin = ((100 / 255 + 0.055) / 1.055) ** 2.4;
    const expected = Math.round((1.055 * (lin * 2) ** (1 / 2.4) - 0.055) * 255);
    expect(Math.abs(out.r - expected)).toBeLessThanOrEqual(1);
    expect(out.r).toBeLessThan(180);
  });
});

describe('recipe defaults', () => {
  it('neutral recipe is zero everywhere', () => {
    const nr = neutralRecipe();
    expect(nr.exposure).toBe(0);
    expect(nr.brightness).toBe(0);
    expect(nr.contrast).toBe(0);
    expect(nr.temperature).toBe(0);
    expect(nr.tint).toBe(0);
    expect(nr.hue).toBe(0);
    expect(nr.saturation).toBe(0);
    expect(nr.vibrance).toBe(0);
    expect(nr.sharpening).toBe(0);
    expect(nr.vignette).toBe(0);
    expect(nr.rotation).toBe(0);
    expect(nr.straighten).toBe(0);
    expect(nr.flipX).toBe(false);
    expect(nr.flipY).toBe(false);
    expect(nr.crop).toBeNull();
  });
});

describe('hue and saturation', () => {
  it('saturation adjustment shifts color toward gray', async () => {
    const p = await makePng({ w: 16, h: 16, fill: [255, 0, 0, 255] });
    const base = await centerPixel(
      await renderImage(p, recipeSchema.parse({ saturation: 0 })),
    );
    const desat = await centerPixel(
      await renderImage(p, recipeSchema.parse({ saturation: -100 })),
    );
    const rDiff = Math.abs(base.r - desat.r);
    const gDiff = Math.abs(base.g - desat.g);
    expect(
      rDiff > 10 || gDiff > 10,
      `desaturation should shift RGB: rDiff=${rDiff} gDiff=${gDiff}`,
    ).toBe(true);
  });

  it('hue rotation changes color', async () => {
    const p = await makePng({ w: 16, h: 16, fill: [255, 0, 0, 255] });
    const base = await centerPixel(
      await renderImage(p, recipeSchema.parse({ hue: 0 })),
    );
    const rotated = await centerPixel(
      await renderImage(p, recipeSchema.parse({ hue: 120 })),
    );
    expect(
      base.g,
      `green channel should change with hue shift: ${base.g} vs ${rotated.g}`,
    ).not.toBe(rotated.g);
  });
});

describe('alpha preservation', () => {
  it('alpha channel preserved through render', async () => {
    const p = await makePng({
      w: 16,
      h: 16,
      channels: 4,
      fill: [100, 150, 200, 128],
    });
    const out = await renderImage(p, neutralRecipe());
    const { info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const px = await centerPixel(out);
    expect(Math.abs(px.a - 128), `alpha should be ~128, got ${px.a}`).toBeLessThan(5);
  });

  it('render with no alpha input produces opaque output', async () => {
    const p = await makePng({
      w: 16,
      h: 16,
      channels: 3,
      fill: [128, 128, 128, 255],
    });
    const out = await renderImage(p, neutralRecipe());
    const { info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const px = await centerPixel(out);
    expect(px.a).toBe(255);
  });
});

describe('rejected input', () => {
  it('rejects oversized images', async () => {
    const big = path.join(dir, 'big.png');
    await sharp({
      create: { width: 10000, height: 10000, channels: 3, background: 'black' },
    })
      .png()
      .toFile(big);
    await expect(renderImage(big, neutralRecipe())).rejects.toThrow(/pixel limit/);
  });

  it('rejects multi-page images', async () => {
    const multi = path.join(dir, 'multi.webp');
    const raw = Buffer.alloc(16 * 32 * 4, 255);
    raw.fill(50, 0, 16 * 16 * 4);
    await sharp(raw, {
      raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
    })
      .webp()
      .toFile(multi);
    expect((await sharp(multi, { animated: true }).metadata()).pages).toBe(2);
    await expect(renderImage(multi, neutralRecipe())).rejects.toThrow(
      /multi-page or animated/,
    );
    await expect(inspectImage(multi)).rejects.toThrow(/multi-page or animated/);
  });
});

describe('inspectImage', () => {
  it('inspectImage returns dimensions and format', async () => {
    const p = await makePng({ w: 80, h: 60, fill: [50, 50, 50, 255] });
    const info = await inspectImage(p);
    expect(info.width).toBe(80);
    expect(info.height).toBe(60);
    expect(info.format).toBe('png');
    expect(info.size).toBeGreaterThan(0);
  });
});

describe('output options', () => {
  it('jpeg output format', async () => {
    const p = await makePng({ w: 32, h: 32, fill: [100, 150, 200, 255] });
    const out = await renderImage(p, neutralRecipe(), {
      format: 'jpeg',
      quality: 90,
    });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('webp output format', async () => {
    const p = await makePng({ w: 32, h: 32, fill: [100, 150, 200, 255] });
    const out = await renderImage(p, neutralRecipe(), { format: 'webp' });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
  });

  it('default output is png', async () => {
    const p = await makePng({ w: 32, h: 32, fill: [100, 150, 200, 255] });
    const out = await renderImage(p, neutralRecipe());
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
  });

  it('maxDimension resizes without enlarge', async () => {
    const p = await makePng({ w: 200, h: 100, fill: [80, 80, 80, 255] });
    const out = await renderImage(p, neutralRecipe(), { maxDimension: 50 });
    const meta = await sharp(out).metadata();
    expect(meta.width!).toBeLessThanOrEqual(50);
    expect(meta.height!).toBeLessThanOrEqual(50);
  });

  it('maxDimension does not enlarge small images', async () => {
    const p = await makePng({ w: 20, h: 20, fill: [80, 80, 80, 255] });
    const out = await renderImage(p, neutralRecipe(), { maxDimension: 100 });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(20);
    expect(meta.height).toBe(20);
  });
});

describe('tone and color adjustments', () => {
  it('brightness shifts all channels', async () => {
    const p = await makePng({ w: 8, h: 8, fill: [128, 128, 128, 255] });
    const base = await centerPixel(
      await renderImage(p, recipeSchema.parse({ brightness: 0 })),
    );
    const bright = await centerPixel(
      await renderImage(p, recipeSchema.parse({ brightness: 50 })),
    );
    expect(
      bright.r,
      `brightness up should increase r: ${bright.r} > ${base.r}`,
    ).toBeGreaterThan(base.r);
  });

  it('contrast expands range', async () => {
    const p = await makePng({ w: 8, h: 8, fill: [128, 128, 128, 255] });
    const base = await centerPixel(
      await renderImage(p, recipeSchema.parse({ contrast: 0 })),
    );
    const high = await centerPixel(
      await renderImage(p, recipeSchema.parse({ contrast: 100 })),
    );
    // High contrast from mid-gray should push values away from center.
    const baseDev = Math.abs(base.r - 128);
    const highDev = Math.abs(high.r - 128);
    expect(
      highDev,
      `contrast should expand deviation: ${highDev} >= ${baseDev}`,
    ).toBeGreaterThanOrEqual(baseDev);
  });

  it('temperature shifts red/blue balance', async () => {
    const p = await makePng({ w: 8, h: 8, fill: [128, 128, 128, 255] });
    const warm = await centerPixel(
      await renderImage(p, recipeSchema.parse({ temperature: 80 })),
    );
    const cool = await centerPixel(
      await renderImage(p, recipeSchema.parse({ temperature: -80 })),
    );
    expect(
      warm.r,
      `warm should have more red: ${warm.r} > ${cool.r}`,
    ).toBeGreaterThan(cool.r);
    expect(
      warm.b,
      `warm should have less blue: ${warm.b} < ${cool.b}`,
    ).toBeLessThan(cool.b);
  });

  it('tint shifts green channel', async () => {
    const p = await makePng({ w: 8, h: 8, fill: [128, 128, 128, 255] });
    const pos = await centerPixel(
      await renderImage(p, recipeSchema.parse({ tint: 80 })),
    );
    const neg = await centerPixel(
      await renderImage(p, recipeSchema.parse({ tint: -80 })),
    );
    expect(
      pos.g,
      `positive tint should reduce green (magenta): ${pos.g} < ${neg.g}`,
    ).toBeLessThan(neg.g);
  });
});

describe('optics', () => {
  it('sharpening is applied without error', async () => {
    const p = await makePng({ w: 32, h: 32, fill: [100, 100, 100, 255] });
    const out = await renderImage(p, recipeSchema.parse({ sharpening: 50 }));
    expect(out.length).toBeGreaterThan(0);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(32);
  });

  it('vignette darkens edges', async () => {
    const p = await makePng({ w: 64, h: 64, fill: [200, 200, 200, 255] });
    const out = await renderImage(p, recipeSchema.parse({ vignette: 100 }));
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const cx = 32,
      cy = 32;
    const centerLum =
      0.2126 * data[(cy * 64 + cx) * 4] +
      0.7152 * data[(cy * 64 + cx) * 4 + 1] +
      0.0722 * data[(cy * 64 + cx) * 4 + 2];
    const edgeLum = 0.2126 * data[0] + 0.7152 * data[1] + 0.0722 * data[2];
    expect(
      centerLum,
      `center ${centerLum} should be brighter than edge ${edgeLum}`,
    ).toBeGreaterThan(edgeLum);
  });

  it('straighten produces valid output', async () => {
    const p = await makePng({ w: 64, h: 64, fill: [100, 100, 100, 255] });
    const out = await renderImage(p, recipeSchema.parse({ straighten: 15 }));
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('recipe validation and orientation', () => {
  it('rejects invalid recipe values', async () => {
    const p = await makePng({ w: 8, h: 8, fill: [100, 100, 100, 255] });
    await expect(
      renderImage(p, { ...neutralRecipe(), exposure: 999 } as never),
    ).rejects.toThrow(/Too big/);
    await expect(
      renderImage(p, { ...neutralRecipe(), rotation: 5 } as never),
    ).rejects.toThrow(/Too big/);
  });

  it('EXIF orientation and crop are applied before the recipe rotation', async () => {
    const p = path.join(dir, 'oriented.jpg');
    await sharp({
      create: { width: 60, height: 40, channels: 3, background: '#606060' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(p);
    expect([
      (await inspectImage(p)).width,
      (await inspectImage(p)).height,
    ]).toEqual([40, 60]);
    const out = await renderImage(
      p,
      recipeSchema.parse({
        rotation: 1,
        crop: { x: 0, y: 0, width: 0.5, height: 1 },
      }),
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(30);
    expect(meta.height).toBe(40);
  });
});
