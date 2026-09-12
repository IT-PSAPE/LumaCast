import { type ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { cn } from '@renderer/utils/cn';
import { useOverlayContainer, useOverlayStackEntry } from './overlay-primitives';

type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
type PopoverAlign = 'start' | 'center' | 'end';

export type PopoverPlacement =
  | 'top' | 'top-start' | 'top-end'
  | 'bottom' | 'bottom-start' | 'bottom-end'
  | 'left' | 'left-start' | 'left-end'
  | 'right' | 'right-start' | 'right-end';

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  placement?: PopoverPlacement;
  offset?: number;
  className?: string;
  children: ReactNode;
  // When true, only fall back along the main axis (e.g., bottom→top) and never
  // to cross-axis sides. Dropdowns want this so the menu never appears beside
  // its trigger — that's confusing for menu UX.
  axisLock?: boolean;
}

const VIEWPORT_PADDING = 8;

function parsePlacement(placement: PopoverPlacement): { side: PopoverSide; align: PopoverAlign } {
  const idx = placement.indexOf('-');
  if (idx === -1) return { side: placement as PopoverSide, align: 'center' };
  return { side: placement.slice(0, idx) as PopoverSide, align: placement.slice(idx + 1) as PopoverAlign };
}

export function Popover({ anchor, open, onClose, placement = 'bottom', offset = 4, className = '', children, axisLock = false }: PopoverProps) {
  // Participate in the global overlay stack so nested popovers (e.g. a select
  // opened inside a dialog) layer above whatever opened them. Without this the
  // positioner has `z-index: auto` and gets painted behind any sibling overlay
  // (like a Dialog) that has an explicit z-index.
  const { zIndex } = useOverlayStackEntry(open);
  const container = useOverlayContainer();
  const { side, align } = parsePlacement(placement);

  function handleOpenChange(nextOpen: boolean, details: BasePopover.Root.ChangeEventDetails) {
    if (nextOpen) return;
    if (details.reason === 'outside-press') {
      const target = details.event.target;
      // The anchor is an external trigger that toggles this popover itself, so
      // dismissing here would close and immediately reopen it. And a press
      // inside another popover surface (a nested context-menu submenu) must not
      // unmount its ancestors between pointerdown and click — the item would
      // disappear before its click fires and the action would never run.
      if (target instanceof Node && anchor?.contains(target)) return details.cancel();
      if (target instanceof Element && target.closest('[data-popover-content="true"],[data-context-menu-owned="true"]')) return details.cancel();
    }
    onClose();
  }

  return (
    <BasePopover.Root open={open} onOpenChange={handleOpenChange}>
      <BasePopover.Portal container={container}>
        <BasePopover.Positioner
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={offset}
          positionMethod="fixed"
          collisionPadding={VIEWPORT_PADDING}
          collisionAvoidance={axisLock ? { side: 'flip', align: 'flip', fallbackAxisSide: 'none' } : undefined}
          className="pointer-events-none"
          style={{ zIndex }}
        >
          <BasePopover.Popup
            // Consumers own focus inside the popup (a dropdown drives its list
            // from the trigger's keydown, the colour picker keeps the caret put),
            // so moving focus on open would take the keyboard away from them.
            initialFocus={false}
            data-popover-content="true"
            className={cn('pointer-events-auto outline-none', className)}
            render={(props, state) => (
              <div {...props} data-popover-placement={state.align === 'center' ? state.side : `${state.side}-${state.align}`} />
            )}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
