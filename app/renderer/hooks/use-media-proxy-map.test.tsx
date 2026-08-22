import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaProxyMap } from './use-media-proxy-map';

const mockState = vi.hoisted(() => ({
  mediaAssets: [] as Array<{ src: string; thumbnailSrc: string | null }>,
}));

vi.mock('../contexts/use-project-content', () => ({
  useProjectContent: () => ({
    mediaAssets: mockState.mediaAssets,
  }),
}));

describe('useMediaProxyMap', () => {
  beforeEach(() => {
    mockState.mediaAssets = [
      { src: 'asset://one.png', thumbnailSrc: 'asset://one.thumb.png' },
    ];
  });

  it('recomputes when a thumbnail mapping changes without replacing the mediaAssets array', () => {
    const { result, rerender } = renderHook(() => useMediaProxyMap());

    expect(result.current.get('asset://one.png')).toBe('asset://one.thumb.png');

    mockState.mediaAssets[0] = { src: 'asset://one.png', thumbnailSrc: 'asset://one.updated.png' };
    rerender();

    expect(result.current.get('asset://one.png')).toBe('asset://one.updated.png');
  });
});
