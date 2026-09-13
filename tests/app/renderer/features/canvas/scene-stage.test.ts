import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const captureSurfaces = new Map<string, HTMLCanvasElement | null>();
  let currentPixelRatio = 2;
  const canvasElement = document.createElement('canvas');
  const stage = {
    batchDraw: vi.fn(),
    getLayers: () => [{
      getCanvas: () => ({
        getPixelRatio: () => currentPixelRatio,
        setPixelRatio: vi.fn((nextPixelRatio: number) => {
          currentPixelRatio = nextPixelRatio;
        }),
      }),
      getNativeCanvasElement: () => canvasElement,
    }],
  };
  const stageRef = { current: null as typeof stage | null };
  const transformerRef = { current: null };
  const containerRef = { current: null as HTMLDivElement | null };
  const setCaptureSurface = vi.fn((key: string, canvas: HTMLCanvasElement | null) => {
    captureSurfaces.set(key, canvas);
  });
  // Mutable per-test overrides so individual tests can drive selection state
  // (selectedElementIds/effectiveElements) without fighting mockReturnValue
  // persistence across tests; afterEach clears this back to empty.
  const elementsOverrides: Record<string, unknown> = {};
  const useElements = vi.fn(() => ({
    selectedElementIds: [],
    selectElements: vi.fn(),
    toggleElementSelection: vi.fn(),
    selectElement: vi.fn(),
    clearSelection: vi.fn(),
    effectiveElements: [],
    baseElements: [],
    setDraftElements: vi.fn(),
    commitElementUpdates: vi.fn(),
    setCanvasInteracting: vi.fn(),
    reorderElements: vi.fn().mockResolvedValue(undefined),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    pasteSelection: vi.fn(),
    duplicateSelection: vi.fn(),
    deleteSelected: vi.fn(),
    groupSelection: vi.fn().mockResolvedValue(null),
    ungroupSelection: vi.fn().mockResolvedValue([]),
    alignSelection: vi.fn().mockResolvedValue(undefined),
    distributeSelection: vi.fn().mockResolvedValue(undefined),
    ...elementsOverrides,
  }));
  const useSceneStageEditor = vi.fn(() => ({
    stageRef,
    transformerRef,
    editingTextId: null,
    guideLines: [],
    selectionBox: null,
    effectiveElements: [],
    shiftPressed: false,
    handleStageMouseDown: vi.fn(),
    handleStageMouseMove: vi.fn(),
    handleStageMouseUp: vi.fn(),
    handleNodeSelect: vi.fn(),
    handleNodeDoubleClick: vi.fn(),
    handleNodeDragStart: vi.fn(),
    handleNodeDragMove: vi.fn(),
    handleNodeDragEnd: vi.fn(),
    handleNodeTransform: vi.fn(),
    handleNodeTransformEnd: vi.fn(),
    setNodeRef: vi.fn(),
    commitTextEdit: vi.fn(),
    cancelTextEdit: vi.fn(),
    liveUpdateTextEdit: vi.fn(),
  }));
  const useSceneStageViewport = vi.fn((sceneWidth: number, sceneHeight: number, fixedViewport: { width: number; height: number } | null) => ({
    containerRef,
    viewportWidth: fixedViewport?.width ?? sceneWidth,
    viewportHeight: fixedViewport?.height ?? sceneHeight,
    sceneScale: 1,
    sceneOffsetX: 0,
    sceneOffsetY: 0,
    displayScale: 1,
  }));

  return {
    canvasElement,
    captureSurfaces,
    containerRef,
    currentPixelRatio: () => currentPixelRatio,
    resetPixelRatio: (pixelRatio = 2) => {
      currentPixelRatio = pixelRatio;
    },
    setCaptureSurface,
    stage,
    stageRef,
    transformerRef,
    elementsOverrides,
    useElements,
    useSceneStageEditor,
    useSceneStageViewport,
  };
});

const h = React.createElement;

vi.mock('react-konva', async () => {
  const ReactModule = await import('react');

  const Stage = ReactModule.forwardRef<unknown, { children?: React.ReactNode }>(({ children }, ref) => {
    if (typeof ref === 'function') {
      ref(mocks.stage);
    } else if (ref && typeof ref === 'object') {
      (ref as { current: unknown }).current = mocks.stage;
    }
    mocks.stageRef.current = mocks.stage;
    return h('div', { 'data-testid': 'stage' }, children);
  });

  const Layer = ({ children }: { children?: React.ReactNode }) => h('div', null, children);
  const Group = ({ children }: { children?: React.ReactNode }) => h('div', null, children);
  const Rect = () => h('div');
  const Line = () => h('div');
  const Transformer = ReactModule.forwardRef<unknown, Record<string, unknown>>((_props, ref) => {
    if (typeof ref === 'function') {
      ref(null);
    } else if (ref && typeof ref === 'object') {
      (ref as { current: unknown }).current = null;
    }
    return h('div');
  });

  return { Stage, Layer, Group, Rect, Line, Transformer };
});

