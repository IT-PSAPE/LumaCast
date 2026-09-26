import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Switch } from '@lumacast/ui';

afterEach(cleanup);

describe('Switch', () => {
  it('renders an accessible, toggleable switch carrying its label as the accessible name', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Auto-fit text" />);
    const control = screen.getByRole('switch', { name: 'Auto-fit text' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
  });

  it('disables via Base UI, blocking clicks and exposing data-disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Auto-fit text" disabled />);
    const control = screen.getByRole('switch', { name: 'Auto-fit text' });
    expect(control.hasAttribute('data-disabled')).toBe(true);
    fireEvent.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
