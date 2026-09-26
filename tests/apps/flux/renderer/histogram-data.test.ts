import { test, expect } from 'vitest';
import {
  histogram,
  clippingPixels,
  samplePixel,
} from '../../../../apps/flux/renderer/histogram-data';

test('RGB histogram counts each channel independently and excludes transparent pixels', () => {
  const data = new Uint8ClampedArray([
    0, 10, 255, 255, 255, 10, 0, 255, 0, 0, 0, 0,
  ]);
  const h = histogram(data);
  expect(h.pixels).toBe(2);
  expect(h.channels[0][0]).toBe(1);
  expect(h.channels[1][10]).toBe(2);
  expect(h.channels[2][255]).toBe(1);
  expect(h.shadowChannels).toBe(5);
  expect(h.highlightChannels).toBe(5);
  expect(h.shadows).toBe(2);
  expect(h.highlights).toBe(2);
  for (const bins of h.channels) expect(bins.reduce((a, b) => a + b, 0)).toBe(2);
});

test('clipping masks and RGB sampling respect bounds, toggles, and alpha', () => {
  const data = new Uint8ClampedArray([
    0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 0, 0, 0, 0,
  ]);
  const mask = clippingPixels(data, true, true);
  expect([...mask.slice(0, 8)]).toEqual([0, 0, 255, 210, 255, 0, 0, 210]);
  expect(mask[11]).toBe(0);
  expect(mask[15]).toBe(0);
  expect([...clippingPixels(data, false, false)].every((v) => v === 0)).toBe(true);
  expect(samplePixel(data, 4, 1, 0.3, 0.5)).toEqual([255, 255, 255]);
  expect(samplePixel(data, 4, 1, 1, 0.5)).toBeNull();
  expect(samplePixel(data, 4, 1, 0.9, 0.5)).toBeNull();
});

test('cropped histogram excludes pixels outside the crop', () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const h = histogram(data, 2, { x: 0.5, y: 0, width: 0.5, height: 1 });
  expect(h.pixels).toBe(1);
  expect(h.shadows).toBe(0);
  expect(h.highlights).toBe(1);
  expect(h.channels[0][0]).toBe(0);
});
