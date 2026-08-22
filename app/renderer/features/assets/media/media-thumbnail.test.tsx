import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MediaAsset } from '@lumacast/composition';
import { MediaThumbnail } from './media-thumbnail';

const { useMediaDerivative } = vi.hoisted(() => ({
  useMediaDerivative: vi.fn(),
}));

vi.mock('../../../hooks/use-media-derivative', () => ({
  useMediaDerivative,
}));

class FakeIntersectionObserver {
  constructor(readonly callback: IntersectionObserverCallback) {}
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
}

function videoAsset(): MediaAsset {
  return {
    id: 'video-1',
    name: 'Clip',
    type: 'video',
    src: 'managed://video-1',
    width: 1280,
    height: 720,
    duration: 12,
    codec: 'h264',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('MediaThumbnail derivative rendering', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not render the raw asset source while derivative generation is still pending', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.mocked(useMediaDerivative).mockReturnValue({
      asset: { ...videoAsset(), thumbnailSrc: null },
      displaySrc: null,
      status: 'generating',
    });

    const { container } = render(<MediaThumbnail asset={videoAsset()} />);

    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders the opaque thumbnail source once available', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.mocked(useMediaDerivative).mockReturnValue({
      asset: { ...videoAsset(), thumbnailSrc: 'managed://thumb-1' },
      displaySrc: 'managed://thumb-1',
      status: 'ready',
    });

    render(<MediaThumbnail asset={videoAsset()} />);

    expect(screen.getByRole('img').getAttribute('src')).toBe('managed://thumb-1');
  });

  it('shows the explicit missing-source state when derivative generation fails', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.mocked(useMediaDerivative).mockReturnValue({
      asset: { ...videoAsset(), thumbnailSrc: null },
      displaySrc: null,
      status: 'missing',
    });

    render(<MediaThumbnail asset={videoAsset()} />);

    expect(screen.getByText('Missing media')).not.toBeNull();
  });
});
