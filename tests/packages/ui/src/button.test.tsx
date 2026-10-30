import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReacstButton } from '@lumacast/ui';

afterEach(cleanup);

describe('ReacstButton', () => {
  it('renders a real, focusable native button carrying the label and click handler', () => {
    const onClick = vi.fn();
    render(<ReacstButton label="Save" onClick={onClick}>Save</ReacstButton>);
    const button = screen.getByRole('button', { name: 'Save' });
    // A real <button> gets Space/Enter activation for free from the browser
    // (jsdom does not simulate that default action for a raw keydown), so
    // asserting the native tag confirms keyboard users can operate it.
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables via Base UI, blocking clicks and exposing data-disabled', () => {
    const onClick = vi.fn();
    render(<ReacstButton label="Save" disabled onClick={onClick}>Save</ReacstButton>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button.hasAttribute('data-disabled')).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to a type="button" so it never submits an enclosing form', () => {
    render(<ReacstButton label="Save">Save</ReacstButton>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('lays out icon + label in a row: inline-flex, centered, gapped, no wrap', () => {
    render(<ReacstButton label="Save">Save</ReacstButton>);
    const button = screen.getByRole('button', { name: 'Save' });
    for (const rowClass of ['inline-flex', 'items-center', 'justify-center', 'gap-1.5', 'whitespace-nowrap']) {
      expect(button.className).toContain(rowClass);
    }
  });

  it('renders every variant without throwing and keeps the accessible label', () => {
    for (const variant of ['default', 'take', 'success', 'danger', 'ghost'] as const) {
      const { unmount } = render(<ReacstButton variant={variant} label={`Do ${variant}`}>{variant}</ReacstButton>);
      expect(screen.getByRole('button', { name: `Do ${variant}` })).not.toBeNull();
      unmount();
    }
  });

  it('success keeps the shared success styling for resting, active, and disabled buttons', () => {
    const { rerender } = render(<ReacstButton variant="success" label="Transition">Transition</ReacstButton>);
    const button = screen.getByRole('button', { name: 'Transition' });
    expect(button.className).toContain('bg-success/15');
    expect(button.className).toContain('hover:bg-success/25');

    rerender(<ReacstButton variant="success" active label="Transition">Transition</ReacstButton>);
    expect(button.className).toContain('bg-success/15');

    rerender(<ReacstButton variant="success" disabled label="Transition">Transition</ReacstButton>);
    expect(button).toBeDisabled();
    expect(button.hasAttribute('data-disabled')).toBe(true);
    expect(button.className).toContain('data-disabled:opacity-50');
  });

  it('forwards ref to the native button node', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<ReacstButton ref={ref} label="Save">Save</ReacstButton>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Save' }));
    const iconRef = createRef<HTMLButtonElement>();
    render(<ReacstButton.Icon ref={iconRef} label="Close"><svg aria-hidden /></ReacstButton.Icon>);
    expect(iconRef.current).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('shape="pill" renders the pill radius; default stays rounded-control', () => {
    render(<ReacstButton shape="pill" label="Pill">Pill</ReacstButton>);
    const pill = screen.getByRole('button', { name: 'Pill' });
    expect(pill.className).toContain('rounded-full');
    expect(pill.className).not.toContain('rounded-control');
    render(<ReacstButton label="Plain">Plain</ReacstButton>);
    expect(screen.getByRole('button', { name: 'Plain' }).className).toContain('rounded-control');
  });

  it.each([
    ['xs', 'h-[22px]'],
    ['sm', 'h-6'],
    ['lg', 'h-7'],
    ['xl', 'h-[34px]'],
  ] as const)('text size %s renders %s', (size, cls) => {
    render(<ReacstButton size={size} label="S">S</ReacstButton>);
    const button = screen.getByRole('button', { name: 'S' });
    expect(button.className.split(/\s+/)).toContain(cls);
    if (size === 'lg') expect(button.className).not.toContain('h-[34px]');
  });

  it('md keeps its padding metrics with no explicit height', () => {
    render(<ReacstButton label="M">M</ReacstButton>);
    const button = screen.getByRole('button', { name: 'M' });
    expect(button.className).toContain('py-1.5');
    expect(button.className).not.toMatch(/(^|\s)h-/);
  });

  it.each([
    ['xs', 'size-5'],
    ['sm', 'size-6'],
    ['lg', 'size-7'],
    ['xl', 'size-8'],
  ] as const)('icon size %s renders %s', (size, cls) => {
    render(<ReacstButton.Icon size={size} label="I"><svg aria-hidden /></ReacstButton.Icon>);
    expect(screen.getByRole('button', { name: 'I' }).className.split(/\s+/)).toContain(cls);
  });

  describe('ReacstButton.Icon', () => {
    it('renders a native button with an aria-label for the icon-only trigger', () => {
      const onClick = vi.fn();
      render(
        <ReacstButton.Icon label="Close" onClick={onClick}>
          <svg aria-hidden />
        </ReacstButton.Icon>,
      );
      const button = screen.getByRole('button', { name: 'Close' });
      expect(button.tagName).toBe('BUTTON');
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('disables the same way as the root button', () => {
      render(<ReacstButton.Icon label="Close" disabled><svg aria-hidden /></ReacstButton.Icon>);
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    });
  });
});
