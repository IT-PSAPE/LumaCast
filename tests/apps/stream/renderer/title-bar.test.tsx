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

    it('opens from the keyboard via Enter, Space, or ArrowDown — no Alt key required', async () => {
      for (const key of ['Enter', ' ', 'ArrowDown']) {
        const { unmount } = render(<TitleBar platform="linux" menuMode="hamburger" menus={makeMenus()} title="LumaStream" />);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Menu' }), { key });
        await settle();
        expect(screen.getByRole('menu')).toBeInTheDocument();
        unmount();
      }
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

  it('still renders the title and right-side children in both modes', () => {
    render(<TitleBar platform="darwin" menuMode="native" menus={makeMenus()} title="LumaStream"><span>LIVE</span></TitleBar>);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });
});
