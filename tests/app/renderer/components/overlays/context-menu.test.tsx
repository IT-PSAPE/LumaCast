import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu, useContextMenu, useContextMenuTrigger } from '../../../../../app/renderer/components/overlays/context-menu';

const overlayStack = {
  rootElement: null as HTMLElement | null,
  stack: [] as string[],
  baseZIndex: 1000,
  register: vi.fn(),
  unregister: vi.fn(),
};

vi.mock('@renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({ state: {}, actions: {}, overlayStack }),
}));

function TriggerRow({ disabled = false }: { disabled?: boolean }) {
  const { ref, ...handlers } = useContextMenuTrigger({ disabled });
  return <div {...handlers} ref={ref} data-testid="row">Row</div>;
}

// Base UI moves focus on an animation frame, so every keyboard assertion has to
// let the frame (and any queued microtasks) run first.
async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId('row'), { clientX: 24, clientY: 36 });
}

function pressKey(key: string, init: Record<string, unknown> = {}) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
}

function Menu({ onPick = () => undefined }: { onPick?: (label: string) => void }) {
  return (
    <ContextMenu.Root>
      <TriggerRow />
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => onPick('Rename')}>Rename</ContextMenu.Item>
          <ContextMenu.Item disabled onSelect={() => onPick('Duplicate')}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Submenu label="Move to">
            <ContextMenu.Item onSelect={() => onPick('Archive')}>Archive</ContextMenu.Item>
          </ContextMenu.Submenu>
          <ContextMenu.Item variant="destructive" onSelect={() => onPick('Delete')}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

beforeEach(() => {
  overlayStack.register.mockClear();
  overlayStack.unregister.mockClear();
  overlayStack.rootElement = null;
});

afterEach(cleanup);

describe('useContextMenuTrigger', () => {
  it('stays inert outside a ContextMenu.Root so a row body can also render as its drag overlay', () => {
    render(<TriggerRow />);
    const row = screen.getByTestId('row');

    // fireEvent returns false when the handler called preventDefault — an inert
    // trigger must leave the event alone so nothing tries to open a menu.
    expect(fireEvent.contextMenu(row)).toBe(true);
    expect(row.dataset.state).toBe('closed');
  });

  it('opens at the pointer inside a ContextMenu.Root', () => {
    render(<ContextMenu.Root><TriggerRow /></ContextMenu.Root>);
    const row = screen.getByTestId('row');

    expect(fireEvent.contextMenu(row, { clientX: 24, clientY: 36 })).toBe(false);
    expect(row.dataset.state).toBe('open');
  });

  it('stays closed when the caller disables it', () => {
    render(<ContextMenu.Root><TriggerRow disabled /></ContextMenu.Root>);
    const row = screen.getByTestId('row');

    expect(fireEvent.contextMenu(row)).toBe(true);
    expect(row.dataset.state).toBe('closed');
  });
});

describe('useContextMenu', () => {
  it('still rejects menu parts rendered outside a ContextMenu.Root', () => {
    function Orphan() {
      useContextMenu();
      return null;
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Orphan />)).toThrow('ContextMenu components must be used within ContextMenu.Root');

    consoleError.mockRestore();
  });
});

describe('menu surface', () => {
  it('exposes menu/menuitem roles and keeps the app conventions on the popup', async () => {
    render(<Menu />);
    openMenu();
    await settle();

    const menu = screen.getByRole('menu');
    expect(menu.dataset.contextMenuOwned).toBe('true');
    expect(menu.className).toContain('pointer-events-auto');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rename', 'Duplicate', 'Move to', 'Delete',
    ]);
    expect(screen.getByRole('separator')).not.toBeNull();
    expect(screen.getByText('Duplicate').closest('[role="menuitem"]')?.getAttribute('data-disabled')).toBe('');
  });

  it('adds no DOM siblings among the rows a caller wraps', async () => {
    render(
      <div data-testid="list">
        <ContextMenu.Root><TriggerRow /></ContextMenu.Root>
      </div>,
    );
    const list = screen.getByTestId('list');
    expect(list.children).toHaveLength(1);

    openMenu();
    await settle();

    // The hidden trigger Base UI needs, and its focus guards, must not land in
    // a list where `:first-child`/`space-y` rules would count them as rows.
    expect(list.children).toHaveLength(1);
  });

  it('registers with the overlay stack only while open', async () => {
    render(<Menu />);
    expect(overlayStack.register).not.toHaveBeenCalled();

    openMenu();
    await settle();
    expect(overlayStack.register).toHaveBeenCalledTimes(1);

    pressKey('Escape');
    await settle();
    expect(overlayStack.unregister).toHaveBeenCalledTimes(1);
  });

  it('portals into the overlay root on a pointer-events-none layer', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    overlayStack.rootElement = root;

    render(<Menu />);
    openMenu();
    await settle();

    const menu = screen.getByRole('menu');
    expect(root.contains(menu)).toBe(true);
    expect(root.querySelector('[data-base-ui-portal]')?.className).toContain('pointer-events-none');

    root.remove();
  });

  it('moves focus into the popup and navigates with the arrow keys', async () => {
    render(<Menu />);
    openMenu();
    await settle();
    expect(document.activeElement).toBe(screen.getByRole('menu'));

    pressKey('ArrowDown');
    await settle();
    expect(document.activeElement?.textContent).toBe('Rename');

    pressKey('End');
    await settle();
    expect(document.activeElement?.textContent).toBe('Delete');

    pressKey('Home');
    await settle();
    expect(document.activeElement?.textContent).toBe('Rename');
  });

  it('runs onSelect and closes when an item is activated', async () => {
    const onPick = vi.fn();
    render(<Menu onPick={onPick} />);
    openMenu();
    await settle();

    fireEvent.click(screen.getByText('Rename'));
    await settle();

    expect(onPick).toHaveBeenCalledWith('Rename');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Menu />);
    const row = screen.getByTestId('row');
    row.tabIndex = 0;
    row.focus();
    openMenu();
    await settle();
    expect(screen.getByRole('menu')).not.toBeNull();

    pressKey('Escape');
    await settle();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(row.dataset.state).toBe('closed');
  });

  it('opens a submenu from its trigger with ArrowRight', async () => {
    render(<Menu />);
    openMenu();
    await settle();

    const submenuTrigger = screen.getByText('Move to').closest('[role="menuitem"]') as HTMLElement;
    expect(submenuTrigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(submenuTrigger.getAttribute('aria-expanded')).toBe('false');

    // Walk down to the submenu row, then open it the way a keyboard user would.
    for (let index = 0; index < 3; index += 1) {
      pressKey('ArrowDown');
      await settle();
    }
    expect(document.activeElement).toBe(submenuTrigger);

    pressKey('ArrowRight');
    await settle();

    expect(screen.getAllByRole('menu')).toHaveLength(2);
    expect(submenuTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Archive')).not.toBeNull();
  });
});
