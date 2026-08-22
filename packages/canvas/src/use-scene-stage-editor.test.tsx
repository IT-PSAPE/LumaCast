import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSceneStageEditor } from './use-scene-stage-editor';

const mocks = vi.hoisted(() => {
  const applyDraftPatch = vi.fn();
  const flushDraftBuffer = vi.fn();

  return {
    applyDraftPatch,
    flushDraftBuffer,
  };
});

vi.mock('./use-scene-stage-shift', () => ({
  useSceneStageShift: () => false,
}));

vi.mock('./use-scene-stage-marquee', () => ({
  useSceneStageMarquee: () => ({
    selectionBox: null,
    handleStageMouseDown: vi.fn(),
    handleStageMouseMove: vi.fn(),
    handleStageMouseUp: vi.fn(),
  }),
}));

vi.mock('./use-scene-stage-draft-buffer', () => ({
  useSceneStageDraftBuffer: () => ({
    applyDraftPatch: mocks.applyDraftPatch,
    flushDraftBuffer: mocks.flushDraftBuffer,
  }),
}));

vi.mock('./scene-node-bounds', () => ({
  bindFixedClientRect: vi.fn(),
}));

function createElement(x: number) {
  return {
    id: 'el-1',
    slideId: 'slide-1',
    type: 'shape',
    x,
    y: 20,
    width: 300,
    height: 180,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    payload: {
      fillEnabled: true,
      fillColor: '#FFFFFF',
      strokeEnabled: false,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as const;
}

function createNode(x: number, y: number) {
  let currentX = x;
  let currentY = y;

  return {
    x: () => currentX,
    y: () => currentY,
    width: () => 300,
    height: () => 180,
    rotation: () => 0,
    scaleX: () => 1,
    scaleY: () => 1,
    position: ({ x: nextX, y: nextY }: { x: number; y: number }) => {
      currentX = nextX;
      currentY = nextY;
    },
    setPosition: (nextX: number, nextY: number) => {
      currentX = nextX;
      currentY = nextY;
    },
    setAttrs: vi.fn(),
    children: [],
  };
}

describe('useSceneStageEditor drag freshness', () => {
  beforeEach(() => {
    mocks.applyDraftPatch.mockReset();
    mocks.flushDraftBuffer.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('seeds drag geometry from the current element state even when a stale callback reference fires after a rerender', () => {
    const scene = {
      width: 1920,
      height: 1080,
      slide: { background: null },
      nodes: [],
    } as never;

    const selectElements = vi.fn();
    const setCanvasInteracting = vi.fn();
    const setDraftElements = vi.fn();
    const commitElementUpdates = vi.fn(async () => undefined);
    const node = createNode(32, 20);
    const initialElement = createElement(10);
    const updatedElement = createElement(22);

    const { result, rerender } = renderHook(
      ({ effectiveElements, baseElements }) => useSceneStageEditor({
        scene,
        editable: true,
        elements: {
          effectiveElements: effectiveElements as never,
          baseElements: baseElements as never,
          selectedElementIds: [],
          selectElements,
          toggleElementSelection: vi.fn(),
          selectElement: vi.fn(),
          clearSelection: vi.fn(),
          setDraftElements,
          commitElementUpdates,
          setCanvasInteracting,
        },
      }),
      {
        initialProps: {
          effectiveElements: [initialElement],
          baseElements: [initialElement],
        },
      },
    );

    const staleHandleNodeDragStart = result.current.handleNodeDragStart;
    result.current.setNodeRef('el-1', node as never);

    rerender({
      effectiveElements: [updatedElement],
      baseElements: [updatedElement],
    });

    staleHandleNodeDragStart('el-1');
    node.setPosition(32, 20);
    result.current.handleNodeDragMove('el-1');

    expect(selectElements).toHaveBeenCalledWith(['el-1']);
    expect(mocks.applyDraftPatch).toHaveBeenCalledWith('el-1', { x: 32, y: 20 });
  });
});
