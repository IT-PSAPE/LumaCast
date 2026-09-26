import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from '../../../../../apps/chord/renderer/components/field';

afterEach(cleanup);

describe('NumberField', () => {
  it('commits the typed value on blur', () => {
    const onCommit = vi.fn();
    render(<NumberField value={10} onCommit={onCommit} ariaLabel="Size" />);
    const input = screen.getByLabelText('Size');
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(42);
  });

  it('commits on Enter', () => {
    const onCommit = vi.fn();
    render(<NumberField value={10} onCommit={onCommit} ariaLabel="Size" />);
    const input = screen.getByLabelText('Size');
    input.focus();
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(7);
  });

  it('steps by `step` on ArrowUp/ArrowDown, and by step * 10 with Shift', () => {
    const onCommit = vi.fn();
    render(<NumberField value={10} step={2} onCommit={onCommit} ariaLabel="Size" />);
    const input = screen.getByLabelText('Size');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith(12);
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(2);
  });

  it('clamps to min/max', () => {
    const onCommit = vi.fn();
    render(<NumberField value={1} min={0} max={5} onCommit={onCommit} ariaLabel="Size" />);
    const input = screen.getByLabelText('Size');
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(5);
  });

  it('reverts to the previous value on invalid input', () => {
    const onCommit = vi.fn();
    render(<NumberField value={3} onCommit={onCommit} ariaLabel="Size" />);
    const input = screen.getByLabelText('Size');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('3');
  });
});
