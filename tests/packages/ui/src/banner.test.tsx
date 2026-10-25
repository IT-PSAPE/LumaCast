import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Banner, type BannerProps } from '@lumacast/ui';

function region(props: Partial<BannerProps>) {
  const { container } = render(<Banner {...props}>Body</Banner>);
  return container.firstElementChild as HTMLElement;
}

describe('Banner live region', () => {
  it.each(['info', 'success', 'warning'] as const)('%s is a polite status', (tone) => {
    const el = region({ tone });
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el).toHaveAttribute('aria-atomic', 'true');
  });

  it('defaults to info semantics', () => {
    expect(region({})).toHaveAttribute('role', 'status');
  });

  it('error is an assertive alert', () => {
    const el = region({ tone: 'error' });
    expect(el).toHaveAttribute('role', 'alert');
    expect(el).toHaveAttribute('aria-live', 'assertive');
    expect(el).toHaveAttribute('aria-atomic', 'true');
  });

  it('live overrides the tone-derived politeness', () => {
    const assertive = region({ tone: 'info', live: 'assertive' });
    expect(assertive).toHaveAttribute('role', 'alert');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    const polite = region({ tone: 'error', live: 'polite' });
    expect(polite).toHaveAttribute('role', 'status');
    expect(polite).toHaveAttribute('aria-live', 'polite');
  });

  it('live="off" renders no live role and no aria-atomic', () => {
    const el = region({ tone: 'error', live: 'off' });
    expect(el).not.toHaveAttribute('role');
    expect(el).toHaveAttribute('aria-live', 'off');
    expect(el).not.toHaveAttribute('aria-atomic');
  });

  it('names the dismiss control with dismissLabel and calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Banner onDismiss={onDismiss} dismissLabel="Close update notice">Body</Banner>);
    fireEvent.click(screen.getByRole('button', { name: 'Close update notice' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('defaults the dismiss name to "Dismiss" and omits it without onDismiss', () => {
    const { unmount } = render(<Banner onDismiss={() => undefined}>Body</Banner>);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    unmount();
    render(<Banner>Body</Banner>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
