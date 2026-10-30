import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { SelectionModifiers } from '@lumacast/selection';
import { OverlayListItemBody } from '../../../../../../apps/cast/renderer/screens/overlay-editor/overlay-list-item-body';
import type { useMultiSelection } from '@lumacast/selection';

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

vi.mock('../../../../../../apps/cast/renderer/features/canvas/build-render-scene', () => ({
  buildRenderScene: (...args: unknown[]) => mocks.buildRenderScene(...args),
}));

vi.mock('../../../../../../apps/cast/renderer/hooks/use-media-proxy-map', () => ({
  useMediaProxyMap: () => mocks.mediaProxyMap,
}));

vi.mock('../../../../../../apps/cast/renderer/components/display/lazy-scene-stage', () => ({
  LazySceneStage: (props: { surface: string; className?: string }) => {
    mocks.lazySceneStage(props);
    return <div data-testid="lazy-scene-stage" data-surface={props.surface} className={props.className} />;
  },
}));

vi.mock('../../../../../../apps/cast/renderer/components/display/thumbnail', async () => {
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

vi.mock('@lumacast/ui', async () => {
  const actual = await vi.importActual<typeof import('@lumacast/ui')>('@lumacast/ui');
  return {
    ...actual,
    useConfirm: () => mocks.confirm,
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
  };
});

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

vi.mock('../../../../../../apps/cast/renderer/screens/overlay-editor/screen-context', () => ({
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

function makeSelection(ids: string[] = ['overlay-1']): ReturnType<typeof useMultiSelection> {
  const selectedIds = ids as Id[];
  const selection = {
    selectedIds: new Set<Id>(selectedIds),
    select: (_id: Id, _modifiers?: SelectionModifiers) => {},
    actionIds: (id: Id) => selectedIds.includes(id) ? selectedIds : [id],
    clearSelection: () => {},
    selectAll: () => {},
  };
  return selection;
}

function renderOverlay(overrides: Partial<ComponentProps<typeof OverlayListItemBody>> = {}) {
  return render(
    <OverlayListItemBody
      overlay={makeOverlay()}
      isActive={false}
      selection={makeSelection()}
      onSelect={vi.fn()}
      onContextMenu={vi.fn()}
      {...overrides}
    />,
  );
}

describe('OverlayListItemBody', () => {
  it('renders previews through LazySceneStage and keeps the row selectable/sortable', () => {
    const onSelect = vi.fn();
    renderOverlay({ onSelect });

    const tile = screen.getByTestId('overlay-tile');
    expect(screen.getByTestId('lazy-scene-stage').getAttribute('data-surface')).toBe('list');
    expect(tile.getAttribute('data-sortable-handle')).toBe('overlay');

    fireEvent.click(tile);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not rebuild the scene when unrelated row state changes', () => {
    const elements: unknown[] = [];
    const background = null;
    const { rerender } = renderOverlay({ overlay: makeOverlay({ name: 'Overlay 1', elements, background }) });

    rerender(
      <OverlayListItemBody
        overlay={makeOverlay({ name: 'Renamed Overlay', elements, background })}
        isActive
        selection={makeSelection()}
        onSelect={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    expect(mocks.buildRenderScene).toHaveBeenCalledTimes(1);
  });

  it('confirms a selected group once before deleting each overlay', async () => {
    mocks.confirm.mockResolvedValue(true);
    renderOverlay({ selection: makeSelection(['overlay-1', 'overlay-2']) });

    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 overlays' }));

    await waitFor(() => {
      expect(mocks.deleteOverlay).toHaveBeenNthCalledWith(1, 'overlay-1');
      expect(mocks.deleteOverlay).toHaveBeenNthCalledWith(2, 'overlay-2');
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
});
