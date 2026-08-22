import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

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

vi.mock('../../contexts/canvas/canvas-context', () => ({
  useElements: mocks.useElements,
}));

vi.mock('../../contexts/element/use-element-history', () => ({
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

vi.mock('./scene-node', () => ({
  SceneNode: () => null,
}));

vi.mock('./inline-text-editor', () => ({
  InlineTextEditor: () => null,
}));

vi.mock('../../components/overlays/context-menu', () => ({
  ContextMenu: () => null,
}));

vi.mock('../../rendering/capture-surface-registry', () => ({
  getCaptureSurface: (key: string) => mocks.captureSurfaces.get(key) ?? null,
  setCaptureSurface: mocks.setCaptureSurface,
}));

import { getCaptureSurface, setCaptureSurface } from '../../rendering/capture-surface-registry';
import { SceneStage, pinFixedViewportStagePixelRatio, publishCaptureSurface } from './scene-stage';

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
