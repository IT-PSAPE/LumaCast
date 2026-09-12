import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderScene, Slide } from '@lumacast/composition';
import { SlideGridTileBody } from '../../../../../app/renderer/features/items/slide-grid-tile-body';
import { SlideOutlineRowBody } from '../../../../../app/renderer/features/items/slide-list-row-body';
import { SlideTileBody } from '../../../../../app/renderer/screens/item-editor/slide-tile-body';

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ slides: [], slideTagsById: new Map() }),
}));

vi.mock('../../../../../app/renderer/components/layout/scroll-area', () => ({
  useScrollAreaActiveItem: () => ({ current: null }),
}));

vi.mock('../../../../../app/renderer/components/display/lazy-scene-stage', () => ({
  LazySceneStage: () => null,
}));

vi.mock('../../../../../app/renderer/components/display/scene-frame', () => ({
  SceneFrame: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../../app/renderer/components/overlays/context-menu', () => ({
  ContextMenu: {
    Portal: () => null,
    Menu: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  },
  useContextMenuTrigger: () => ({ ref: () => undefined, onContextMenu: vi.fn() }),
}));

vi.mock('../../../../../app/renderer/features/automation/slide-bindings-badge', () => ({
  SlideBindingsBadge: () => null,
}));

vi.mock('../../../../../app/renderer/features/items/slide-actions-menu', () => ({
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