vi.mock('../../../../../app/renderer/contexts/canvas/canvas-context', () => ({
  useElements: mocks.useElements,
}));

vi.mock('../../../../../app/renderer/contexts/element/use-element-history', () => ({
  hasClipboardContent: () => false,
}));

vi.mock('@lumacast/composition', () => ({
  traverseSceneNodes: (nodes: unknown[]) => nodes.map((node, index) => ({ node, order: index })),
}));

vi.mock('@lumacast/canvas', () => ({
  SceneSlideBackground: () => null,
  useSceneStageEditor: mocks.useSceneStageEditor,
  useSceneStageViewport: mocks.useSceneStageViewport,
}));

vi.mock('../../../../../app/renderer/features/canvas/scene-node', () => ({
  SceneNode: () => null,
}));

vi.mock('../../../../../app/renderer/features/canvas/inline-text-editor', () => ({
  InlineTextEditor: () => null,
}));

vi.mock('../../../../../app/renderer/components/overlays/context-menu', () => {
  // A minimal stand-in that renders every menu item as plain DOM so tests can
  // query by text and inspect `disabled`, without the real Base UI popup
  // positioning/portal machinery. The real component gates the whole tree
  // behind `menuPosition ? <ContextMenu.Root> : null` in scene-stage.tsx, so
  // `Root` here always renders its children once mounted.
  const Root = ({ children }: { children?: React.ReactNode }) => h('div', { 'data-testid': 'context-menu' }, children);
  const Portal = ({ children }: { children?: React.ReactNode }) => h(React.Fragment, null, children);
  const MenuSurface = ({ children }: { children?: React.ReactNode }) => h('div', { role: 'menu' }, children);
  const Item = ({ children, disabled, onSelect }: { children?: React.ReactNode; disabled?: boolean; onSelect?: () => void }) => (
    h('button', { type: 'button', disabled: Boolean(disabled), onClick: () => onSelect?.() }, children)
  );
  const Separator = () => h('hr');
  const Submenu = ({ children, label, disabled }: { children?: React.ReactNode; label?: React.ReactNode; disabled?: boolean }) => (
    h('div', { 'data-submenu': String(label), 'data-disabled': String(Boolean(disabled)) }, children)
  );
  const ContextMenuMock = Object.assign(Root, { Root, Portal, Menu: MenuSurface, Item, Separator, Submenu });
  return { ContextMenu: ContextMenuMock };
});

vi.mock('../../../../../app/renderer/rendering/capture-surface-registry', () => ({
  getCaptureSurface: (key: string) => mocks.captureSurfaces.get(key) ?? null,
  setCaptureSurface: mocks.setCaptureSurface,
}));

import { getCaptureSurface, setCaptureSurface } from '../../../../../app/renderer/rendering/capture-surface-registry';
import { SceneStage, pinFixedViewportStagePixelRatio, publishCaptureSurface } from '../../../../../app/renderer/features/canvas/scene-stage';

function createStage(pixelRatio = 2) {
  const canvasElement = document.createElement('canvas');
  let currentPixelRatio = pixelRatio;
  const setCurrentPixelRatio = (nextPixelRatio: number) => {
    currentPixelRatio = nextPixelRatio;
  };
  const setPixelRatio = vi.fn((nextPixelRatio: number) => {
    setCurrentPixelRatio(nextPixelRatio);
  });
  const stage = {
    batchDraw: vi.fn(),
    getLayers: () => [{
      getCanvas: () => ({
        getPixelRatio: () => currentPixelRatio,
        setPixelRatio,
      }),
      getNativeCanvasElement: () => canvasElement,
    }],
  };

  return { canvasElement, setCurrentPixelRatio, setPixelRatio, stage };
}

function createScene() {
  return {
    width: 1920,
    height: 1080,
    slide: { background: null },
    nodes: [],
  } as never;
}

afterEach(() => {
  cleanup();
  mocks.captureSurfaces.clear();
  setCaptureSurface('audience', null);
  mocks.resetPixelRatio();
  mocks.setCaptureSurface.mockClear();
  mocks.stage.batchDraw.mockClear();
  mocks.stageRef.current = null;
  mocks.useElements.mockClear();
  mocks.useSceneStageEditor.mockClear();
  mocks.useSceneStageViewport.mockClear();
  for (const key of Object.keys(mocks.elementsOverrides)) delete mocks.elementsOverrides[key];
  vi.restoreAllMocks();
});

