import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Checkbox } from '@lumacast/ui';

afterEach(cleanup);

describe('Checkbox', () => {
  it('renders an accessible, toggleable checkbox carrying its label as the accessible name', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} label="Include audio" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Include audio' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(checkbox);
    // Base UI's onCheckedChange also passes an eventDetails object; the
    // package's own contract to its caller is a plain `(checked: boolean) => void`.
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
  });

  it('renders the visible label text next to the box', () => {
    render(<Checkbox checked onCheckedChange={vi.fn()} label="Include audio" />);
    expect(screen.getByText('Include audio')).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Include audio' })).toHaveAttribute('aria-checked', 'true');
  });

  it('disables via Base UI, blocking clicks and exposing data-disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} label="Include audio" disabled />);
    const checkbox = screen.getByRole('checkbox', { name: 'Include audio' });
    expect(checkbox.hasAttribute('data-disabled')).toBe(true);
    fireEvent.click(checkbox);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
