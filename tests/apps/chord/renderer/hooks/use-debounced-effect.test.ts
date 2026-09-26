import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedEffect } from '../../../../../apps/chord/renderer/hooks/use-debounced-effect';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedEffect', () => {
  it('runs the effect once after the delay', () => {
    const effect = vi.fn();
    renderHook(() => useDebouncedEffect(effect, ['a'], 300));
    expect(effect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(effect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('resets the timer when a dependency changes before it fires', () => {
    const effect = vi.fn();
    const { rerender } = renderHook(({ dep }) => useDebouncedEffect(effect, [dep], 300), {
      initialProps: { dep: 'a' },
    });
    vi.advanceTimersByTime(200);
    rerender({ dep: 'b' });
    vi.advanceTimersByTime(200);
    expect(effect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending run on unmount', () => {
    const effect = vi.fn();
    const { unmount } = renderHook(() => useDebouncedEffect(effect, ['a'], 300));
    unmount();
    vi.advanceTimersByTime(500);
    expect(effect).not.toHaveBeenCalled();
  });
});
