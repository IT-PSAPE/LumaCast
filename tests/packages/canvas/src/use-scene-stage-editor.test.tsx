import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSceneStageEditor } from '../../../../packages/canvas/src/use-scene-stage-editor';

const mocks = vi.hoisted(() => {
  const applyDraftPatch = vi.fn();
  const flushDraftBuffer = vi.fn();

  return {
    applyDraftPatch,
    flushDraftBuffer,
  };
});

vi.mock('../../../../packages/canvas/src/use-scene-stage-shift', () => ({
  useSceneStageShift: () => false,
}));

vi.mock('../../../../packages/canvas/src/use-scene-stage-marquee', () => ({
  useSceneStageMarquee: () => ({
    selectionBox: null,
    handleStageMouseDown: vi.fn(),
    handleStageMouseMove: vi.fn(),
    handleStageMouseUp: vi.fn(),
  }),
}));

vi.mock('../../../../packages/canvas/src/use-scene-stage-draft-buffer', () => ({
  useSceneStageDraftBuffer: () => ({
    applyDraftPatch: mocks.applyDraftPatch,
    flushDraftBuffer: mocks.flushDraftBuffer,
  }),
}));

vi.mock('../../../../packages/canvas/src/scene-node-bounds', () => ({
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

// While a text element is being edited, the box grows to hold what is typed
// and keeps that height on commit; it never shrinks below its authored height.
// jsdom has no canvas, so measurement is the deterministic fallback: a 32px
// line at line-height 1.25 is 40 units tall and 16 units per character wide.
describe('useSceneStageEditor text editing geometry', () => {
  const scene = {
    width: 1920,
    height: 1080,
    slide: { background: null },
    nodes: [],
  } as never;

  function createTextElement(overrides: Record<string, unknown> = {}, payloadOverrides: Record<string, unknown> = {}) {
    return {
      id: 'text-1',
      slideId: 'slide-1',
      type: 'text',
      x: 10,
      y: 100,
      width: 600,
      height: 120,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      payload: {
        text: 'one',
        fontFamily: 'Inter',
        fontSize: 32,
        color: '#ffffff',
        alignment: 'left',
        verticalAlign: 'middle',
        lineHeight: 1.25,
        weight: '400',
        ...payloadOverrides,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    } as never;
  }

  function lines(count: number) {
    return Array.from({ length: count }, (_, index) => ({ runs: [{ text: `line ${index + 1}` }], indent: 0 }));
  }

  function setup(element = createTextElement()) {
    const commitElementUpdates = vi.fn(async () => undefined);
    const setDraftElements = vi.fn();
    const hook = renderHook(() => useSceneStageEditor({
      scene,
      editable: true,
      elements: {
        effectiveElements: [element],
        baseElements: [element],
        selectedElementIds: [],
        selectElements: vi.fn(),
        toggleElementSelection: vi.fn(),
        selectElement: vi.fn(),
        clearSelection: vi.fn(),
        setDraftElements,
        commitElementUpdates,
        setCanvasInteracting: vi.fn(),
      },
    }));
    act(() => {
      hook.result.current.handleNodeDoubleClick('text-1');
    });
    return { hook, commitElementUpdates, setDraftElements };
  }

  beforeEach(() => {
    mocks.applyDraftPatch.mockReset();
    mocks.flushDraftBuffer.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('grows the draft box around text that overflows it while typing', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.liveUpdateTextEdit(lines(5));
    });
    // 5 × 40 = 200 units, centred on the authored 120-unit box at y 100.
    expect(mocks.applyDraftPatch).toHaveBeenCalledWith('text-1', expect.objectContaining({ y: 60, height: 200 }));
    const patch = mocks.applyDraftPatch.mock.calls[0][1] as { payload: { text: string; format: string } };
    expect(patch.payload.text).toBe('line 1\nline 2\nline 3\nline 4\nline 5');
    expect(patch.payload.format).toBe('rich');
  });

  it('returns the draft box to the authored geometry when the text fits again', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.liveUpdateTextEdit(lines(5));
      hook.result.current.liveUpdateTextEdit(lines(2));
    });
    expect(mocks.applyDraftPatch).toHaveBeenLastCalledWith('text-1', expect.objectContaining({ y: 100, height: 120 }));
  });

  it('commits the grown geometry together with the text', async () => {
    const { hook, commitElementUpdates } = setup();
    await act(async () => {
      await hook.result.current.commitTextEdit(lines(5));
    });
    expect(commitElementUpdates).toHaveBeenCalledTimes(1);
    const [updates] = commitElementUpdates.mock.calls[0] as unknown as [Array<Record<string, unknown>>];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(expect.objectContaining({ id: 'text-1', y: 60, height: 200 }));
    expect((updates[0].payload as { text: string }).text).toBe('line 1\nline 2\nline 3\nline 4\nline 5');
    expect(hook.result.current.editingTextId).toBeNull();
  });

  it('commits text that fits without touching the geometry', async () => {
    const { hook, commitElementUpdates } = setup();
    await act(async () => {
      await hook.result.current.commitTextEdit(lines(2));
    });
    const [updates] = commitElementUpdates.mock.calls[0] as unknown as [Array<Record<string, unknown>>];
    expect(updates[0]).not.toHaveProperty('y');
    expect(updates[0]).not.toHaveProperty('height');
  });

  it('does not commit anything when the text is unchanged, even if it overflows', async () => {
    const element = createTextElement({ height: 40 }, { text: 'line 1\nline 2\nline 3', format: 'plain' });
    const { hook, commitElementUpdates } = setup(element);
    await act(async () => {
      await hook.result.current.commitTextEdit(lines(3));
    });
    expect(commitElementUpdates).not.toHaveBeenCalled();
    expect(hook.result.current.editingTextId).toBeNull();
  });

  it('grows a top-aligned box downward and a bottom-aligned box upward', async () => {
    const top = setup(createTextElement({}, { verticalAlign: 'top' }));
    await act(async () => {
      await top.hook.result.current.commitTextEdit(lines(5));
    });
    expect((top.commitElementUpdates.mock.calls[0] as unknown as [Array<Record<string, unknown>>])[0][0]).toEqual(expect.objectContaining({ y: 100, height: 200 }));
    cleanup();

    const bottom = setup(createTextElement({}, { verticalAlign: 'bottom' }));
    await act(async () => {
      await bottom.hook.result.current.commitTextEdit(lines(5));
    });
    expect((bottom.commitElementUpdates.mock.calls[0] as unknown as [Array<Record<string, unknown>>])[0][0]).toEqual(expect.objectContaining({ y: 20, height: 200 }));
  });

  it('leaves the geometry of an auto-fit box alone', async () => {
    const { hook, commitElementUpdates } = setup(createTextElement({}, { autoFit: true, autoFitMaxFontSize: 32 }));
    act(() => {
      hook.result.current.liveUpdateTextEdit(lines(9));
    });
    expect(mocks.applyDraftPatch).toHaveBeenLastCalledWith('text-1', expect.objectContaining({ y: 100, height: 120 }));
    await act(async () => {
      await hook.result.current.commitTextEdit(lines(9));
    });
    const [updates] = commitElementUpdates.mock.calls[0] as unknown as [Array<Record<string, unknown>>];
    expect(updates[0]).not.toHaveProperty('height');
  });
});
