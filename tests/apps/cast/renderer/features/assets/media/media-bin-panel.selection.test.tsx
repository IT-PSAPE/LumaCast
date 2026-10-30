import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MediaAsset } from '@lumacast/composition';
import { MediaBinPanel } from '../../../../../../../apps/cast/renderer/features/assets/media/media-bin-panel';
import { useKeyboardShortcuts } from '../../../../../../../apps/cast/renderer/hooks/use-keyboard-shortcuts';

function PanelWithGlobalShortcuts() {
  useKeyboardShortcuts();
  return <MediaBinPanel binKind="image" />;
}

const mocks = vi.hoisted(() => ({
  assets: [] as MediaAsset[],
  assignLayer: vi.fn(),
  armVideo: vi.fn(),
  deleteMedia: vi.fn(async (_id: string) => undefined),
  setStatusText: vi.fn(),
  confirm: vi.fn(async () => true),
  duplicateSelection: vi.fn(async () => undefined),
  deleteSelected: vi.fn(async () => undefined),
  workbenchMode: 'item-editor',
}));

vi.mock('../../../../../../../apps/cast/renderer/features/assets/media/use-media-type-bin', () => ({
  useMediaTypeBin: () => ({ mediaAssets: mocks.assets }),
}));

vi.mock('../../../../../../../apps/cast/renderer/contexts/playback/playback-context', () => ({
  usePresentationMediaLayer: () => ({ mediaLayerAssetId: null, videoLayerAssetId: null, setMediaLayerAsset: mocks.assignLayer }),
  useVideo: () => ({ armVideo: mocks.armVideo }),
}));

vi.mock('../../../../../../../apps/cast/renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => ({
    deleteMedia: mocks.deleteMedia,
    selectedElementId: 'canvas-element',
    effectiveElements: [],
    selectElements: vi.fn(),
    clearSelection: vi.fn(),
    deleteSelected: mocks.deleteSelected,
    nudgeSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    pasteSelection: vi.fn(),
    duplicateSelection: mocks.duplicateSelection,
    groupSelection: vi.fn(async () => undefined),
    ungroupSelection: vi.fn(async () => undefined),
    undo: vi.fn(),
    redo: vi.fn(),
  }),
}));

vi.mock('../../../../../../../apps/cast/renderer/contexts/app-context', () => ({
  useCast: () => ({ setStatusText: mocks.setStatusText, mutatePatch: vi.fn(), undo: vi.fn(), redo: vi.fn() }),
}));

vi.mock('../../../../../../../apps/cast/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: { programMode: 'all', programSingleSurface: 'program', workbenchMode: mocks.workbenchMode },
    actions: { setProgramSingleSurface: vi.fn() },
    overlayStack: { stack: [] },
  }),
}));

vi.mock('../../../../../../../apps/cast/renderer/contexts/slide-context', () => ({
  useSlides: () => ({
    slides: [],
    currentSlide: { id: 'background-slide' },
    activateSlide: vi.fn(),
    takeSlide: vi.fn(),
    goNext: vi.fn(),
    goPrev: vi.fn(),
    deleteSlide: vi.fn(),
  }),
}));

vi.mock('../../../../../../../apps/cast/renderer/features/items/deck-browser-context', () => ({
  useDeckBrowser: () => ({ setSlideBrowserMode: vi.fn() }),
}));

vi.mock('../../../../../../../apps/cast/renderer/features/command-palette/command-palette-context', () => ({
  useCommandPalette: () => ({ open: vi.fn() }),
}));

vi.mock('../../../../../../../apps/cast/renderer/hooks/use-media-derivative', () => ({
  useMediaDerivative: (asset: MediaAsset) => ({ asset, displaySrc: null, status: 'ready' }),
}));

vi.mock('../../../../../../../apps/cast/renderer/features/assets/media/media-thumbnail', () => ({
  MediaThumbnail: () => <div data-testid="media-thumbnail" />,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: `row-${index}`, start: index * 44 })),
    getTotalSize: () => count * 44,
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
    measurementsCache: [],
  }),
}));

