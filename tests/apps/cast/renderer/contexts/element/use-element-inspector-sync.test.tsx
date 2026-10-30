import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementInspectorSync } from '../../../../../../apps/cast/renderer/contexts/element/use-element-inspector-sync';

const ELEMENT = {
  id: 'el-1',
  slideId: 'slide-1',
  type: 'shape',
  x: 10,
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
    borderColor: '#000000',
    borderWidth: 0,
    borderRadius: 0,
    strokeEnabled: false,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const;

describe('useElementInspectorSync identity', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps its returned object stable when the inputs are unchanged', async () => {
    const props = {
      selectedElementId: 'el-1',
      isMultiSelection: false,
      baseElements: [ELEMENT] as never,
      isCanvasInteracting: false,
      draftElements: {},
      setDraftElements: vi.fn(),
      saveElementUpdate: vi.fn(async () => undefined),
    };

    const { result, rerender } = renderHook((input) => useElementInspectorSync(input), {
      initialProps: props,
    });

    await waitFor(() => {
      expect(result.current.elementDraft?.x).toBe(10);
    });
    const first = result.current;

    rerender(props);

    expect(result.current).toBe(first);
  });

  it('keeps pending single-element edits while a multi-selection move updates the primary position', async () => {
    vi.useFakeTimers();
    const saveElementUpdate = vi.fn(async () => undefined);
    const props = {
      selectedElementId: 'el-1',
      isMultiSelection: false,
      baseElements: [ELEMENT] as never,
      isCanvasInteracting: false,
      draftElements: {},
      setDraftElements: vi.fn(),
      saveElementUpdate,
    };
    const { result, rerender } = renderHook((input) => useElementInspectorSync(input), {
      initialProps: props,
    });

    await act(async () => {
      result.current.setElementDraft((current) => ({ ...current!, width: 420 }));
      result.current.setElementPayloadDraft({ ...ELEMENT.payload, fillColor: '#FF0000' });
    });

    rerender({ ...props, isMultiSelection: true });
    const movedPrimary = { ...ELEMENT, x: 48, y: 68 };
    rerender({ ...props, isMultiSelection: true, baseElements: [movedPrimary] as never });

    expect(result.current.elementDraft).toMatchObject({ x: 48, y: 68, width: 420 });
    expect(result.current.elementPayloadDraft).toMatchObject({ fillColor: '#FF0000' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(saveElementUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'el-1',
      x: 48,
      y: 68,
      width: 420,
      payload: expect.objectContaining({ fillColor: '#FF0000' }),
    }));
  });
});
