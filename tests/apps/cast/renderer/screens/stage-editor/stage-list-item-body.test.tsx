import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { SelectionModifiers } from '@lumacast/selection';
import { StageListItemBody } from '../../../../../../apps/cast/renderer/screens/stage-editor/stage-list-item-body';
import type { useMultiSelection } from '@lumacast/selection';

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

vi.mock('../../../../../../apps/cast/renderer/screens/stage-editor/screen-context', () => ({
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

function makeSelection(ids: string[] = ['stage-1']): ReturnType<typeof useMultiSelection> {
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

function renderStage(overrides: Partial<ComponentProps<typeof StageListItemBody>> = {}) {
  return render(
    <StageListItemBody
      stage={makeStage()}
      isActive={false}
      selection={makeSelection()}
      onSelect={vi.fn()}
      onContextMenu={vi.fn()}
      {...overrides}
    />,
  );
}

describe('StageListItemBody', () => {
  it('renders previews through LazySceneStage and keeps the row selectable/sortable', () => {
    const onSelect = vi.fn();
    renderStage({ onSelect });

    const tile = screen.getByTestId('stage-tile');
    expect(screen.getByTestId('lazy-scene-stage').getAttribute('data-surface')).toBe('list');
    expect(tile.getAttribute('data-sortable-handle')).toBe('stage');

    fireEvent.click(tile);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not rebuild the scene when unrelated row state changes', () => {
    const elements: unknown[] = [];
    const background = null;
    const { rerender } = renderStage({ stage: makeStage({ name: 'Stage 1', elements, background }) });

    rerender(
      <StageListItemBody
        stage={makeStage({ name: 'Renamed Stage', elements, background })}
        isActive
        selection={makeSelection()}
        onSelect={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    expect(mocks.buildRenderScene).toHaveBeenCalledTimes(1);
  });

  it('confirms a selected group once before deleting each stage', async () => {
    mocks.confirm.mockResolvedValue(true);
    renderStage({ selection: makeSelection(['stage-1', 'stage-2']) });

    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 stages' }));

    await waitFor(() => {
      expect(mocks.deleteStage).toHaveBeenNthCalledWith(1, 'stage-1');
      expect(mocks.deleteStage).toHaveBeenNthCalledWith(2, 'stage-2');
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
});
