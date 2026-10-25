import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { RangeSlider } from '@lumacast/ui';

afterEach(cleanup);

function Harness({ initial = [20, 60], onChange, ...rest }: { initial?: [number, number]; onChange?: (v: [number, number]) => void } & Partial<React.ComponentProps<typeof RangeSlider>>) {
  const [value, setValue] = useState<[number, number]>(initial);
  return <RangeSlider value={value} onValueChange={(v) => { setValue(v); onChange?.(v); }} startLabel="Start of Cue" endLabel="End of Cue" {...rest} />;
}

const thumbs = () => [screen.getByRole('slider', { name: 'Start of Cue' }), screen.getByRole('slider', { name: 'End of Cue' })] as const;

describe('RangeSlider', () => {
  it('exposes two named, focusable sliders with their own value bounds', () => {
    render(<Harness />);
    const [a, b] = thumbs();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(a).toHaveAttribute('aria-valuenow', '20');
    expect(b).toHaveAttribute('aria-valuenow', '60');
    expect(a.tabIndex).toBe(0);
    expect(b.tabIndex).toBe(0);
    // Each thumb is a native range input, so its bounds are the control's bounds.
    for (const t of [a, b]) {
      expect(t).toHaveAttribute('type', 'range');
      expect(t).toHaveAttribute('min', '0');
      expect(t).toHaveAttribute('max', '100');
    }
  });

  it('falls back to In and Out names', () => {
    render(<RangeSlider value={[1, 2]} onValueChange={() => undefined} />);
    expect(screen.getByRole('slider', { name: 'In' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Out' })).toBeInTheDocument();
  });

  it('steps with arrows, coarsely with Shift, and jumps with Home and End', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial={[40, 60]} />);
    const [a, b] = thumbs();
    fireEvent.keyDown(a, { key: 'ArrowLeft' });
    expect(a).toHaveAttribute('aria-valuenow', '39');
    fireEvent.keyDown(a, { key: 'ArrowLeft', shiftKey: true });
    expect(a).toHaveAttribute('aria-valuenow', '29');
    fireEvent.keyDown(a, { key: 'Home' });
    expect(a).toHaveAttribute('aria-valuenow', '0');
    fireEvent.keyDown(b, { key: 'End' });
    expect(b).toHaveAttribute('aria-valuenow', '100');
  });

  it('never lets the handles cross and keeps a minimum range', () => {
    render(<Harness initial={[40, 60]} minRange={5} />);
    const [a, b] = thumbs();
    fireEvent.keyDown(a, { key: 'End' });
    expect(Number(a.getAttribute('aria-valuenow'))).toBe(55);
    expect(b).toHaveAttribute('aria-valuenow', '60');
    fireEvent.keyDown(b, { key: 'Home' });
    expect(Number(b.getAttribute('aria-valuenow'))).toBe(60);
    expect(a).toHaveAttribute('aria-valuenow', '55');
  });

  it('holds the exact minimum range on fractional steps despite float rounding', () => {
    const onCommit = vi.fn();
    render(<Harness initial={[1, 5]} min={0} max={18} step={0.01} minRange={0.1} onCommit={onCommit} />);
    const [a, b] = thumbs();
    fireEvent.keyDown(a, { key: 'End' });
    expect(a).toHaveAttribute('aria-valuenow', '4.9');
    expect(onCommit).toHaveBeenLastCalledWith([4.9, 5]);
    fireEvent.keyDown(b, { key: 'Home' });
    expect(b).toHaveAttribute('aria-valuenow', '5');
  });

  it('defaults the minimum range to one step', () => {
    render(<Harness initial={[40, 60]} step={2} />);
    const [a] = thumbs();
    fireEvent.keyDown(a, { key: 'End' });
    expect(a).toHaveAttribute('aria-valuenow', '58');
  });

  it('renders the playhead as a decorative marker outside the accessibility tree', () => {
    const { container } = render(<Harness playhead={30} />);
    const marker = container.querySelector('[data-playhead]')!;
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(marker.hasAttribute('tabindex')).toBe(false);
    expect(marker.getAttribute('role')).toBeNull();
    expect(marker).toHaveStyle({ left: '30%' });
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });

  it('omits the playhead when none is given', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('[data-playhead]')).toBeNull();
  });

  it('moves the whole range when the filled region is dragged', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(<Harness onChange={onChange} initial={[20, 60]} onCommit={onCommit} />);
    const trackEl = Array.from(container.querySelectorAll('div')).find((el) => el.className.includes('bg-tertiary'))!;
    trackEl.getBoundingClientRect = () => ({ width: 200, left: 0, right: 200, top: 0, bottom: 4, height: 4, x: 0, y: 0, toJSON: () => ({}) });
    const handle = container.querySelector('[data-range-drag]')!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 80, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith([30, 70]);
    fireEvent.pointerMove(handle, { clientX: 1000, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith([60, 100]);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onCommit).toHaveBeenLastCalledWith([60, 100]);
  });

  it('reports a seek position when the track is pressed and dragged, without moving a handle', () => {
    const onSeek = vi.fn();
    const onChange = vi.fn();
    const { container } = render(<RangeSlider value={[20, 60]} onValueChange={onChange} onSeek={onSeek} />);
    const trackEl = Array.from(container.querySelectorAll('div')).find((el) => el.className.includes('bg-tertiary'))!;
    trackEl.getBoundingClientRect = () => ({ width: 200, left: 100, right: 300, top: 0, bottom: 4, height: 4, x: 100, y: 0, toJSON: () => ({}) });
    const layer = container.querySelector('[data-seek]')!;
    fireEvent.pointerDown(layer, { button: 0, clientX: 150, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(25);
    fireEvent.pointerMove(layer, { clientX: 1000, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(100);
    fireEvent.pointerUp(layer, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-seek]')).not.toBeNull();
  });

  it('treats a click on the filled region as a seek and does not commit a range change', () => {
    const onSeek = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(<RangeSlider value={[20, 60]} onValueChange={() => undefined} onCommit={onCommit} onSeek={onSeek} />);
    const trackEl = Array.from(container.querySelectorAll('div')).find((el) => el.className.includes('bg-tertiary'))!;
    trackEl.getBoundingClientRect = () => ({ width: 200, left: 0, right: 200, top: 0, bottom: 4, height: 4, x: 0, y: 0, toJSON: () => ({}) });
    const handle = container.querySelector('[data-range-drag]')!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 80, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(40);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not drag the range when disabled or when draggableRange is off', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<RangeSlider value={[20, 60]} onValueChange={onChange} disabled />);
    const handle = container.querySelector('[data-range-drag]')!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 80, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 120, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<RangeSlider value={[20, 60]} onValueChange={onChange} draggableRange={false} />);
    expect(container.querySelector('[data-range-drag]')).toBeNull();
  });
});
