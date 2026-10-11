import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderScene, Slide } from '@lumacast/composition';
import { SortableSlideGridTile } from '../../../../../../apps/cast/renderer/features/items/sortable-slide-grid-tile';
import { SortableSlideOutlineRow } from '../../../../../../apps/cast/renderer/features/items/sortable-slide-outline-row';

const mocks = vi.hoisted(() => ({ useSortableItem: vi.fn(() => ({ handleProps: {} })) }));
vi.mock('@renderer/components/layout/sortable-list', () => ({ useSortableItem: mocks.useSortableItem }));
vi.mock('../../../../../../apps/cast/renderer/features/items/slide-grid-tile', () => ({ SlideGridTile: () => null }));
vi.mock('../../../../../../apps/cast/renderer/features/items/slide-list-row', () => ({ SlideOutlineRow: () => null }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('generated slide drag handles', () => {
  it.each([false, true])('disables grid dragging when generated is %s', (isGenerated) => {
    render(<SortableSlideGridTile
      slideId="slide" index={0} scene={{ width: 1920, height: 1080 } as RenderScene}
      selected={false} focused={false} isLive={false} isEmpty={true} isGenerated={isGenerated}
      onActivate={vi.fn()} onFocus={vi.fn()} onRangeSelect={vi.fn()} actionSlideIds={['slide']}
    />);
    expect(mocks.useSortableItem).toHaveBeenCalledWith('slide', isGenerated);
  });

  it.each([false, true])('disables list dragging when generated is %s', (isGenerated) => {
    render(<SortableSlideOutlineRow
      row={{ slide: { id: 'slide', runtimeBlank: isGenerated ? 'start' : undefined } as Slide, index: 0, state: 'queued', elements: [] }}
      scene={{ width: 1920, height: 1080 } as RenderScene} isFocused={false} isSelected={false}
      onSelect={vi.fn()} onOpen={vi.fn()} onRangeSelect={vi.fn()} actionSlideIds={['slide']}
    />);
    expect(mocks.useSortableItem).toHaveBeenCalledWith('slide', isGenerated);
  });
});