describe('scene-stage capture pixel ratio', () => {
  it('pins fixed-viewport capture layers to pixel ratio 1', () => {
    const { setPixelRatio, stage } = createStage(2);

    pinFixedViewportStagePixelRatio(stage as never, { width: 1920, height: 1080 });

    expect(setPixelRatio).toHaveBeenCalledWith(1);
    expect(stage.batchDraw).toHaveBeenCalledTimes(1);
  });

  it('re-applies pixel ratio when the fixed viewport changes', () => {
    const { setCurrentPixelRatio, setPixelRatio, stage } = createStage(2);

    pinFixedViewportStagePixelRatio(stage as never, { width: 1920, height: 1080 });
    setCurrentPixelRatio(2);
    pinFixedViewportStagePixelRatio(stage as never, { width: 1280, height: 720 });

    expect(setPixelRatio).toHaveBeenCalledTimes(2);
    expect(stage.batchDraw).toHaveBeenCalledTimes(2);
  });

  it('leaves non-fixed stages untouched', () => {
    const { setPixelRatio, stage } = createStage(2);

    pinFixedViewportStagePixelRatio(stage as never, null);

    expect(setPixelRatio).not.toHaveBeenCalled();
    expect(stage.batchDraw).not.toHaveBeenCalled();
  });

  it('publishes the same canvas element after applying the fixed-viewport ratio', () => {
    const { canvasElement, stage } = createStage(2);

    publishCaptureSurface(stage as never, { width: 1920, height: 1080 }, 'audience');

    expect(getCaptureSurface('audience')).toBe(canvasElement);
  });

  it('does not clear the shared capture surface when rerendered with an equivalent fixed viewport object', () => {
    const scene = createScene();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const { rerender } = render(
      h(SceneStage, {
        scene,
        fixedViewport: { width: 1920, height: 1080 },
        ndiCaptureSource: 'audience',
      }),
    );

    expect(getCaptureSurface('audience')).toBe(mocks.canvasElement);
    mocks.setCaptureSurface.mockClear();

    rerender(
      h(SceneStage, {
        scene,
        fixedViewport: { width: 1920, height: 1080 },
        ndiCaptureSource: 'audience',
      }),
    );

    expect(mocks.setCaptureSurface).not.toHaveBeenCalledWith('audience', null);
    expect(getCaptureSurface('audience')).toBe(mocks.canvasElement);
  });

  it('skips read-only stage rerenders when the parent rerenders with identical scene props', () => {
    const scene = createScene();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const { rerender } = render(
      h(SceneStage, {
        scene,
        fixedViewport: { width: 1920, height: 1080 },
        ndiCaptureSource: 'audience',
      }),
    );

    expect(mocks.useSceneStageViewport).toHaveBeenCalledTimes(1);

    rerender(
      h(SceneStage, {
        scene,
        fixedViewport: { width: 1920, height: 1080 },
        ndiCaptureSource: 'audience',
      }),
    );

    expect(mocks.useSceneStageViewport).toHaveBeenCalledTimes(1);
    expect(mocks.useElements).not.toHaveBeenCalled();
    expect(mocks.useSceneStageEditor).not.toHaveBeenCalled();
  });

  it('keeps read-only capture surfaces off the editable hooks and clears the published canvas on unmount', () => {
    const scene = createScene();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const { unmount } = render(
      h(SceneStage, {
        scene,
        fixedViewport: { width: 1920, height: 1080 },
        ndiCaptureSource: 'audience',
      }),
    );

    expect(mocks.useElements).not.toHaveBeenCalled();
    expect(mocks.useSceneStageEditor).not.toHaveBeenCalled();
    expect(getCaptureSurface('audience')).toBe(mocks.canvasElement);

    unmount();

    expect(mocks.setCaptureSurface).toHaveBeenLastCalledWith('audience', null);
  });
});

