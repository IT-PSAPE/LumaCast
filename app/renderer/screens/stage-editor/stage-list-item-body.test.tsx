import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StageListItemBody } from './stage-list-item-body';

const mocks = vi.hoisted(() => ({
  buildRenderScene: vi.fn(),
  lazySceneStage: vi.fn(),
  selectStage: vi.fn(),
  duplicateStage: vi.fn(),
  deleteStage: vi.fn(),
  requestNameFocus: vi.fn(),
  confirm: vi.fn(),
  triggerRef: vi.fn(),
  containerRef: vi.fn(),
  mediaProxyMap: new Map(),
}));

vi.mock('../../features/canvas/build-render-scene', () => ({
  buildRenderScene: (...args: unknown[]) => mocks.buildRenderScene(...args),
}));

vi.mock('../../hooks/use-media-proxy-map', () => ({
  useMediaProxyMap: () => mocks.mediaProxyMap,
}));

vi.mock('../../components/display/lazy-scene-stage', () => ({
  LazySceneStage: (props: { surface: string; className?: string }) => {
    mocks.lazySceneStage(props);
    return <div data-testid="lazy-scene-stage" data-surface={props.surface} className={props.className} />;
  },
}));

vi.mock('../../components/display/thumbnail', async () => {
  const React = await import('react');

  const Tile = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }>(
    ({ children, selected, ...props }, ref) => (
      <button ref={ref} type="button" data-testid="stage-tile" data-selected={selected ? 'true' : 'false'} {...props}>
        {children}
      </button>
    ),
  );
  Tile.displayName = 'ThumbnailTile';

  return {
    Thumbnail: {
      Tile,
      Body: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Caption: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    },
  };
});

vi.mock('@renderer/components/layout/scroll-area', () => ({
  useScrollAreaActiveItem: () => ({ current: null }),
}));

vi.mock('@renderer/components/overlays/context-menu', () => ({
  useContextMenuTrigger: () => ({
    ref: mocks.triggerRef,
    onContextMenu: vi.fn(),
  }),
  ContextMenu: {
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Menu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Item: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
      <button type="button" onClick={onSelect}>{children}</button>
    ),
    Separator: () => <hr />,
  },
}));

vi.mock('@renderer/components/overlays/confirm-dialog', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('@renderer/components/layout/sortable-list', () => ({
  useSortableItem: () => ({
    containerRef: mocks.containerRef,
    containerStyle: { opacity: 1 },
    handleProps: { 'data-sortable-handle': 'stage' },
  }),
}));

vi.mock('@renderer/contexts/asset-editor/asset-editor-context', () => ({
  useStageEditor: () => ({
    duplicateStage: mocks.duplicateStage,
    deleteStage: mocks.deleteStage,
    requestNameFocus: mocks.requestNameFocus,
  }),
}));

vi.mock('./screen-context', () => ({
  useStageEditorScreen: () => ({
    actions: {
      selectStage: mocks.selectStage,
    },
  }),
}));

beforeEach(() => {
  mocks.buildRenderScene.mockReturnValue({ width: 1920, height: 1080 });
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeStage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stage-1',
    name: 'Stage 1',
    width: 1920,
    height: 1080,
    background: null,
    elements: [],
    ...overrides,
  } as never;
}

describe('StageListItemBody', () => {
  it('renders previews through LazySceneStage and keeps the row selectable/sortable', () => {
    render(<StageListItemBody stage={makeStage()} index={0} isActive={false} />);

    const tile = screen.getByTestId('stage-tile');
    expect(screen.getByTestId('lazy-scene-stage').getAttribute('data-surface')).toBe('list');
    expect(tile.getAttribute('data-sortable-handle')).toBe('stage');

    fireEvent.click(tile);
    expect(mocks.selectStage).toHaveBeenCalledWith('stage-1');
  });

  it('does not rebuild the scene when unrelated row state changes', () => {
    const elements: unknown[] = [];
    const background = null;
    const { rerender } = render(
      <StageListItemBody
        stage={makeStage({ name: 'Stage 1', elements, background })}
        index={0}
        isActive={false}
      />,
    );

    rerender(
      <StageListItemBody
        stage={makeStage({ name: 'Renamed Stage', elements, background })}
        index={0}
        isActive
      />,
    );

    expect(mocks.buildRenderScene).toHaveBeenCalledTimes(1);
  });
});
