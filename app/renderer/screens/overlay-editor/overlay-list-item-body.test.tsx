import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayListItemBody } from './overlay-list-item-body';

const mocks = vi.hoisted(() => ({
  buildRenderScene: vi.fn(),
  lazySceneStage: vi.fn(),
  selectOverlay: vi.fn(),
  duplicateOverlay: vi.fn(),
  deleteOverlay: vi.fn(),
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
      <button ref={ref} type="button" data-testid="overlay-tile" data-selected={selected ? 'true' : 'false'} {...props}>
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
    handleProps: { 'data-sortable-handle': 'overlay' },
  }),
}));

vi.mock('@renderer/contexts/asset-editor/asset-editor-context', () => ({
  useOverlayEditor: () => ({
    duplicateOverlay: mocks.duplicateOverlay,
    deleteOverlay: mocks.deleteOverlay,
    requestNameFocus: mocks.requestNameFocus,
  }),
}));

vi.mock('./screen-context', () => ({
  useOverlayEditorScreen: () => ({
    actions: {
      selectOverlay: mocks.selectOverlay,
    },
  }),
}));

beforeEach(() => {
  mocks.buildRenderScene.mockReturnValue({ width: 1920, height: 1080 });
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeOverlay(overrides: Record<string, unknown> = {}) {
  return {
    id: 'overlay-1',
    slideId: 'slide-1',
    name: 'Overlay 1',
    enabled: true,
    order: 0,
    background: null,
    elements: [],
    animation: { kind: 'none', durationMs: 0 },
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  } as never;
}

describe('OverlayListItemBody', () => {
  it('renders previews through LazySceneStage and keeps the row selectable/sortable', () => {
    render(<OverlayListItemBody overlay={makeOverlay()} index={0} isActive={false} />);

    const tile = screen.getByTestId('overlay-tile');
    expect(screen.getByTestId('lazy-scene-stage').getAttribute('data-surface')).toBe('list');
    expect(tile.getAttribute('data-sortable-handle')).toBe('overlay');

    fireEvent.click(tile);
    expect(mocks.selectOverlay).toHaveBeenCalledWith('overlay-1');
  });

  it('does not rebuild the scene when unrelated row state changes', () => {
    const elements: unknown[] = [];
    const background = null;
    const { rerender } = render(
      <OverlayListItemBody
        overlay={makeOverlay({ name: 'Overlay 1', elements, background })}
        index={0}
        isActive={false}
      />,
    );

    rerender(
      <OverlayListItemBody
        overlay={makeOverlay({ name: 'Renamed Overlay', elements, background })}
        index={0}
        isActive
      />,
    );

    expect(mocks.buildRenderScene).toHaveBeenCalledTimes(1);
  });
});
