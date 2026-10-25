import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ListRow } from '@lumacast/ui';

afterEach(cleanup);

describe('ListRow', () => {
  it('label truncates inside a shrinkable flex child', () => {
    render(
      <ListRow as="button">
        <ListRow.Label>A very long name</ListRow.Label>
      </ListRow>,
    );
    const cls = screen.getByText('A very long name').className;
    expect(cls).toContain('min-w-0');
    expect(cls).toContain('truncate');
  });

  it('selected: aria-current, data attribute and non-colour cues', () => {
    const { container } = render(
      <ListRow as="button" selected>
        <ListRow.Label>One</ListRow.Label>
      </ListRow>,
    );
    expect(screen.getByRole('button', { name: 'One' }).getAttribute('aria-current')).toBe('true');
    const row = container.firstElementChild as HTMLElement;
    expect(row.hasAttribute('data-selected')).toBe(true);
    expect(row.className).toContain('border-primary');
    expect(screen.getByText('One').className).toContain('font-semibold');
  });

  it('unselected has no aria-current', () => {
    render(
      <ListRow as="button">
        <ListRow.Label>One</ListRow.Label>
      </ListRow>,
    );
    expect(screen.getByRole('button', { name: 'One' }).hasAttribute('aria-current')).toBe(false);
  });

  it('renders the requested element', () => {
    const { rerender } = render(
      <ListRow as="button" onClick={() => {}}>
        <ListRow.Label>X</ListRow.Label>
      </ListRow>,
    );
    expect(screen.getByRole('button', { name: 'X' }).tagName).toBe('BUTTON');
    rerender(
      <ListRow as="a" href="/x">
        <ListRow.Label>X</ListRow.Label>
      </ListRow>,
    );
    expect(screen.getByRole('link', { name: 'X' }).tagName).toBe('A');
    rerender(
      <ListRow as="div" onClick={() => {}}>
        <ListRow.Label>X</ListRow.Label>
      </ListRow>,
    );
    expect(screen.getByRole('button', { name: 'X' }).tagName).toBe('DIV');
    rerender(
      <ListRow>
        <ListRow.Label>X</ListRow.Label>
      </ListRow>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('disabled button does not fire onClick', () => {
    const onClick = vi.fn();
    render(
      <ListRow as="button" disabled onClick={onClick}>
        <ListRow.Label>X</ListRow.Label>
      </ListRow>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Actions are outside the row surface, tabbable, and do not trigger the row', () => {
    const onRow = vi.fn();
    const onAction = vi.fn();
    render(
      <ListRow as="button" onClick={onRow}>
        <ListRow.Label>Scene</ListRow.Label>
        <ListRow.Actions>
          <button type="button" aria-label="Delete" onClick={onAction} />
        </ListRow.Actions>
      </ListRow>,
    );
    const row = screen.getByRole('button', { name: 'Scene' });
    const del = screen.getByRole('button', { name: 'Delete' });
    expect(row.contains(del)).toBe(false);
    expect(del.closest('button:not([aria-label="Delete"]), a, [role="button"]')).toBeNull();
    // Both are natively focusable (button, no tabindex=-1) so both are in tab order.
    for (const el of [row, del]) {
      expect(el.tabIndex).toBe(0);
      el.focus();
      expect(document.activeElement).toBe(el);
    }
    fireEvent.click(del);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('div surface activates with Enter and Space', () => {
    const onClick = vi.fn();
    render(
      <ListRow onClick={onClick}>
        <ListRow.Label>Row</ListRow.Label>
      </ListRow>,
    );
    const row = screen.getByRole('button', { name: 'Row' });
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
