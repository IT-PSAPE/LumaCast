import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterChips } from '../../../../../app/renderer/features/observability/filter-chips';

afterEach(cleanup);

describe('FilterChips', () => {
  it('renders explicit option parts and reports the selected value', () => {
    const onChange = vi.fn();
    render(
      <FilterChips.Root value="all" onChange={onChange}>
        <FilterChips.Option value="all">All</FilterChips.Option>
        <FilterChips.Option value="error">Errors</FilterChips.Option>
      </FilterChips.Root>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Errors' }));
    expect(onChange).toHaveBeenCalledWith('error');
    expect(screen.getByRole('button', { name: 'All' }).className).toContain('bg-tertiary');
  });
});
