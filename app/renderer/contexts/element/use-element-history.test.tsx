import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementHistory } from './use-element-history';

const ELEMENTS = [
  {
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
      strokeEnabled: false,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
] as const;

describe('useElementHistory identity', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps its returned object stable when the inputs are unchanged', () => {
    const props = {
      baseElements: ELEMENTS as never,
      effectiveElements: ELEMENTS as never,
      activeEditorEntityId: 'slide-1',
      hasActiveEditorSource: true,
      historyKey: 'slide-1',
      selectedElementIds: ['el-1'],
      mutatePatch: vi.fn(async () => ({}) as never),
      setStatusText: vi.fn(),
      selectElements: vi.fn(),
      setDraftElements: vi.fn(),
      setCanvasInteracting: vi.fn(),
      saveElementUpdates: vi.fn(async () => undefined),
      replaceElements: vi.fn(async () => undefined),
    };

    const { result, rerender } = renderHook((input) => useElementHistory(input), {
      initialProps: props,
    });

    const first = result.current;

    rerender(props);

    expect(result.current).toBe(first);
  });
});
