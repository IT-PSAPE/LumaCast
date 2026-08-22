import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useElementSelection } from './use-element-selection';

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

describe('useElementSelection identity', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps its returned object stable when the inputs are unchanged', () => {
    const { result, rerender } = renderHook(
      ({ effectiveElements }) => useElementSelection({ effectiveElements: effectiveElements as never }),
      { initialProps: { effectiveElements: ELEMENTS } },
    );

    const first = result.current;

    rerender({ effectiveElements: ELEMENTS });

    expect(result.current).toBe(first);
  });
});
