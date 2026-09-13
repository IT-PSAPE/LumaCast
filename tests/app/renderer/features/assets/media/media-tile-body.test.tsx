import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MediaAsset } from '@lumacast/composition';
import { MediaTileBody } from '../../../../../../app/renderer/features/assets/media/media-tile-body';

vi.mock('../../../../../../app/renderer/features/assets/media/use-media-context-actions', () => ({
  useMediaContextActions: () => ({ handleReplaceSource: vi.fn(async () => undefined), handleDelete: vi.fn(async () => undefined) }),
}));

vi.mock('../../../../../../app/renderer/components/overlays/context-menu', () => ({
  useContextMenuTrigger: () => ({ ref: () => undefined, onContextMenu: vi.fn() }),
}));

vi.mock('../../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: { programMode: 'all', programSingleSurface: 'program' },
    actions: { setProgramSingleSurface: vi.fn() },
  }),
}));

vi.mock('../../../../../../app/renderer/features/assets/media/media-thumbnail', () => ({
  MediaThumbnail: () => <div data-testid="media-thumbnail" />,
}));

vi.mock('../../../../../../app/renderer/features/assets/media/media-context-menu-items', () => ({
  MediaContextMenuItems: () => null,
}));

function asset(overrides: Partial<MediaAsset>): MediaAsset {
  return {
    id: 'asset-1',
    name: 'Asset',
    type: 'image',
    src: 'managed://asset-1',
    width: 300,
    height: 900,
    duration: null,
    codec: null,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderTile(media: MediaAsset) {
  render(<MediaTileBody asset={media} isActive={false} onAssignLayer={vi.fn()} onArmVideo={vi.fn()} />);
  // The Thumbnail.Body slot renders its children directly inside the sized frame,
  // so the stubbed thumbnail's parent is that frame.
  const body = screen.getByTestId('media-thumbnail').parentElement;
  if (!body) throw new Error('Thumbnail body not rendered');
  return body;
}

describe('MediaTileBody frame sizing', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps a tall image in the standard tile frame instead of reshaping the tile to the image', () => {
    const body = renderTile(asset({ type: 'image', width: 300, height: 900 }));

    expect(body.classList.contains('aspect-video')).toBe(true);
    expect(body.style.getPropertyValue('--thumbnail-aspect-ratio')).toBe('');
  });

  it('keeps a wide video in the standard tile frame', () => {
    const body = renderTile(asset({ type: 'video', width: 3840, height: 1080, duration: 10, codec: 'h264' }));

    expect(body.classList.contains('aspect-video')).toBe(true);
    expect(body.style.getPropertyValue('--thumbnail-aspect-ratio')).toBe('');
  });

  it('still renders audio as a square tile', () => {
    const body = renderTile(asset({ type: 'audio', width: null, height: null, duration: 180, codec: 'mp3' }));

    expect(body.classList.contains('aspect-video')).toBe(false);
    expect(body.style.getPropertyValue('--thumbnail-aspect-ratio')).toBe('1');
  });
});
