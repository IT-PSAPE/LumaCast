import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReacstButton } from '@renderer/components/controls/button';

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

  it('renders every variant without throwing and keeps the accessible label', () => {
    for (const variant of ['default', 'take', 'danger', 'ghost'] as const) {
      const { unmount } = render(<ReacstButton variant={variant} label={`Do ${variant}`}>{variant}</ReacstButton>);
      expect(screen.getByRole('button', { name: `Do ${variant}` })).not.toBeNull();
      unmount();
    }
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
