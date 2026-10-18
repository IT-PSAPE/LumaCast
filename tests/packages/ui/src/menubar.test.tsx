import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Menubar, type MenubarMenu } from '@lumacast/ui';

// Base UI moves focus/opens popups on an animation frame, so every interaction
// assertion has to let the frame (and any queued microtasks) run first.
async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

function buildMenus(onPick: (label: string) => void): MenubarMenu[] {
  return [
    {
      id: 'file',
      label: 'File',
      entries: [
        { id: 'file.settings', label: 'Settings…', onSelect: () => onPick('Settings…') },
        { id: 'file.quit', label: 'Quit', onSelect: () => onPick('Quit') },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      entries: [
        { id: 'edit.undo', label: 'Undo', disabled: true, onSelect: () => onPick('Undo') },
        { id: 'edit.redo', label: 'Redo', onSelect: () => onPick('Redo') },
      ],
    },
    {
      id: 'view',
      label: 'View',
      entries: [
        { id: 'view.studioMode', label: 'Studio Mode', checked: true, onSelect: () => onPick('Studio Mode') },
      ],
    },
  ];
}

afterEach(cleanup);

describe('Menubar', () => {
  it('renders a menuitem trigger per menu and nothing open initially', () => {
    render(<Menubar menus={buildMenus(() => {})} label="App menu" />);

    expect(screen.getByRole('menubar', { name: 'App menu' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'File' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'View' })).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu on click and shows its entries', async () => {
    render(<Menubar menus={buildMenus(() => {})} label="App menu" />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    await settle();

    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getByText('Settings…')).not.toBeNull();
    expect(screen.getByText('Quit')).not.toBeNull();
  });

  it('switches to a hovered sibling menu while one is open', async () => {
    render(<Menubar menus={buildMenus(() => {})} label="App menu" />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    await settle();
    expect(screen.getByText('Settings…')).not.toBeNull();

    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.mouseMove(screen.getByRole('menuitem', { name: 'Edit' }));
    await settle();

    expect(screen.queryByText('Settings…')).toBeNull();
    expect(screen.getByText('Redo')).not.toBeNull();
  });

  it('moves between menus with ArrowRight/ArrowLeft and inside one with ArrowDown', async () => {
    render(<Menubar menus={buildMenus(() => {})} label="App menu" />);
    const fileTrigger = screen.getByRole('menuitem', { name: 'File' });
    fileTrigger.focus();

    fireEvent.keyDown(fileTrigger, { key: 'ArrowRight' });
    await settle();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowLeft' });
    await settle();
    expect(document.activeElement).toBe(fileTrigger);

    fireEvent.keyDown(fileTrigger, { key: 'ArrowDown' });
    await settle();
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('Settings');
  });

  it('closes the open menu and opens the adjacent one with ArrowRight/ArrowLeft, wrapping at the ends', async () => {
    render(<Menubar menus={buildMenus(() => {})} label="App menu" />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    await settle();
    expect(screen.getByText('Settings…')).not.toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowRight' });
    await settle();
    expect(screen.queryByText('Settings…')).toBeNull();
    expect(screen.getByText('Redo')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowLeft' });
    await settle();
    expect(screen.queryByText('Redo')).toBeNull();
    expect(screen.getByText('Settings…')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'File' }));

    // ArrowLeft from the first menu wraps around to the last.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowLeft' });
    await settle();
    expect(screen.queryByText('Settings…')).toBeNull();
    expect(screen.getByText('Studio Mode')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'View' }));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'View' }));
  });

  it('runs onSelect and closes when an item is activated', async () => {
    const onPick = vi.fn();
    render(<Menubar menus={buildMenus(onPick)} label="App menu" />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    await settle();
    fireEvent.click(screen.getByText('Quit'));
    await settle();

    expect(onPick).toHaveBeenCalledWith('Quit');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not select a disabled entry', async () => {
    const onPick = vi.fn();
    render(<Menubar menus={buildMenus(onPick)} label="App menu" />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await settle();
    fireEvent.click(screen.getByText('Undo'));
    await settle();

    expect(onPick).not.toHaveBeenCalledWith('Undo');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Menubar menus={buildMenus(() => {})} label="App menu" />);
    const fileTrigger = screen.getByRole('menuitem', { name: 'File' });

    fireEvent.click(fileTrigger);
    await settle();
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(fileTrigger);
  });

  it('shows a checkmark for a checked entry', async () => {
    render(<Menubar menus={buildMenus(() => {})} label="App menu" />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    await settle();

    const studioMode = screen.getByText('Studio Mode').closest('[role="menuitem"]') as HTMLElement;
    expect(studioMode.querySelector('svg')).not.toBeNull();
  });
});
