import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSlideRangeSelection } from '../../../../../apps/cast/renderer/hooks/use-slide-range-selection';

afterEach(cleanup);

describe('useSlideRangeSelection', () => {
  it('selects one slide normally and extends a contiguous range from a stable anchor', () => {
    const ids = ['slide-1', 'slide-2', 'slide-3', 'slide-4'];
    const { result } = renderHook(() => useSlideRangeSelection(ids, 0, 'presentation:item-1'));

    act(() => result.current.selectSlide(1, false));
    expect([...result.current.selectedSlideIds]).toEqual(['slide-2']);

    act(() => result.current.selectSlide(3, true));
    expect([...result.current.selectedSlideIds]).toEqual(['slide-2', 'slide-3', 'slide-4']);

    act(() => result.current.selectSlide(2, true));
    expect([...result.current.selectedSlideIds]).toEqual(['slide-2', 'slide-3']);
  });

  it('targets the selected range only when the context-clicked slide belongs to it', () => {
    const ids = ['slide-1', 'slide-2', 'slide-3', 'slide-4'];
    const { result } = renderHook(() => useSlideRangeSelection(ids, 0, 'presentation:item-1'));

    act(() => result.current.selectSlide(2, true));

    expect(result.current.actionSlideIds('slide-2')).toEqual(['slide-1', 'slide-2', 'slide-3']);
    expect(result.current.actionSlideIds('slide-4')).toEqual(['slide-4']);
  });

  it('toggles discontiguous slides and starts the next range at the last clicked slide', () => {
    const ids = ['slide-1', 'slide-2', 'slide-3', 'slide-4'];
    const { result } = renderHook(() => useSlideRangeSelection(ids, 0, 'presentation:item-1'));

    act(() => result.current.selectSlide(0, false));
    act(() => result.current.selectSlide(2, false, true));
    expect([...result.current.selectedSlideIds]).toEqual(['slide-1', 'slide-3']);

    act(() => result.current.selectSlide(3, true));
    expect([...result.current.selectedSlideIds]).toEqual(['slide-3', 'slide-4']);

    act(() => result.current.selectSlide(2, false, true));
    expect([...result.current.selectedSlideIds]).toEqual(['slide-4']);
  });

  it('keeps the active slide independent from the range anchor after a modifier toggle', () => {
    const ids = ['slide-1', 'slide-2', 'slide-3', 'slide-4'];
    const { result } = renderHook(() => useSlideRangeSelection(ids, 0, 'presentation:item-1'));

    act(() => result.current.selectSlide(2, false, true));
    act(() => result.current.selectSlide(3, true));

    expect([...result.current.selectedSlideIds]).toEqual(['slide-3', 'slide-4']);
  });

  it('keeps a multi-selection when reorder persistence temporarily changes the active slide', () => {
    const ids = ['slide-1', 'slide-2', 'slide-3', 'slide-4'];
    const { result, rerender } = renderHook(
      ({ activeIndex }) => useSlideRangeSelection(ids, activeIndex, 'presentation:item-1'),
      { initialProps: { activeIndex: 0 } },
    );

    act(() => result.current.selectSlide(2, false, true));
    rerender({ activeIndex: 2 });

    expect([...result.current.selectedSlideIds]).toEqual(['slide-1', 'slide-3']);
  });

  it('resets the anchor and selection when the owning item changes', () => {
    const ids = ['slide-1', 'slide-2', 'slide-3'];
    const { result, rerender } = renderHook(
      ({ scopeKey, activeIndex }) => useSlideRangeSelection(ids, activeIndex, scopeKey),
      { initialProps: { scopeKey: 'presentation:item-1', activeIndex: 0 } },
    );

    act(() => result.current.selectSlide(2, true));
    rerender({ scopeKey: 'presentation:item-2', activeIndex: 1 });

    expect([...result.current.selectedSlideIds]).toEqual(['slide-2']);
  });
});
