import { useCallback, useState, type ReactElement } from 'react';
import { Menu } from '@base-ui/react/menu';
import { cn } from './cn';
import { SURFACE_CLASSES } from './context-menu';
import { MenuEntries, type MenuEntry } from './menu-entries';
import { useOverlayContainer, useOverlayStackEntry } from './overlay';

const VIEWPORT_PADDING = 8;

export interface DropdownMenuProps {
  /** The button that opens the menu. Cloned via `render`, never wrapped. */
  trigger: ReactElement;
  entries: MenuEntry[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  disabled?: boolean;
  /** Controlled open state; omit for uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A click-to-open menu anchored to its trigger element by Base UI's positioner
 * (so `align="end"` right-aligns to the trigger). Base UI's `Menu.Trigger`
 * supplies `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`, plus
 * Enter/Space/Arrow opening, Escape-and-refocus, roving focus and typeahead.
 * Rows render through `MenuEntries`, identical to `ContextMenu` and `Menubar`.
 */
export function DropdownMenu({
  trigger,
  entries,
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
            <MenuEntries entries={entries} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
