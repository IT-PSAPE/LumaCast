import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NumberField, TextField, Textarea } from '@lumacast/ui';

const noop = () => undefined;

const controls = {
  TextField: (extra: { error?: string; hint?: string }) => <TextField value="" onValueChange={noop} label="Name" {...extra} />,
  NumberField: (extra: { error?: string; hint?: string }) => <NumberField value={1} onValueChange={noop} label="Name" {...extra} />,
  Textarea: (extra: { error?: string; hint?: string }) => <Textarea value="" onValueChange={noop} label="Name" {...extra} />,
};

describe.each(Object.entries(controls))('%s field wiring', (_name, renderControl) => {
  function describedText(control: HTMLElement): string | null {
    const id = control.getAttribute('aria-describedby');
    if (!id) return null;
    const target = document.getElementById(id);
    return target ? (target.textContent ?? '') : null;
  }

  it('marks the control invalid and points aria-describedby at the rendered error', () => {
    render(renderControl({ error: 'Too long' }));
    const control = screen.getByLabelText('Name');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAccessibleDescription('Too long');
    expect(describedText(control)).toBe('Too long');
    expect(screen.getByRole('alert')).toHaveTextContent('Too long');
  });

  it('wires the hint when there is no error', () => {
    render(renderControl({ hint: 'Letters only' }));
    const control = screen.getByLabelText('Name');
    expect(control).not.toHaveAttribute('aria-invalid');
    expect(describedText(control)).toBe('Letters only');
  });

  it('lets the error replace the hint', () => {
    render(renderControl({ hint: 'Letters only', error: 'Required' }));
    const control = screen.getByLabelText('Name');
    expect(describedText(control)).toBe('Required');
    expect(screen.queryByText('Letters only')).toBeNull();
  });

  it('has no aria-describedby without error or hint', () => {
    render(renderControl({}));
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
  });
});
