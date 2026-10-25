import { useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Menu as MenuIcon } from 'lucide-react';
import { CONTEXT_MENU_SURFACE_CLASSES, MenuEntries, WindowChrome, useOverlayContainer, type MenuEntry, type MenubarMenu } from '@lumacast/ui';
import type { StreamPlatform } from '../../shared/platform-capabilities';
import './title-bar.css';

export interface TitleBarProps {
  platform: StreamPlatform;
  // macOS renders no in-window menu at all — the real menu bar
  // (`Menu.setApplicationMenu`, synced by `features/chrome/use-native-menu.ts`)
  // owns it. Windows/Linux have no native menu bar (`titleBarStyle: 'hidden'`
  // with no room for one), so a single hamburger button opens all of
  // File/Edit/View/Docks/Profile/Scene Collection/Help as one menu's submenus.
  menuMode: 'native' | 'hamburger';
  menus: MenubarMenu[];
  title: string;
  // Right-side status chips (e.g. LIVE/REC indicators).
  children?: ReactNode;
}

/**
 * Stream's title bar content on the shared `WindowChrome` frame (height,
 * drag regions and platform insets come from there). Start holds the
 * Windows/Linux hamburger menu (macOS keeps its real menu bar and traffic
 * lights) followed by the window title, which is its own drag region inside
 * the no-drag Start. Center is empty; End carries the status chips.
 */
export function TitleBar({ platform, menuMode, menus, title, children }: TitleBarProps) {
  const [hamburgerMenuOpen, setHamburgerMenuOpen] = useState(false);
  const overlayContainer = useOverlayContainer();

  // OBS 31's hamburger menu: one menu whose items are File/Edit/View/Docks/
  // Profile/Scene Collection/Help, each opening its existing entries as a submenu.
  const hamburgerEntries: MenuEntry[] = menus.map((menu) => ({ id: menu.id, label: menu.label, children: menu.entries }));

  return (
    <WindowChrome platform={platform}>
      <WindowChrome.Start>
        {menuMode === 'hamburger' && (
          <Menu.Root open={hamburgerMenuOpen} onOpenChange={setHamburgerMenuOpen} modal={false}>
            <Menu.Trigger
              type="button"
              className="title-bar-hamburger"
              aria-label="Menu"
            >
              <MenuIcon size={16} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Portal container={overlayContainer}>
              <Menu.Positioner className="outline-hidden" side="bottom" sideOffset={2} align="start">
                <Menu.Popup
                  className={CONTEXT_MENU_SURFACE_CLASSES}
                  aria-label={`${title} menu`}
                >
                  <MenuEntries entries={hamburgerEntries} onClose={() => setHamburgerMenuOpen(false)} />
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
        <WindowChrome.Title>{title}</WindowChrome.Title>
      </WindowChrome.Start>
      {children ? <WindowChrome.End>{children}</WindowChrome.End> : null}
    </WindowChrome>
  );
}
