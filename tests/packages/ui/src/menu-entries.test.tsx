import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PointContextMenu, usePointContextMenu, type MenuEntry } from '@lumacast/ui';

// Base UI moves focus on an animation frame, so keyboard/selection assertions
// have to let the frame (and any queued microtasks) run first.
async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

function buildEntries(handlers: { fit: () => void; stretch: () => void; grid: () => void; center: () => void; moveUp: () => void; moveDown: () => void; remove: () => void }): MenuEntry[] {
  return [
    { heading: 'Transform' },
    { id: 'fit', label: 'Fit to Screen', shortcut: '⌘F', onSelect: handlers.fit },
    { id: 'stretch', label: 'Stretch to Screen', checked: true, onSelect: handlers.stretch },
    { id: 'grid', label: 'Show Grid', checked: false, onSelect: handlers.grid },
    { id: 'disabled-item', label: 'Center', disabled: true, onSelect: handlers.center },
    { separator: true },
    {
      id: 'order',
      label: 'Order',
      children: [
        { id: 'order.up', label: 'Move Up', onSelect: handlers.moveUp },
        { id: 'order.down', label: 'Move Down', onSelect: handlers.moveDown },
      ],
    },
    { id: 'delete', label: 'Delete', danger: true, onSelect: handlers.remove },
  ];
}

afterEach(cleanup);

describe('PointContextMenu / MenuEntries', () => {
  it('renders nothing when closed or without a position', () => {
    const handlers = { fit: vi.fn(), stretch: vi.fn(), grid: vi.fn(), center: vi.fn(), moveUp: vi.fn(), moveDown: vi.fn(), remove: vi.fn() };
    const { container, rerender } = render(
      <PointContextMenu open={false} position={null} entries={buildEntries(handlers)} label="Test menu" onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<PointContextMenu open position={null} entries={buildEntries(handlers)} label="Test menu" onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a heading, a separator, shortcuts, checked and disabled state, and danger styling', async () => {
    const handlers = { fit: vi.fn(), stretch: vi.fn(), grid: vi.fn(), center: vi.fn(), moveUp: vi.fn(), moveDown: vi.fn(), remove: vi.fn() };
    render(<PointContextMenu open position={{ x: 10, y: 10 }} entries={buildEntries(handlers)} label="Test menu" onClose={() => {}} />);
    await settle();

    expect(screen.getByRole('menu', { name: 'Test menu' })).not.toBeNull();
    expect(screen.getByText('Transform')).not.toBeNull();
    expect(screen.getByRole('separator')).not.toBeNull();

    const fit = screen.getByText('Fit to Screen').closest('[role="menuitem"]') as HTMLElement;
    expect(fit.textContent).toContain('⌘F');
    // The unchecked item's checkmark slot stays empty.
    expect(fit.querySelector('svg')).toBeNull();

    const disabledItem = screen.getByText('Center').closest('[role="menuitem"]') as HTMLElement;
    expect(disabledItem.getAttribute('data-disabled')).toBe('');

    const deleteItem = screen.getByText('Delete').closest('[role="menuitem"]') as HTMLElement;
    expect(deleteItem.className).toContain('text-error');
  });

  it('renders checked entries as menuitemcheckbox with the right aria-checked, and selecting one fires onSelect', async () => {
    const handlers = { fit: vi.fn(), stretch: vi.fn(), grid: vi.fn(), center: vi.fn(), moveUp: vi.fn(), moveDown: vi.fn(), remove: vi.fn() };
    const onClose = vi.fn();
    render(<PointContextMenu open position={{ x: 10, y: 10 }} entries={buildEntries(handlers)} label="Test menu" onClose={onClose} />);
    await settle();

    const stretch = screen.getByRole('menuitemcheckbox', { name: 'Stretch to Screen' });
    expect(stretch.getAttribute('aria-checked')).toBe('true');
    // Keeps the visual checkmark previously drawn by the plain-item glyph.
    expect(stretch.querySelector('svg')).not.toBeNull();

    const grid = screen.getByRole('menuitemcheckbox', { name: 'Show Grid' });
    expect(grid.getAttribute('aria-checked')).toBe('false');
    expect(grid.querySelector('svg')).toBeNull();

    // A plain item stays a plain `menuitem`, never `menuitemcheckbox`.
    expect(screen.queryByRole('menuitem', { name: 'Fit to Screen' })).not.toBeNull();

    fireEvent.click(stretch);
    await settle();

    // The parent owns `checked`: selecting the item reports the toggle via
    // `onSelect` without the component tracking any local checked state.
    expect(handlers.stretch).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('opens a submenu, fires its onSelect, and closes the whole menu', async () => {
    const handlers = { fit: vi.fn(), stretch: vi.fn(), grid: vi.fn(), center: vi.fn(), moveUp: vi.fn(), moveDown: vi.fn(), remove: vi.fn() };
    const onClose = vi.fn();
    render(<PointContextMenu open position={{ x: 10, y: 10 }} entries={buildEntries(handlers)} label="Test menu" onClose={onClose} />);
    await settle();

    const orderTrigger = screen.getByText('Order').closest('[role="menuitem"]') as HTMLElement;
    expect(orderTrigger.getAttribute('aria-haspopup')).toBe('menu');

    fireEvent.click(orderTrigger);
    await settle();
    expect(screen.getByText('Move Up')).not.toBeNull();

    fireEvent.click(screen.getByText('Move Up'));
    await settle();

    expect(handlers.moveUp).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not select a disabled item', async () => {
    const handlers = { fit: vi.fn(), stretch: vi.fn(), grid: vi.fn(), center: vi.fn(), moveUp: vi.fn(), moveDown: vi.fn(), remove: vi.fn() };
    render(<PointContextMenu open position={{ x: 10, y: 10 }} entries={buildEntries(handlers)} label="Test menu" onClose={() => {}} />);
    await settle();

    fireEvent.click(screen.getByText('Center'));
    await settle();

    expect(handlers.center).not.toHaveBeenCalled();
  });
});

describe('usePointContextMenu', () => {
  function Harness() {
    const menu = usePointContextMenu();
    return (
      <div>
        <div
          data-testid="trigger"
          onContextMenu={(event) => menu.show({ clientX: event.clientX, clientY: event.clientY, preventDefault: () => event.preventDefault() })}
        >
          Row
        </div>
        <PointContextMenu
          open={menu.open}
          position={menu.position}
          entries={[{ id: 'only', label: 'Only item', onSelect: () => {} }]}
          label="Row menu"
          onClose={menu.close}
        />
      </div>
    );
  }

  it('opens at the event position and closes', async () => {
    render(<Harness />);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(screen.getByTestId('trigger'), { clientX: 40, clientY: 60 });
    await settle();
    expect(screen.getByRole('menu', { name: 'Row menu' })).not.toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
