import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Presentation } from '@lumacast/composition';
import type { PlaylistDeckSequenceItem } from '../../features/items/use-playlist-deck-sequence';
import { ShowBrowserContent } from './browser-content';

// Covers the show-page composition refactor: exactly one browser-content
// variant mounts per contentVariant — the empty placeholder, the single-slide
// tree, or the continuous playlist tree — instead of several children each
// self-gating on the variant.
vi.mock('../../features/items/slide-browser-content', () => ({
  SlideBrowserContent: ({ variant }: { variant: string }) => (
    <div data-testid="single-content" data-variant={variant} />
  ),
}));

vi.mock('../../features/items/continuous-slide-browser', () => ({
  ContinuousSlideBrowser: ({ variant, items }: { variant: string; items: unknown[] }) => (
    <div data-testid="continuous-content" data-variant={variant} data-item-count={items.length} />
  ),
}));

const sequenceItems: PlaylistDeckSequenceItem[] = [
  {
    entryId: 'entry-1',
    itemRef: { type: 'presentation', id: 'item-1' },
    item: { id: 'item-1', title: 'Deck', order: 0, createdAt: 't', updatedAt: 't' } as Presentation,
    slides: [],
    occurrenceIndex: 1,
  },
];

afterEach(() => {
  cleanup();
});

describe('ShowBrowserContent variant dispatch', () => {
  it.each(['single-grid', 'single-list'] as const)(
    '%s mounts only the single-slide tree with the matching variant',
    (variant) => {
      const { getByTestId, queryByTestId } = render(<ShowBrowserContent variant={variant} items={sequenceItems} />);
      expect(getByTestId('single-content').getAttribute('data-variant')).toBe(variant);
      expect(queryByTestId('continuous-content')).toBeNull();
    },
  );

  it.each(['continuous-grid', 'continuous-list'] as const)(
    '%s mounts only the continuous tree with the items and matching variant',
    (variant) => {
      const { getByTestId, queryByTestId } = render(<ShowBrowserContent variant={variant} items={sequenceItems} />);
      expect(getByTestId('continuous-content').getAttribute('data-variant')).toBe(variant);
      expect(getByTestId('continuous-content').getAttribute('data-item-count')).toBe('1');
      expect(queryByTestId('single-content')).toBeNull();
    },
  );

  it('empty mounts only the empty placeholder and no browser tree', () => {
    const { container, queryByTestId } = render(<ShowBrowserContent variant="empty" items={sequenceItems} />);
    expect(queryByTestId('single-content')).toBeNull();
    expect(queryByTestId('continuous-content')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
