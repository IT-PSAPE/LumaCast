import { describe, expect, it } from 'vitest';
import { canvasPointFromOutputPoint, clampScaledOutputSize, fitCanvasToOutput, outputRectFromCanvasRect } from '../../../../apps/stream/renderer/output-scaling';

describe('base canvas to scaled output mapping', () => {
  it('scales same-aspect canvases to the full output', () => {
    expect(fitCanvasToOutput({ width: 1920, height: 1080 }, { width: 1280, height: 720 })).toEqual({
      x: 0, y: 0, width: 1280, height: 720, scale: 2 / 3,
    });
  });

  it('centers a narrower canvas with pillarbox bars', () => {
    expect(fitCanvasToOutput({ width: 1440, height: 1080 }, { width: 1920, height: 1080 })).toEqual({
      x: 240, y: 0, width: 1440, height: 1080, scale: 1,
    });
  });

  it('centers a wider canvas with letterbox bars', () => {
    expect(fitCanvasToOutput({ width: 1920, height: 1080 }, { width: 1440, height: 1080 })).toEqual({
      x: 0, y: 135, width: 1440, height: 810, scale: 0.75,
    });
  });

  it('maps source rectangles into the centered output viewport', () => {
    expect(outputRectFromCanvasRect(
      { x: 100, y: 200, width: 640, height: 360 },
      { width: 1440, height: 1080 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 340, y: 200, width: 640, height: 360 });
  });

  it('round-trips canvas coordinates and preserves coordinates in output bars', () => {
    const canvas = { width: 1920, height: 1080 };
    const output = { width: 1440, height: 1080 };
    expect(canvasPointFromOutputPoint({ x: 720, y: 540 }, canvas, output)).toEqual({ x: 960, y: 540 });
    expect(canvasPointFromOutputPoint({ x: 720, y: 0 }, canvas, output)).toEqual({ x: 960, y: -180 });
  });

  it('maps canvas boundary points exactly to the fitted viewport edges', () => {
    const viewport = fitCanvasToOutput({ width: 1440, height: 1080 }, { width: 1920, height: 1080 });
    expect(canvasPointFromOutputPoint({ x: viewport.x, y: viewport.y }, { width: 1440, height: 1080 }, { width: 1920, height: 1080 }))
      .toEqual({ x: 0, y: 0 });
    expect(canvasPointFromOutputPoint({ x: viewport.x + viewport.width, y: viewport.y + viewport.height }, { width: 1440, height: 1080 }, { width: 1920, height: 1080 }))
      .toEqual({ x: 1440, y: 1080 });
  });

  it('clamps scaled output dimensions to the encoder limits and even pixel sizes', () => {
    expect(clampScaledOutputSize({ width: 319, height: 239 })).toEqual({ width: 320, height: 240 });
    expect(clampScaledOutputSize({ width: 7681, height: 4321 })).toEqual({ width: 7680, height: 4320 });
    expect(clampScaledOutputSize({ width: 1281, height: 721 })).toEqual({ width: 1282, height: 722 });
  });

  it('returns zero geometry for invalid dimensions and rectangles', () => {
    expect(fitCanvasToOutput({ width: 0, height: 1080 }, { width: 1920, height: 1080 }))
      .toEqual({ x: 0, y: 0, width: 0, height: 0, scale: 0 });
    expect(canvasPointFromOutputPoint({ x: 10, y: 10 }, { width: Number.NaN, height: 1080 }, { width: 1920, height: 1080 }))
      .toEqual({ x: 0, y: 0 });
    expect(outputRectFromCanvasRect(
      { x: 0, y: 0, width: -1, height: 100 },
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
