import { useState } from 'react';
import { Menubar as BaseMenubar } from '@base-ui/react/menubar';
import { Menu } from '@base-ui/react/menu';
import { cn } from './cn';
import { SURFACE_CLASSES } from './context-menu';
import { MenuEntries, type MenuEntry } from './menu-entries';
import { useOverlayContainer } from './overlay';

export interface MenubarMenu {
  id: string;
  label: string;
  entries: MenuEntry[];
}

const TRIGGER_CLASSES = cn(
  'flex h-full cursor-default select-none items-center rounded px-2.5 text-[13px] font-medium text-secondary outline-hidden',
  'data-popup-open:bg-tertiary data-popup-open:text-primary',
  'data-highlighted:bg-tertiary data-highlighted:text-primary',
  'data-disabled:cursor-not-allowed data-disabled:opacity-50',
);

export interface MenubarProps {
  menus: MenubarMenu[];
  className?: string;
  label?: string;
}

/**
 * An application menu bar: a row of trigger-anchored dropdown menus sharing
 * one keyboard/hover coordination scope (Base UI's `Menubar`). Click opens a
 * menu; once one is open, hovering a sibling trigger switches to it; Left/Right
 * move between menus, Up/Down/Enter/Escape inside one, and a `children` entry
 * opens its submenu to the right.
 *
 * Each `Menu.Root` is controlled from here (`openMenuId`) rather than left to
 * manage its own open state: Base UI's Menubar normally closes a sibling menu
 * by having it listen for the newly-opened one's event on a shared floating
 * tree, but a `Menu.Root` only joins that shared tree once it has mounted at
 * least once, so the very first keyboard/hover switch to a menu that has never
 * been opened emits on a tree its siblings aren't listening to yet — the old
 * menu never hears about it and stays open. Owning "which menu is open" as a
 * single piece of state sidesteps that race: every `Menu.Root` reacts to the
 * same source of truth, so opening one deterministically closes the rest.
 */
export function Menubar({ menus, className, label }: MenubarProps) {
  const container = useOverlayContainer();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  return (
    <BaseMenubar modal={false} aria-label={label} className={cn('flex h-full items-center gap-0.5', className)}>
      {menus.map((menu) => (
        <Menu.Root
          key={menu.id}
          open={openMenuId === menu.id}
          onOpenChange={(nextOpen) => {
            setOpenMenuId((current) => {
              if (nextOpen) return menu.id;
              return current === menu.id ? null : current;
            });
          }}
        >
          <Menu.Trigger className={TRIGGER_CLASSES}>{menu.label}</Menu.Trigger>
          <Menu.Portal container={container}>
            <Menu.Positioner className="outline-hidden" sideOffset={2} align="start">
              {/* App menus run wider than a row's context menu (longer labels,
                  shortcut hints), so the shared surface's context-menu width
                  cap is relaxed here. */}
              <Menu.Popup className={cn(SURFACE_CLASSES, 'max-w-72 min-w-48')}>
                <MenuEntries entries={menu.entries} />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ))}
    </BaseMenubar>
  );
}
