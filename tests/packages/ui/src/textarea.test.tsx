import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Textarea, type TextareaProps } from '@lumacast/ui';

function setup(props: Partial<TextareaProps> = {}) {
  const onValueChange = vi.fn();
  render(<Textarea value="a" onValueChange={onValueChange} label="Name" {...props} />);
  return { input: screen.getByLabelText('Name') as HTMLTextAreaElement, onValueChange };
}

describe('Textarea escape hatches', () => {
  it('forwards ref to the input', () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    const { input } = setup({ ref });
    expect(ref.current).toBe(input);
  });

  it('supports a callback ref', () => {
    const ref = vi.fn();
    const { input } = setup({ ref });
    expect(ref).toHaveBeenCalledWith(input);
  });

  it('runs the consumer onKeyDown first; preventDefault skips Escape handling', () => {
    const order: string[] = [];
    const swallow = setup({
      commitOn: 'blur',
      onKeyDown: (event) => {
        order.push('consumer');
        event.preventDefault();
      },
    });
    swallow.input.focus();
    fireEvent.keyDown(swallow.input, { key: 'Escape' });
    expect(order).toEqual(['consumer']);
    expect(document.activeElement).toBe(swallow.input);
    cleanup();
    const pass = setup({ commitOn: 'blur', onKeyDown: () => order.push('consumer2') });
    pass.input.focus();
    fireEvent.keyDown(pass.input, { key: 'Escape' });
    expect(order).toEqual(['consumer', 'consumer2']);
    expect(document.activeElement).not.toBe(pass.input);
  });

  it('passes required, autoComplete, spellCheck and autoCapitalize', () => {
    const { input } = setup({ required: true, labelPlacement: 'hidden', autoComplete: 'off', spellCheck: false, autoCapitalize: 'none' });
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('autocapitalize', 'none');
  });
});
