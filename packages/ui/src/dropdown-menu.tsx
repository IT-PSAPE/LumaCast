import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { cn } from './cn';
import { SURFACE_CLASSES } from './context-menu';
import { MenuEntries, type MenuEntry } from './menu-entries';
import { useOverlayContainer, useOverlayStackEntry } from './overlay';

const VIEWPORT_PADDING = 8;

export interface DropdownMenuRenderProps {
  /** Dismisses the menu (and restores focus to the trigger). */
  close: () => void;
}

/** Body of the menu: exactly one of `entries` or `children`; passing both is a type error. */
export type DropdownMenuContent =
  | { entries: MenuEntry[]; children?: never }
  | { entries?: never; children: ReactNode | ((props: DropdownMenuRenderProps) => ReactNode) };

export type DropdownMenuProps = DropdownMenuContent & {
  /** The button that opens the menu. Cloned via `render`, never wrapped. */
  trigger: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  disabled?: boolean;
  /** Controlled open state; omit for uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * A click-to-open menu anchored to its trigger element by Base UI's positioner
 * (so `align="end"` right-aligns to the trigger). Base UI's `Menu.Trigger`
 * supplies `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`, plus
 * Enter/Space/Arrow opening, Escape-and-refocus, roving focus and typeahead.
 * Rows render through `MenuEntries`, identical to `ContextMenu` and `Menubar`.
 *
 * Pass `entries` (the default, keeps every menu looking alike) OR `children`
 * (a node, or `({ close }) => node`) for presentational content: icons,
 * headings, descriptions, static preview rows, or hand-built items. Both
 * render on the same surface.
 *
 * Do NOT put focusable form controls (sliders, inputs, selects, switches) in
 * `children`: a menu is a roving-focus `menuitem` widget, so arrow keys inside
 * a slider would also move the menu's focus and the ARIA contract breaks.
 * Control-heavy panels belong in `Popover`, not `DropdownMenu`.
 */
export function DropdownMenu({
  trigger,
  entries,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  disabled = false,
  open,
  onOpenChange,
  className,
}: DropdownMenuProps) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const resolvedOpen = isControlled ? open : uncontrolledOpen;
  const { zIndex } = useOverlayStackEntry(resolvedOpen);
  const container = useOverlayContainer();

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!isControlled) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [isControlled, onOpenChange]);

  const close = () => { handleOpenChange(false); };

  return (
    <Menu.Root modal={false} open={resolvedOpen} onOpenChange={handleOpenChange}>
      <Menu.Trigger render={trigger} disabled={disabled} />
      <Menu.Portal container={container}>
        <Menu.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          positionMethod="fixed"
          collisionPadding={VIEWPORT_PADDING}
          className="pointer-events-none outline-hidden"
          style={{ zIndex }}
        >
          <Menu.Popup className={cn(SURFACE_CLASSES, className)}>
            {entries
              ? <MenuEntries entries={entries} />
              : typeof children === 'function' ? children({ close }) : children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
