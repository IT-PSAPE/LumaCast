import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSceneStageMarquee } from '../../../../packages/canvas/src/use-scene-stage-marquee';

interface Pointer {
  x: number;
  y: number;
}

function createHarness(selectedElementIds: string[] = []) {
  const pointer: Pointer = { x: 0, y: 0 };
  const stage = {
    getPointerPosition: () => pointer,
    getClassName: () => 'Stage',
    hasName: () => false,
    getStage: () => stage,
  };
  const nodeRefs = {
    current: new Map([
      ['visible', { getClientRect: () => ({ x: 10, y: 10, width: 20, height: 20 }) }],
      ['locked', { getClientRect: () => ({ x: 30, y: 30, width: 20, height: 20 }) }],
      ['hidden', { getClientRect: () => ({ x: 50, y: 50, width: 20, height: 20 }) }],
    ]),
  };
  const selectElements = vi.fn();
  const clearSelection = vi.fn();
  const hook = renderHook(() => useSceneStageMarquee({
    editable: true,
    stageRef: { current: stage } as never,
    nodeRefs: nodeRefs as never,
    selectedElementIds,
    movableElementIds: new Set(['visible']),
    selectElements,
    clearSelection,
  }));

  function mouseDown(options: MouseEventInit = {}) {
    act(() => {
      hook.result.current.handleStageMouseDown({
        evt: new MouseEvent('mousedown', { button: 0, ...options }),
        target: stage,
      } as never);
    });
  }

  return { ...hook, pointer, selectElements, clearSelection, mouseDown };
}

describe('useSceneStageMarquee', () => {
  afterEach(() => cleanup());

  it('replaces the selection with movable visible hits', () => {
    const harness = createHarness(['previous']);
    harness.mouseDown();
    expect(harness.clearSelection).toHaveBeenCalledTimes(1);

    act(() => {
      harness.pointer.x = 100;
      harness.pointer.y = 100;
      harness.result.current.handleStageMouseMove();
    });
    act(() => harness.result.current.handleStageMouseUp());

    expect(harness.selectElements).toHaveBeenCalledWith(['visible']);
    expect(harness.selectElements).not.toHaveBeenCalledWith(expect.arrayContaining(['locked', 'hidden']));
  });

  it.each([
    ['Shift', { shiftKey: true }],
    ['Control', { ctrlKey: true }],
    ['Command', { metaKey: true }],
  ])('adds movable hits to the selection on a %s marquee', (_modifier, modifiers) => {
    const harness = createHarness(['previous']);
    harness.mouseDown(modifiers);
    expect(harness.clearSelection).not.toHaveBeenCalled();

    act(() => {
      harness.pointer.x = 100;
      harness.pointer.y = 100;
      harness.result.current.handleStageMouseMove();
    });
    act(() => harness.result.current.handleStageMouseUp());

    expect(harness.selectElements).toHaveBeenCalledWith(['previous', 'visible']);
    expect(harness.selectElements).not.toHaveBeenCalledWith(expect.arrayContaining(['locked', 'hidden']));
  });

  it.each([1, 2])('does not start a marquee from mouse button %i', (button) => {
    const harness = createHarness(['previous']);
    act(() => {
      harness.result.current.handleStageMouseDown({
        evt: new MouseEvent('mousedown', { button }),
        target: {
          getPointerPosition: () => harness.pointer,
          getClassName: () => 'Stage',
          hasName: () => false,
          getStage: () => null,
        },
      } as never);
    });

    expect(harness.result.current.selectionBox).toBeNull();
    expect(harness.clearSelection).not.toHaveBeenCalled();
    act(() => harness.result.current.handleStageMouseUp());
    expect(harness.selectElements).not.toHaveBeenCalled();
  });
});
