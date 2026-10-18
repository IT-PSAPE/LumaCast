import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderScene, Slide } from '@lumacast/composition';
import { SlideGridTileBody } from '../../../../../../apps/cast/renderer/features/items/slide-grid-tile-body';
import { SlideOutlineRowBody } from '../../../../../../apps/cast/renderer/features/items/slide-list-row-body';
import { SlideTileBody } from '../../../../../../apps/cast/renderer/screens/item-editor/slide-tile-body';

vi.mock('../../../../../../apps/cast/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ slides: [], slideTagsById: new Map() }),
}));

vi.mock('../../../../../../apps/cast/renderer/components/layout/scroll-area', () => ({
  useScrollAreaActiveItem: () => ({ current: null }),
}));

vi.mock('../../../../../../apps/cast/renderer/components/display/lazy-scene-stage', () => ({
  LazySceneStage: () => null,
}));

vi.mock('../../../../../../apps/cast/renderer/components/display/scene-frame', () => ({
  SceneFrame: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lumacast/ui', async () => {
  const actual = await vi.importActual<typeof import('@lumacast/ui')>('@lumacast/ui');
  return {
    ...actual,
    ContextMenu: {
      Portal: () => null,
      Menu: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    },
    useContextMenuTrigger: () => ({ ref: () => undefined, onContextMenu: vi.fn() }),
  };
});

vi.mock('../../../../../../apps/cast/renderer/features/automation/slide-bindings-badge', () => ({
  SlideBindingsBadge: () => null,
}));

vi.mock('../../../../../../apps/cast/renderer/features/items/slide-actions-menu', () => ({
  SlideActionsMenu: () => null,
}));

const scene = { width: 1920, height: 1080 } as RenderScene;
const noopIndex = () => undefined;
const noopRange = () => undefined;

function slide(id: string): Slide {
  return {
    id,
    backgroundSource: 'local',
    presentationId: 'presentation-1',
    lyricId: null,
    presentationThemeId: null,
    lyricThemeId: null,
    overlayThemeId: null,
    overlayId: null,
    stageId: null,
    kind: 'presentation',
    width: 1920,
    height: 1080,
    notes: '',
    order: 0,
    tagId: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
}

afterEach(cleanup);

describe('slide selection surfaces', () => {
  it('labels a generated grid tile and leaves authored tiles unlabelled', () => {
    const props = {
      slideId: 'runtime:lyric:song:blank:start', index: 0, scene, selected: false,
      focused: false, isLive: false, isEmpty: true, onActivate: noopIndex,
      onFocus: noopIndex, onRangeSelect: noopRange, actionSlideIds: [],
    };
    const view = render(<SlideGridTileBody {...props} isGenerated />);
    expect(screen.getByText('Auto-generated')).toBeInTheDocument();
    view.rerender(<SlideGridTileBody {...props} slideId="authored" isGenerated={false} />);
    expect(screen.queryByText('Auto-generated')).toBeNull();
  });

  it('labels generated blanks in the list too', () => {
    render(<SlideOutlineRowBody
      row={{ slide: { ...slide('blank'), runtimeBlank: 'end' }, elements: [], index: 2, state: 'queued' }}
      scene={scene} isFocused={false} isSelected={false} onSelect={noopIndex}
      onOpen={noopIndex} onRangeSelect={noopRange} actionSlideIds={['blank']}
    />);
    expect(screen.getByText('Auto-generated')).toBeInTheDocument();
  });

  it.each([
    [
      'show grid tile',
      <SlideGridTileBody
        slideId="slide-grid"
        index={0}
        scene={scene}
        selected={false}
        focused={false}
        isLive={false}
        isEmpty={false}
        onActivate={noopIndex}
        onFocus={noopIndex}
        onRangeSelect={noopRange}
        actionSlideIds={['slide-grid']}
      />,
    ],
    [
      'show list row',
      <SlideOutlineRowBody
        row={{ slide: slide('slide-list'), elements: [], index: 0, state: 'queued' }}
        scene={scene}
        isFocused={false}
        isSelected={false}
        onSelect={noopIndex}
        onOpen={noopIndex}
        onRangeSelect={noopRange}
        actionSlideIds={['slide-list']}
      />,
    ],
    [
      'item editor tile',
      <SlideTileBody
        slideId="slide-editor"
        scene={scene}
        index={0}
        isActive={false}
        isSelected={false}
        isLive={false}
        isEmpty={false}
        actionSlideIds={['slide-editor']}
        onSelect={() => undefined}
      />,
    ],
  ])('prevents native text selection on the %s root', (_name, surface) => {
    const { container } = render(surface);

    expect(container.firstElementChild?.classList.contains('select-none')).toBe(true);
  });
});
