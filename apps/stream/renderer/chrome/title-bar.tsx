import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import { PointContextMenu, usePointContextMenu, type MenuEntry, type MenubarMenu } from '@lumacast/ui';
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
 * The custom 36px title bar: a drag region carrying the window title (and, on
 * Windows/Linux, a hamburger menu button) with optional status chips on the
 * right. macOS keeps the native traffic lights (left inset, see
 * `mainWindowChromeOptions`) and its own real menu bar; Windows/Linux keep
 * native caption buttons via a `titleBarOverlay` (right inset here matches its
 * width) and get their menu from the hamburger button instead.
 */
export function TitleBar({ platform, menuMode, menus, title, children }: TitleBarProps) {
  useEffect(() => {
    // @lumacast/ui's dark-mode token values only resolve under
    // `data-theme="dark"`. LumaStream has no light theme (style.css hardcodes
    // `color-scheme: dark`), so this activates the shared design system's dark
    // palette once, globally — guarded so it never overrides an explicit
    // light choice a future theme setting might add.
    if (document.documentElement.dataset.theme !== 'light') {
      document.documentElement.dataset.theme = 'dark';
    }
  }, []);

  const hamburgerMenu = usePointContextMenu();
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const openHamburgerMenu = () => {
    const button = hamburgerButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    hamburgerMenu.show({ clientX: rect.left, clientY: rect.bottom, preventDefault() {} });
  };

  const onHamburgerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    // No Alt-key gate (unlike classic Windows menu bars) — this is our own
    // button, not a native one, so Enter/Space/ArrowDown just open it.
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      openHamburgerMenu();
    }
  };

  // OBS 31's hamburger menu: one menu whose items are File/Edit/View/Docks/
  // Profile/Scene Collection/Help, each opening its existing entries as a submenu.
  const hamburgerEntries: MenuEntry[] = menus.map((menu) => ({ id: menu.id, label: menu.label, children: menu.entries }));

  return (
    <div className="title-bar" data-platform={platform}>
      {menuMode === 'hamburger' && (
        <button
          ref={hamburgerButtonRef}
          type="button"
          className="title-bar-hamburger no-drag"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={hamburgerMenu.open}
          onClick={openHamburgerMenu}
          onKeyDown={onHamburgerKeyDown}
        >
          <MenuIcon size={16} aria-hidden="true" />
        </button>
      )}
      <div className="title-bar-title">{title}</div>
      {children ? <div className="title-bar-end no-drag">{children}</div> : null}
      {menuMode === 'hamburger' && (
        <PointContextMenu
          open={hamburgerMenu.open}
          position={hamburgerMenu.position}
          entries={hamburgerEntries}
          label={title}
          onClose={hamburgerMenu.close}
        />
      )}
    </div>
  );
}
