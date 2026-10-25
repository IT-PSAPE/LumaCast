import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResizeHandle } from '@lumacast/ui';

afterEach(cleanup);

describe('ResizeHandle', () => {
  it('exposes the ARIA separator contract in scalar mode', () => {
    render(<ResizeHandle orientation="horizontal" value={300} min={100} max={500} label="Resize sidebar" />);
    const h = screen.getByRole('separator', { name: 'Resize sidebar' });
    expect(h).toHaveAttribute('tabindex', '0');
    expect(h).toHaveAttribute('aria-orientation', 'vertical');
    expect(h).toHaveAttribute('aria-valuenow', '300');
    expect(h).toHaveAttribute('aria-valuemin', '100');
    expect(h).toHaveAttribute('aria-valuemax', '500');
  });

  it('omits value attributes in delta mode and flips aria-orientation for vertical', () => {
    render(<ResizeHandle orientation="vertical" />);
    const h = screen.getByRole('separator');
    expect(h).toHaveAttribute('aria-orientation', 'horizontal');
    expect(h).not.toHaveAttribute('aria-valuenow');
    expect(h).not.toHaveAttribute('aria-valuemin');
  });

  it('uses Left/Right when horizontal, with step and Shift x10', () => {
    const onValueChange = vi.fn();
    render(<ResizeHandle orientation="horizontal" value={300} min={0} max={1000} onValueChange={onValueChange} />);
    const h = screen.getByRole('separator');
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenLastCalledWith(310);
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    expect(onValueChange).toHaveBeenLastCalledWith(290);
    fireEvent.keyDown(h, { key: 'ArrowRight', shiftKey: true });
    expect(onValueChange).toHaveBeenLastCalledWith(400);
    onValueChange.mockClear();
    fireEvent.keyDown(h, { key: 'ArrowUp' });
    fireEvent.keyDown(h, { key: 'ArrowDown' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('uses Up/Down when vertical and honours a custom step', () => {
    const onValueChange = vi.fn();
    render(<ResizeHandle orientation="vertical" value={200} step={5} onValueChange={onValueChange} />);
    const h = screen.getByRole('separator');
    fireEvent.keyDown(h, { key: 'ArrowDown' });
    expect(onValueChange).toHaveBeenLastCalledWith(205);
    fireEvent.keyDown(h, { key: 'ArrowUp' });
    expect(onValueChange).toHaveBeenLastCalledWith(195);
    onValueChange.mockClear();
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('reverse flips the key direction and clamps to min/max', () => {
    const onValueChange = vi.fn();
    render(<ResizeHandle orientation="horizontal" value={105} min={100} max={110} reverse onValueChange={onValueChange} />);
    const h = screen.getByRole('separator');
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenLastCalledWith(100);
    fireEvent.keyDown(h, { key: 'ArrowLeft', shiftKey: true });
    expect(onValueChange).toHaveBeenLastCalledWith(110);
  });

  it('Home and End jump to min and max', () => {
    const onValueChange = vi.fn();
    render(<ResizeHandle orientation="horizontal" value={300} min={100} max={500} onValueChange={onValueChange} />);
    const h = screen.getByRole('separator');
    fireEvent.keyDown(h, { key: 'Home' });
    expect(onValueChange).toHaveBeenLastCalledWith(100);
    fireEvent.keyDown(h, { key: 'End' });
    expect(onValueChange).toHaveBeenLastCalledWith(500);
  });

  it('Enter calls onReset and prevents default only when provided', () => {
    const onReset = vi.fn();
    const { rerender } = render(<ResizeHandle orientation="horizontal" onReset={onReset} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'Enter' });
    expect(onReset).toHaveBeenCalledTimes(1);
    rerender(<ResizeHandle orientation="horizontal" />);
    expect(fireEvent.keyDown(screen.getByRole('separator'), { key: 'Enter' })).toBe(true);
  });

  it('delta mode reports a start/move/end gesture per key press without value callbacks', () => {
    const calls: string[] = [];
    render(
      <ResizeHandle
        orientation="horizontal"
        onResizeStart={(source) => calls.push(`start:${source}`)}
        onResizeMove={(d) => calls.push(`move:${d}`)}
        onResizeEnd={() => calls.push('end')}
      />,
    );
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(calls).toEqual(['start:keyboard', 'move:-10', 'end']);
  });

  it('delta mode reports cumulative pointer deltas along the right axis', () => {
    const onResizeMove = vi.fn();
    const onResizeStart = vi.fn();
    const onResizeEnd = vi.fn();
    const { rerender } = render(
      <ResizeHandle orientation="horizontal" onResizeStart={onResizeStart} onResizeMove={onResizeMove} onResizeEnd={onResizeEnd} />,
    );
    let h = screen.getByRole('separator');
    fireEvent.pointerMove(h, { clientX: 50 });
    expect(onResizeMove).not.toHaveBeenCalled();
    fireEvent.pointerDown(h, { clientX: 100, clientY: 10, pointerId: 1 });
    expect(onResizeStart).toHaveBeenCalledWith('pointer');
    fireEvent.pointerMove(h, { clientX: 130, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 90, pointerId: 1 });
    expect(onResizeMove.mock.calls.map((c) => c[0])).toEqual([30, -10]);
    fireEvent.pointerUp(h, { pointerId: 1 });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(h, { clientX: 200 });
    expect(onResizeMove).toHaveBeenCalledTimes(2);

    onResizeMove.mockClear();
    rerender(<ResizeHandle orientation="vertical" reverse onResizeMove={onResizeMove} />);
    h = screen.getByRole('separator');
    fireEvent.pointerDown(h, { clientX: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 999, clientY: 140, pointerId: 1 });
    expect(onResizeMove).toHaveBeenLastCalledWith(-40);
  });

  it('scalar mode turns a drag into clamped values from the drag-start value', () => {
    const onValueChange = vi.fn();
    render(<ResizeHandle orientation="horizontal" value={300} min={200} max={400} onValueChange={onValueChange} />);
    const h = screen.getByRole('separator');
    fireEvent.pointerDown(h, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 50, pointerId: 1 });
    expect(onValueChange).toHaveBeenLastCalledWith(350);
    fireEvent.pointerMove(h, { clientX: 5000, pointerId: 1 });
    expect(onValueChange).toHaveBeenLastCalledWith(400);
    fireEvent.pointerCancel(h, { pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 0 });
    expect(onValueChange).toHaveBeenCalledTimes(2);
  });

  it('double click resets', () => {
    const onReset = vi.fn();
    render(<ResizeHandle orientation="horizontal" onReset={onReset} />);
    fireEvent.doubleClick(screen.getByRole('separator'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
