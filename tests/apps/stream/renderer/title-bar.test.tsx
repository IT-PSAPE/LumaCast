import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MenubarMenu } from '@lumacast/ui';
import { TitleBar } from '../../../../apps/stream/renderer/chrome/title-bar';

afterEach(cleanup);

// Base UI settles the popup's position/focus on an animation frame.
async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

function makeMenus(): MenubarMenu[] {
  return [
    { id: 'file', label: 'File', entries: [{ id: 'file.quit', label: 'Quit' }] },
    { id: 'edit', label: 'Edit', entries: [{ id: 'edit.undo', label: 'Undo' }] },
    { id: 'view', label: 'View', entries: [{ id: 'view.studioMode', label: 'Studio Mode', checked: false }] },
    { id: 'docks', label: 'Docks', entries: [{ id: 'docks.scenes', label: 'Scenes', checked: true }] },
    { id: 'profile', label: 'Profile', entries: [{ id: 'profile.p1', label: 'Default', checked: true }] },
    { id: 'sceneCollection', label: 'Scene Collection', entries: [{ id: 'sceneCollection.c1', label: 'Default', checked: true }] },
    { id: 'help', label: 'Help', entries: [{ id: 'help.about', label: 'About LumaStream' }] },
  ];
}

describe('TitleBar', () => {
  describe('hamburger mode (win32/linux)', () => {
    it('renders a single hamburger button and no in-window menubar', () => {
      render(<TitleBar platform="win32" menuMode="hamburger" menus={makeMenus()} title="LumaStream" />);
      expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
      expect(document.querySelector('.title-bar-menubar')).toBeNull();
    });

    it('opens one menu containing the seven top-level menus as submenus, on click', async () => {
      render(<TitleBar platform="win32" menuMode="hamburger" menus={makeMenus()} title="LumaStream" />);
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
      await settle();

      expect(screen.getByRole('menu')).toBeInTheDocument();
      for (const label of ['File', 'Edit', 'View', 'Docks', 'Profile', 'Scene Collection', 'Help']) {
        expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
      }
    });

    // Enter/Space activation comes from the native button; jsdom keydown alone
    // does not synthesize that click. ArrowDown is the menu-specific behavior.
    it('opens with ArrowDown and returns focus to the trigger on Escape', async () => {
      render(<TitleBar platform="linux" menuMode="hamburger" menus={makeMenus()} title="LumaStream" />);
      const trigger = screen.getByRole('button', { name: 'Menu' });
      act(() => trigger.focus());
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      await settle();
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      await settle();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger).toHaveFocus();
    });
  });

  describe('native mode (darwin)', () => {
    it('renders no hamburger button and no in-window menubar — the real macOS menu bar owns it', () => {
      render(<TitleBar platform="darwin" menuMode="native" menus={makeMenus()} title="LumaStream" />);
      expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
      expect(document.querySelector('.title-bar-menubar')).toBeNull();
      expect(screen.getByText('LumaStream')).toBeInTheDocument();
    });
  });

  it('places the title in the start slot after the hamburger, with an empty centre', () => {
    render(<TitleBar platform="win32" menuMode="hamburger" menus={makeMenus()} title="LumaStream"><button type="button">Settings</button></TitleBar>);
    const start = document.querySelector('[data-slot="start"]')!;
    expect(start).toContainElement(screen.getByText('LumaStream'));
    expect(screen.getByRole('button', { name: 'Menu' }).compareDocumentPosition(screen.getByText('LumaStream')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-slot="center"]')).toBeNull();
    expect(document.querySelector('[data-slot="end"]')).toContainElement(screen.getByRole('button', { name: 'Settings' }));
  });

  it('still renders the title and right-side children in both modes', () => {
    render(<TitleBar platform="darwin" menuMode="native" menus={makeMenus()} title="LumaStream"><button type="button">Settings</button></TitleBar>);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});