describe('scene-stage editable context menu — group/align/distribute items', () => {
  function openMenu() {
    const scene = createScene();
    const { container } = render(h(SceneStage, { scene, editable: true }));
    const root = container.firstElementChild as HTMLElement;
    fireEvent.contextMenu(root);
    return container;
  }

  function findButton(container: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);
    if (!button) throw new Error(`No menu item found for "${label}"`);
    return button as HTMLButtonElement;
  }

  function findSubmenu(container: HTMLElement, label: string): HTMLElement {
    const submenu = container.querySelector(`[data-submenu="${label}"]`);
    if (!submenu) throw new Error(`No submenu found for "${label}"`);
    return submenu as HTMLElement;
  }

  it('disables Group with fewer than 2 selected and enables it with 2+', () => {
    mocks.elementsOverrides.selectedElementIds = ['a'];
    expect(findButton(openMenu(), 'Group').disabled).toBe(true);
    cleanup();

    mocks.elementsOverrides.selectedElementIds = ['a', 'b'];
    expect(findButton(openMenu(), 'Group').disabled).toBe(false);
  });

  it('enables Ungroup only when exactly one selected element is a group', () => {
    mocks.elementsOverrides.selectedElementIds = ['group-1'];
    mocks.elementsOverrides.effectiveElements = [{ id: 'group-1', type: 'group' } as never];
    expect(findButton(openMenu(), 'Ungroup').disabled).toBe(false);
    cleanup();

    mocks.elementsOverrides.selectedElementIds = ['shape-1'];
    mocks.elementsOverrides.effectiveElements = [{ id: 'shape-1', type: 'shape' } as never];
    expect(findButton(openMenu(), 'Ungroup').disabled).toBe(true);
    cleanup();

    mocks.elementsOverrides.selectedElementIds = ['group-1', 'shape-1'];
    mocks.elementsOverrides.effectiveElements = [
      { id: 'group-1', type: 'group' } as never,
      { id: 'shape-1', type: 'shape' } as never,
    ];
    expect(findButton(openMenu(), 'Ungroup').disabled).toBe(true);
  });

  it('disables the Align submenu with no selection and enables it with a selection', () => {
    mocks.elementsOverrides.selectedElementIds = [];
    expect(findSubmenu(openMenu(), 'Align').dataset.disabled).toBe('true');
    cleanup();

    mocks.elementsOverrides.selectedElementIds = ['a'];
    expect(findSubmenu(openMenu(), 'Align').dataset.disabled).toBe('false');
  });

  it('disables the Distribute submenu below 3 selected and enables it at 3+', () => {
    mocks.elementsOverrides.selectedElementIds = ['a', 'b'];
    expect(findSubmenu(openMenu(), 'Distribute').dataset.disabled).toBe('true');
    cleanup();

    mocks.elementsOverrides.selectedElementIds = ['a', 'b', 'c'];
    expect(findSubmenu(openMenu(), 'Distribute').dataset.disabled).toBe('false');
  });

  it('invokes groupSelection when Group is clicked', () => {
    const groupSelection = vi.fn().mockResolvedValue('new-group-id');
    mocks.elementsOverrides.selectedElementIds = ['a', 'b'];
    mocks.elementsOverrides.groupSelection = groupSelection;
    const container = openMenu();

    fireEvent.click(findButton(container, 'Group'));

    expect(groupSelection).toHaveBeenCalledTimes(1);
  });

  it('invokes ungroupSelection when Ungroup is clicked', () => {
    const ungroupSelection = vi.fn().mockResolvedValue(['a', 'b']);
    mocks.elementsOverrides.selectedElementIds = ['group-1'];
    mocks.elementsOverrides.effectiveElements = [{ id: 'group-1', type: 'group' } as never];
    mocks.elementsOverrides.ungroupSelection = ungroupSelection;
    const container = openMenu();

    fireEvent.click(findButton(container, 'Ungroup'));

    expect(ungroupSelection).toHaveBeenCalledTimes(1);
  });

  it('invokes alignSelection with the selection target when 2+ are selected', () => {
    const alignSelection = vi.fn().mockResolvedValue(undefined);
    mocks.elementsOverrides.selectedElementIds = ['a', 'b'];
    mocks.elementsOverrides.alignSelection = alignSelection;
    const container = openMenu();

    fireEvent.click(findButton(container, 'Left'));

    expect(alignSelection).toHaveBeenCalledWith('left', 'selection');
  });

  it('invokes alignSelection with the slide target when exactly 1 is selected', () => {
    const alignSelection = vi.fn().mockResolvedValue(undefined);
    mocks.elementsOverrides.selectedElementIds = ['a'];
    mocks.elementsOverrides.alignSelection = alignSelection;
    const container = openMenu();

    fireEvent.click(findButton(container, 'Middle'));

    expect(alignSelection).toHaveBeenCalledWith('centerY', 'slide');
  });

  it('invokes distributeSelection with the chosen axis', () => {
    const distributeSelection = vi.fn().mockResolvedValue(undefined);
    mocks.elementsOverrides.selectedElementIds = ['a', 'b', 'c'];
    mocks.elementsOverrides.distributeSelection = distributeSelection;
    const container = openMenu();

    fireEvent.click(findButton(container, 'Horizontally'));

    expect(distributeSelection).toHaveBeenCalledWith('horizontal');
  });
});
