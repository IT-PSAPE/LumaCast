import { describe, expect, it } from 'vitest';
import { sceneSourceBufferSize } from '../../../../apps/stream/renderer/scene-source-buffer';

describe('sceneSourceBufferSize', () => {
  it('matches the final rendered scale for ordinary scene bounds', () => {
    expect(sceneSourceBufferSize(960, 540, 0.5, 0.5)).toEqual({ width: 480, height: 270 });
  });

  it('caps large surfaces without changing their aspect ratio', () => {
    const result = sceneSourceBufferSize(16384, 8192, 1, 1);
    expect(result.width).toBeLessThanOrEqual(8192);
    expect(result.height).toBeLessThanOrEqual(8192);
    expect(result.width * result.height).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(result.width / result.height).toBeCloseTo(2, 2);
  });

  it('keeps a one-pixel minimum for subpixel bounds', () => {
    expect(sceneSourceBufferSize(0.1, 0.1, 0.1, 0.1)).toEqual({ width: 1, height: 1 });
  });
});
