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

function createElement(
  x: number,
  id = 'el-1',
  visualOverrides: { locked?: boolean; visible?: boolean } = {},
) {
  return {
    id,
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
      ...visualOverrides,
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

describe('useSceneStageEditor multi-selection movement', () => {
  const scene = {
    width: 1920,
    height: 1080,
    slide: { background: null },
    nodes: [],
  } as never;

  beforeEach(() => {
    mocks.applyDraftPatch.mockReset();
    mocks.flushDraftBuffer.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('preserves and moves a selected group when drag starts on one of its members', async () => {
    const first = createElement(100, 'el-1');
    const second = { ...createElement(600, 'el-2'), y: 500 };
    const selectedElementIds = ['el-1', 'el-2'];
    const selectElement = vi.fn();
    const selectElements = vi.fn();
    const commitElementUpdates = vi.fn(async () => undefined);
    const nodeA = createNode(first.x, first.y);
    const nodeB = createNode(second.x, second.y);

    const { result } = renderHook(() => useSceneStageEditor({
      scene,
      editable: true,
      elements: {
        effectiveElements: [first, second] as never,
        baseElements: [first, second] as never,
        selectedElementIds,
        selectElements,
        toggleElementSelection: vi.fn(),
        selectElement,
        clearSelection: vi.fn(),
        setDraftElements: vi.fn(),
        commitElementUpdates,
        setCanvasInteracting: vi.fn(),
      },
    }));

    act(() => {
      result.current.setNodeRef('el-1', nodeA as never);
      result.current.setNodeRef('el-2', nodeB as never);
    });

    expect(selectElement).not.toHaveBeenCalled();

    act(() => {
      result.current.handleNodeDragStart('el-1');
      nodeA.setPosition(151, 153);
      result.current.handleNodeDragMove('el-1');
    });

    expect(nodeA.x()).toBe(151);
    expect(nodeA.y()).toBe(153);
    expect(nodeB.x()).toBe(651);
    expect(nodeB.y()).toBe(633);
    expect(mocks.applyDraftPatch).toHaveBeenCalledWith('el-1', { x: 151, y: 153 });
    expect(mocks.applyDraftPatch).toHaveBeenCalledWith('el-2', { x: 651, y: 633 });

    await act(async () => {
      await result.current.handleNodeDragEnd();
    });

    expect(commitElementUpdates).toHaveBeenCalledTimes(1);
    expect(commitElementUpdates).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'el-1', x: 151, y: 153 }),
      expect.objectContaining({ id: 'el-2', x: 651, y: 633 }),
    ]);
  });

  it('keeps a multi-selection when a selected member is clicked and toggles on modifier selection', () => {
    const selectElement = vi.fn();
    const toggleElementSelection = vi.fn();
    const { result } = renderHook(() => useSceneStageEditor({
      scene,
      editable: true,
      elements: {
        effectiveElements: [createElement(100, 'el-1'), createElement(600, 'el-2')] as never,
        baseElements: [],
        selectedElementIds: ['el-1', 'el-2'],
        selectElements: vi.fn(),
        toggleElementSelection,
        selectElement,
        clearSelection: vi.fn(),
        setDraftElements: vi.fn(),
        commitElementUpdates: vi.fn(async () => undefined),
        setCanvasInteracting: vi.fn(),
      },
    }));

    act(() => {
      result.current.handleNodeSelect('el-1', false);
      result.current.handleNodeSelect('el-2', true);
      result.current.handleNodeSelect('el-3', false);
    });

    expect(selectElement).toHaveBeenCalledWith('el-3');
    expect(selectElement).toHaveBeenCalledTimes(1);
    expect(toggleElementSelection).toHaveBeenCalledWith('el-2');
  });

  it('attaches only movable selected nodes to the canvas transformer', () => {
    const first = createElement(100, 'el-1');
    const locked = createElement(600, 'el-locked', { locked: true });
    const hidden = createElement(900, 'el-hidden', { visible: false });
    const nodeA = createNode(first.x, first.y);
    const lockedNode = createNode(locked.x, locked.y);
    const hiddenNode = createNode(hidden.x, hidden.y);
    const transformer = {
      nodes: vi.fn(),
      forceUpdate: vi.fn(),
      getLayer: () => ({ batchDraw: vi.fn() }),
    };

    const { result, rerender } = renderHook(
      ({ selectedElementIds }: { selectedElementIds: string[] }) => useSceneStageEditor({
        scene,
        editable: true,
        elements: {
          effectiveElements: [first, locked, hidden] as never,
          baseElements: [first, locked, hidden] as never,
          selectedElementIds,
          selectElements: vi.fn(),
          toggleElementSelection: vi.fn(),
          selectElement: vi.fn(),
          clearSelection: vi.fn(),
          setDraftElements: vi.fn(),
          commitElementUpdates: vi.fn(async () => undefined),
          setCanvasInteracting: vi.fn(),
        },
      }),
      { initialProps: { selectedElementIds: [] as string[] } },
    );

    act(() => {
      result.current.transformerRef.current = transformer as never;
      result.current.setNodeRef('el-1', nodeA as never);
      result.current.setNodeRef('el-locked', lockedNode as never);
      result.current.setNodeRef('el-hidden', hiddenNode as never);
    });
    rerender({ selectedElementIds: ['el-1', 'el-locked', 'el-hidden'] });

    expect(transformer.nodes).toHaveBeenCalledWith([nodeA]);
    expect(transformer.nodes).not.toHaveBeenCalledWith([nodeA, lockedNode, hiddenNode]);
  });

  it('does not drag, transform, or commit locked and hidden selected elements', async () => {
    const first = createElement(100, 'el-1');
    const locked = createElement(600, 'el-locked', { locked: true });
    const hidden = createElement(900, 'el-hidden', { visible: false });
    const selectedElementIds = ['el-1', 'el-locked', 'el-hidden'];
    const selectElements = vi.fn();
    const commitElementUpdates = vi.fn(async () => undefined);
    const setCanvasInteracting = vi.fn();
    const nodeA = createNode(first.x, first.y);
    const lockedNode = createNode(locked.x, locked.y);
    const hiddenNode = createNode(hidden.x, hidden.y);

    const { result } = renderHook(() => useSceneStageEditor({
      scene,
      editable: true,
      elements: {
        effectiveElements: [first, locked, hidden] as never,
        baseElements: [first, locked, hidden] as never,
        selectedElementIds,
        selectElements,
        toggleElementSelection: vi.fn(),
        selectElement: vi.fn(),
        clearSelection: vi.fn(),
        setDraftElements: vi.fn(),
        commitElementUpdates,
        setCanvasInteracting,
      },
    }));

    act(() => {
      result.current.setNodeRef('el-1', nodeA as never);
      result.current.setNodeRef('el-locked', lockedNode as never);
      result.current.setNodeRef('el-hidden', hiddenNode as never);
      result.current.handleNodeDragStart('el-locked');
    });
    expect(setCanvasInteracting).not.toHaveBeenCalledWith(true);

    act(() => {
      result.current.handleNodeDragStart('el-1');
      nodeA.setPosition(151, 153);
      result.current.handleNodeDragMove('el-1');
    });

    expect(lockedNode.x()).toBe(600);
    expect(lockedNode.y()).toBe(20);
    expect(hiddenNode.x()).toBe(900);
    expect(hiddenNode.y()).toBe(20);
    expect(mocks.applyDraftPatch).not.toHaveBeenCalledWith('el-locked', expect.anything());
    expect(mocks.applyDraftPatch).not.toHaveBeenCalledWith('el-hidden', expect.anything());

    await act(async () => {
      await result.current.handleNodeDragEnd();
    });
    expect(commitElementUpdates).toHaveBeenCalledTimes(1);
    expect(commitElementUpdates).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'el-1', x: 151, y: 153 }),
    ]);

    mocks.applyDraftPatch.mockClear();
    await act(async () => {
      result.current.handleNodeTransform();
      await result.current.handleNodeTransformEnd();
    });

    expect(mocks.applyDraftPatch.mock.calls.every(([id]) => id === 'el-1')).toBe(true);
    expect(commitElementUpdates).toHaveBeenCalledTimes(2);
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

