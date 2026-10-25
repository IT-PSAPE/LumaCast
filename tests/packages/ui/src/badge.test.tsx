import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Badge } from '@lumacast/ui';

afterEach(cleanup);

const ring = (c: HTMLElement) => c.querySelector('span[aria-hidden="true"] > span[aria-hidden="true"]');

describe('Badge pulse', () => {
  it('renders no ring without pulse', () => {
    const { container } = render(<Badge dot>Live</Badge>);
    expect(ring(container)).toBeNull();
  });

  it('forwards pulse to the dot', () => {
    const { container } = render(<Badge dot pulse>Live</Badge>);
    expect(ring(container)).not.toBeNull();
  });

  it('renders nothing extra when pulse is set without dot', () => {
    const { container } = render(<Badge pulse>Live</Badge>);
    expect(ring(container)).toBeNull();
  });

  it.each(['soft', 'solid', 'outline'] as const)('ring inherits the dot colour on %s', (variant) => {
    const { container } = render(<Badge dot pulse variant={variant} tone="success">Live</Badge>);
    const r = ring(container);
    expect(r?.className).toContain('bg-inherit');
    expect(r?.className).not.toMatch(/bg-success/);
  });

  it('solid dot is currentColor so the ring differs from the badge fill', () => {
    const { container } = render(<Badge dot pulse variant="solid" tone="error">Live</Badge>);
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot?.className).toContain('bg-current');
    expect(dot?.className).not.toContain('bg-error');
  });

  it('animates only under motion-safe and keeps a static translucent ring otherwise', () => {
    const { container } = render(<Badge dot pulse>Live</Badge>);
    const cls = ring(container)?.className ?? '';
    expect(cls).toContain('motion-safe:animate-ping');
    expect(cls).not.toMatch(/(^|\s)animate-ping/);
    expect(cls).toContain('opacity-60');
  });
});
