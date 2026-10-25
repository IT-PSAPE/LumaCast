import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField, type NumberFieldProps } from '@lumacast/ui';

function setup(props: Partial<NumberFieldProps> = {}) {
  const onValueChange = vi.fn();
  render(<NumberField value={10} onValueChange={onValueChange} label="Size" {...props} />);
  const input = screen.getByLabelText('Size') as HTMLInputElement;
  return { input, onValueChange };
}

function type(input: HTMLInputElement, text: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
}

describe('NumberField', () => {
  it('commits on blur, not on keystroke, by default', () => {
    const { input, onValueChange } = setup();
    type(input, '25');
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(25);
  });

  it('commits on Enter', () => {
    const { input, onValueChange } = setup();
    input.focus();
    type(input, '42');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('commits on every valid keystroke with commitOn="change"', () => {
    const { input, onValueChange } = setup({ commitOn: 'change' });
    type(input, '1');
    type(input, '12');
    expect(onValueChange).toHaveBeenNthCalledWith(1, 1);
    expect(onValueChange).toHaveBeenNthCalledWith(2, 12);
  });

  it('steps with the arrow keys', () => {
    const up = setup({ step: 2 });
    fireEvent.keyDown(up.input, { key: 'ArrowUp' });
    expect(up.onValueChange).toHaveBeenCalledExactlyOnceWith(12);
    cleanup();
    const down = setup({ step: 2 });
    fireEvent.keyDown(down.input, { key: 'ArrowDown' });
    expect(down.onValueChange).toHaveBeenCalledExactlyOnceWith(8);
  });

  it('steps by step * 10 with Shift', () => {
    const first = setup({ step: 1 });
    fireEvent.keyDown(first.input, { key: 'ArrowUp', shiftKey: true });
    expect(first.onValueChange).toHaveBeenLastCalledWith(20);
  });

  it('uses largeStep for Shift+Arrow', () => {
    const { input, onValueChange } = setup({ step: 1, largeStep: 5 });
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(onValueChange).toHaveBeenLastCalledWith(5);
  });

  it('clamps stepping to min and max', () => {
    const { input, onValueChange } = setup({ value: 10, max: 11, min: 0, step: 5 });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onValueChange).toHaveBeenLastCalledWith(11);
  });

  it('clamps on commit', () => {
    const { input, onValueChange } = setup({ min: 5, max: 50 });
    type(input, '999');
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenLastCalledWith(50);
    expect(input.value).toBe('50');
  });

  it('does not clamp mid-typing: "10" is reachable with min=5', () => {
    const { input, onValueChange } = setup({ value: 7, min: 5 });
    type(input, '1');
    expect(input.value).toBe('1');
    type(input, '10');
    expect(input.value).toBe('10');
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(10);
  });

  it('does not clamp mid-typing under commitOn="change" for a still-valid result', () => {
    const { input } = setup({ value: 7, min: 5, commitOn: 'change' });
    type(input, '1');
    expect(input.value).toBe('1');
  });

  it.each(['', '   ', 'abc', '1e', '--'])('reverts %j to the last value and never emits NaN', (draft) => {
    const { input, onValueChange } = setup();
    type(input, draft);
    fireEvent.blur(input);
    expect(input.value).toBe('10');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('never emits NaN with commitOn="change" for unparseable text', () => {
    const { input, onValueChange } = setup({ commitOn: 'change' });
    type(input, 'abc');
    type(input, '');
    for (const call of onValueChange.mock.calls) expect(Number.isNaN(call[0])).toBe(false);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('does not emit when the committed value is unchanged', () => {
    const { input, onValueChange } = setup();
    type(input, '10');
    fireEvent.blur(input);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('Escape reverts the draft and the following blur does not commit it', () => {
    const { input, onValueChange } = setup();
    input.focus();
    type(input, '77');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('10');
    fireEvent.blur(input);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(input.value).toBe('10');
  });

  it('commits normally after an Escape cancelled an earlier edit', () => {
    function Harness() {
      const [value, setValue] = useState(10);
      return <NumberField value={value} onValueChange={setValue} label="Size" />;
    }
    render(<Harness />);
    const input = screen.getByLabelText('Size') as HTMLInputElement;
    input.focus();
    type(input, '77');
    fireEvent.keyDown(input, { key: 'Escape' });
    input.focus();
    type(input, '30');
    fireEvent.blur(input);
    expect(input.value).toBe('30');
  });
});