vi.mock('@renderer/components/controls/bin-controls', () => ({
  useBinControls: () => ({ state: { viewMode: 'list', grid: null } }),
}));

vi.mock('@lumacast/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumacast/ui')>();
  return { ...actual, useConfirm: () => mocks.confirm };
});

function asset(id: string, name: string): MediaAsset {
  return {
    id,
    name,
    type: 'image',
    src: `managed://${id}`,
    width: 800,
    height: 600,
    duration: null,
    codec: null,
    order: id === 'image-1' ? 0 : 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPanel(withGlobalShortcuts = false) {
  render(withGlobalShortcuts ? <PanelWithGlobalShortcuts /> : <MediaBinPanel binKind="image" />);
  return {
    first: screen.getByRole('button', { name: /First\s*image/ }),
    second: screen.getByRole('button', { name: /Second\s*image/ }),
  };
}

afterEach(() => {
  cleanup();
  mocks.assets = [];
  vi.clearAllMocks();
});

describe('MediaBinPanel selection', () => {
  it('modifier clicks select resources without assigning them to a live layer', () => {
    mocks.assets = [asset('image-1', 'First'), asset('image-2', 'Second')];
    const { first, second } = renderPanel();

    fireEvent.click(first, { ctrlKey: true });
    fireEvent.click(second, { shiftKey: true });

    expect(mocks.assignLayer).not.toHaveBeenCalled();
    expect(first.className).toContain('bg-tertiary');
    expect(second.className).toContain('bg-tertiary');
  });

  it('confirms once and deletes selected resources in visible order from the keyboard action', async () => {
    mocks.assets = [asset('image-1', 'First'), asset('image-2', 'Second')];
    const { first, second } = renderPanel();

    fireEvent.click(first, { ctrlKey: true });
    fireEvent.click(second, { ctrlKey: true });
    fireEvent.keyDown(second, { key: 'Delete' });

    await waitFor(() => expect(mocks.deleteMedia).toHaveBeenCalledTimes(2));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.deleteMedia.mock.calls).toEqual([['image-1'], ['image-2']]);
  });

  it('uses the selected group when the context menu opens on a selected resource', async () => {
    mocks.assets = [asset('image-1', 'First'), asset('image-2', 'Second')];
    const { first, second } = renderPanel();

    fireEvent.click(first, { ctrlKey: true });
    fireEvent.click(second, { ctrlKey: true });
    fireEvent.contextMenu(second, { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => expect(mocks.deleteMedia).toHaveBeenCalledTimes(2));
    expect(mocks.deleteMedia.mock.calls).toEqual([['image-1'], ['image-2']]);
  });

  it('limits an unselected context-menu target to the clicked resource', async () => {
    mocks.assets = [asset('image-1', 'First'), asset('image-2', 'Second')];
    const { first, second } = renderPanel();

    fireEvent.click(first, { ctrlKey: true });
    fireEvent.contextMenu(second, { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => expect(mocks.deleteMedia).toHaveBeenCalledTimes(1));
    expect(mocks.deleteMedia.mock.calls).toEqual([['image-2']]);
  });

  it('plain click keeps the existing live layer assignment', () => {
    mocks.assets = [asset('image-1', 'First'), asset('image-2', 'Second')];
    const { second } = renderPanel();

    fireEvent.click(second);

    expect(mocks.assignLayer).toHaveBeenCalledWith('image-2');
  });

  it('keeps app shortcuts from mutating the background canvas while a resource row has focus', () => {
    mocks.assets = [asset('image-1', 'First'), asset('image-2', 'Second')];
    const { second } = renderPanel(true);

    fireEvent.keyDown(second, { key: 'd', metaKey: true });

    expect(mocks.duplicateSelection).not.toHaveBeenCalled();
    expect(mocks.deleteSelected).not.toHaveBeenCalled();
  });
});
