import { createContext, useCallback, useContext, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { cn } from '@renderer/utils/cn';
import { useOverlayContainer, useOverlayStackEntry } from '../overlays/overlay-primitives';
import type { PopoverPlacement } from '../overlays/popover';

// Every consumer uses this as an action menu — items fire a callback, nothing
// is bound to a value — so it is built on Base UI's Menu rather than Select.
// Base UI owns roles, roving focus, typeahead, dismissal and focus return; this
// module keeps the app's trigger-width sizing and overlay-root conventions.

// ─── Context ─────────────────────────────────────────────

interface DropdownContextValue {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  // Trigger width captured when the menu opens, so the panel can match it.
  triggerWidth: number | undefined;
  onOpen: () => void;
  onClose: () => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdown() {
  const ctx = useContext(DropdownContext);
  if (!ctx) throw new Error('Dropdown sub-components must be used within Dropdown');
  return ctx;
}

// ─── Root ────────────────────────────────────────────────

interface RootProps {
  className?: string;
  children: ReactNode;
}

function Root({ className, children }: RootProps) {
  const [open, setOpen] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    // Snapshot the trigger's width so the panel can size to match it.
    if (nextOpen) setTriggerWidth(triggerRef.current?.offsetWidth);
    setOpen(nextOpen);
  }, []);

  const handleOpen = useCallback(() => handleOpenChange(true), [handleOpenChange]);
  const handleClose = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  // Base UI's trigger and popup own the keyboard now. Kept on the context so a
  // caller wiring a hand-rolled trigger still gets the open/close chords.
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      handleOpen();
    } else if (open && event.key === 'Escape') {
      event.preventDefault();
      handleClose();
      triggerRef.current?.focus();
    }
  }, [handleClose, handleOpen, open]);

  const ctx = useMemo<DropdownContextValue>(() => ({
    open,
    triggerRef,
    panelRef,
    triggerWidth,
    onOpen: handleOpen,
    onClose: handleClose,
    handleKeyDown,
  }), [open, triggerWidth, handleOpen, handleClose, handleKeyDown]);

  return (
    <DropdownContext.Provider value={ctx}>
      <Menu.Root modal={false} open={open} onOpenChange={handleOpenChange}>
        <div className={cn('relative min-w-0', className)}>
          {children}
        </div>
      </Menu.Root>
    </DropdownContext.Provider>
  );
}

// ─── Trigger ─────────────────────────────────────────────

interface TriggerProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick' | 'onKeyDown' | 'onPointerDown'> {
  children: ReactNode;
}

function Trigger({ children, className, ...rest }: TriggerProps) {
  const ctx = useDropdown();

  return (
    <Menu.Trigger
      {...rest}
      ref={(node: HTMLElement | null) => { ctx.triggerRef.current = node as HTMLButtonElement | null; }}
      className={className}
    >
      {children}
    </Menu.Trigger>
  );
}

// ─── Panel ───────────────────────────────────────────────

interface PanelProps {
  children: ReactNode;
  className?: string;
  placement?: PopoverPlacement;
}

function Panel({ children, className, placement = 'bottom' }: PanelProps) {
  const ctx = useDropdown();
  const container = useOverlayContainer();
  const { zIndex } = useOverlayStackEntry(ctx.open);
  const separator = placement.indexOf('-');
  const side = (separator === -1 ? placement : placement.slice(0, separator)) as 'top' | 'bottom' | 'left' | 'right';
  const align = (separator === -1 ? 'center' : placement.slice(separator + 1)) as 'start' | 'center' | 'end';

  return (
    <Menu.Portal container={container} className="pointer-events-none fixed inset-0" style={{ zIndex }}>
      {/* Menu's default collision avoidance never falls back to a perpendicular
          side, so the panel flips bottom↔top instead of appearing beside its
          trigger — the `axisLock` the popover version asked for. */}
      <Menu.Positioner side={side} align={align} sideOffset={4} className="outline-hidden">
        <Menu.Popup
          ref={ctx.panelRef}
          data-popover-content="true"
          // Match the trigger's width. The `min-w-30` floor means a narrow trigger
          // still gets a usable panel: the used width is max(triggerWidth, 7.5rem).
          style={{ width: ctx.triggerWidth }}
          className={cn('pointer-events-auto min-w-30 rounded-md border border-primary bg-primary shadow-lg max-h-[min(32rem,70vh)] overflow-y-auto p-1 outline-hidden', className)}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

// ─── Item ────────────────────────────────────────────────

interface ItemProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

function Item({ children, onClick, disabled = false, className }: ItemProps) {
  return (
    <Menu.Item
      render={<button type="button" />}
      nativeButton
      disabled={disabled}
      data-dropdown-item=""
      onClick={() => onClick?.()}
      className={cn('w-full flex gap-2 rounded px-2 py-1.5 text-sm text-left select-none outline-hidden text-secondary data-[highlighted]:bg-secondary hover:bg-tertiary data-[highlighted]:text-primary', disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer', className)}
    >
      {children}
    </Menu.Item>
  );
}

// ─── Separator ───────────────────────────────────────────

function Separator() {
  return <Menu.Separator className="my-1 h-px bg-tertiary" />;
}

// ─── Export ──────────────────────────────────────────────

export { useDropdown };
export const Dropdown = Object.assign(Root, { Trigger, Panel, Item, Separator });
