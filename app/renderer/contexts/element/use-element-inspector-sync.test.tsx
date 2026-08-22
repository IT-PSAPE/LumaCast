import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementInspectorSync } from './use-element-inspector-sync';

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
  });

  it('keeps its returned object stable when the inputs are unchanged', async () => {
    const props = {
      selectedElementId: 'el-1',
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
});
