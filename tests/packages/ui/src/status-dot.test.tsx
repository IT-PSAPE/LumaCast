import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StatusDot } from '@lumacast/ui';

afterEach(cleanup);

describe('StatusDot', () => {
  it('is hidden without a label and an img with one', () => {
    const { container, rerender } = render(<StatusDot />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    rerender(<StatusDot label="Live" />);
    expect(container.firstElementChild?.getAttribute('role')).toBe('img');
  });

  it('pulse ring inherits the dot background on every tone', () => {
    for (const tone of ['neutral', 'brand', 'success', 'warning', 'error'] as const) {
      const { container, unmount } = render(<StatusDot tone={tone} pulse />);
      const r = container.firstElementChild?.firstElementChild;
      expect(r?.className).toContain('bg-inherit');
      expect(r?.className).toContain('motion-safe:animate-ping');
      unmount();
    }
  });

  it('renders no ring without pulse', () => {
    const { container } = render(<StatusDot />);
    expect(container.firstElementChild?.children.length).toBe(0);
  });
});
