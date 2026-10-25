import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SegmentedControl } from '@lumacast/ui';

afterEach(cleanup);

// FilterChips was replaced by the shared SegmentedControl; this keeps the
// original contract (explicit option parts, selected value reported on click).
describe('observability filter (SegmentedControl)', () => {
  it('renders explicit option parts and reports the selected value', () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl value="all" onValueChange={onValueChange}>
        <SegmentedControl.Label value="all">All</SegmentedControl.Label>
        <SegmentedControl.Label value="error">Errors</SegmentedControl.Label>
      </SegmentedControl>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Errors' }));
    expect(onValueChange).toHaveBeenCalledWith('error');
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Errors' }).getAttribute('aria-pressed')).toBe('false');
  });
});