// Group resize (#111 group rendering): a group's live transform intentionally
// never touches its Konva children or the draft state — Konva's own transform
// stack already previews the whole (recursively rendered) subtree scaling
// correctly, for free, so handleNodeTransform no-ops for a group id and
// handleNodeTransformEnd bakes the cumulative scale into the group's own
// geometry and, recursively, into every child's geometry (and non-autoFit
// text font size) exactly once.
describe('useSceneStageEditor group transform', () => {
  const scene = {
    width: 1920,
    height: 1080,
    slide: { background: null },
    nodes: [],
  } as never;

  function createGroupElement() {
    return {
      id: 'group-1',
      slideId: 'slide-1',
      type: 'group',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      payload: {
        locked: false,
        visible: true,
        children: [
          {
            id: 'child-shape',
            slideId: 'slide-1',
            type: 'shape',
            x: 10,
            y: 10,
            width: 50,
            height: 20,
            rotation: 0,
            opacity: 1,
            zIndex: 0,
            layer: 'content',
            payload: { fillEnabled: true, fillColor: '#ffffff', borderColor: '#000000', borderWidth: 0, borderRadius: 0 },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'child-text',
            slideId: 'slide-1',
            type: 'text',
            x: 0,
            y: 40,
            width: 100,
            height: 30,
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            layer: 'content',
            payload: { text: 'hi', fontFamily: 'Arial', fontSize: 20, color: '#ffffff', alignment: 'left' },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as const;
  }

  function createGroupNode(scaleX: number, scaleY: number) {
    return {
      x: () => 100,
      y: () => 100,
      width: () => 200,
      height: () => 100,
      rotation: () => 0,
      scaleX: () => scaleX,
      scaleY: () => scaleY,
      setAttrs: vi.fn(),
      children: [],
    };
  }

  function setup(element: ReturnType<typeof createGroupElement>) {
    const commitElementUpdates = vi.fn(async () => undefined);
    const setDraftElements = vi.fn();
    const hook = renderHook(() => useSceneStageEditor({
      scene,
      editable: true,
      elements: {
        effectiveElements: [element] as never,
        baseElements: [element] as never,
        selectedElementIds: ['group-1'],
        selectElements: vi.fn(),
        toggleElementSelection: vi.fn(),
        selectElement: vi.fn(),
        clearSelection: vi.fn(),
        setDraftElements,
        commitElementUpdates,
        setCanvasInteracting: vi.fn(),
      },
    }));
    return { hook, commitElementUpdates, setDraftElements };
  }

  beforeEach(() => {
    mocks.applyDraftPatch.mockReset();
    mocks.flushDraftBuffer.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not touch the Konva children or the draft while a group is being resized', () => {
    const { hook } = setup(createGroupElement());
    const node = createGroupNode(1.5, 1.2);
    act(() => {
      hook.result.current.setNodeRef('group-1', node as never);
    });

    act(() => {
      hook.result.current.handleNodeTransform();
    });

    expect(node.setAttrs).not.toHaveBeenCalled();
    expect(mocks.applyDraftPatch).not.toHaveBeenCalled();
  });

  it('bakes the cumulative scale into the group and its children exactly once, on transform end', async () => {
    const { hook, commitElementUpdates } = setup(createGroupElement());
    // The Konva Transformer already left the node at 2x width, 1.5x height —
    // handleNodeTransform never touched it (see the test above).
    const node = createGroupNode(2, 1.5);
    act(() => {
      hook.result.current.setNodeRef('group-1', node as never);
    });

    await act(async () => {
      await hook.result.current.handleNodeTransformEnd();
    });

    expect(commitElementUpdates).toHaveBeenCalledTimes(1);
    const [updates] = commitElementUpdates.mock.calls[0] as unknown as [Array<Record<string, unknown>>];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(expect.objectContaining({
      id: 'group-1', x: 100, y: 100, width: 400, height: 150, rotation: 0,
    }));

    const payload = updates[0].payload as { children: Array<Record<string, unknown>> };
    const shapeChild = payload.children.find((child) => child.id === 'child-shape')!;
    // x/width scale by the group's own width ratio (2); y/height by its height ratio (1.5).
    expect(shapeChild).toEqual(expect.objectContaining({ x: 20, y: 15, width: 100, height: 30 }));

    const textChild = payload.children.find((child) => child.id === 'child-text') as { payload: { fontSize: number } };
    // Non-autoFit text scales its font size by the geometric mean of the two ratios.
    expect(textChild.payload.fontSize).toBeCloseTo(20 * Math.sqrt(2 * 1.5));
  });
});
