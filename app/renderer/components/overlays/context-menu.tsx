import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight } from 'lucide-react';
import { cn } from '@renderer/utils/cn';
import { useOverlayContainer, useOverlayStackEntry } from './overlay-primitives';

// Hide the native scrollbar while keeping wheel/trackpad scrolling. Used on
// the menu flyouts where we want overflow scrolling without a visible thumb.
const HIDE_NATIVE_SCROLLBAR = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

const DEFAULT_LONG_PRESS_DELAY = 500;
const DEFAULT_VIEWPORT_PADDING = 8;

const SURFACE_CLASSES = cn(
  'pointer-events-auto min-w-30 max-w-48 max-h-80 overflow-y-auto rounded-md border border-primary bg-primary p-1 shadow-lg outline-hidden',
  HIDE_NATIVE_SCROLLBAR,
);

const ITEM_CLASSES = 'flex w-full min-w-0 select-none items-center gap-2 truncate rounded px-2 py-1.5 text-left text-sm outline-hidden';

export interface ContextMenuPoint {
  x: number;
  y: number;
}

interface ContextMenuContextValue {
  state: {
    open: boolean;
    position: ContextMenuPoint | null;
  };
  actions: {
    close: () => void;
    openAt: (position: ContextMenuPoint) => void;
    setOpen: (nextOpen: boolean) => void;
  };
  meta: {
    positionerRef: RefObject<HTMLDivElement | null>;
    triggerRef: RefObject<HTMLDivElement | null>;
    zIndex: number;
  };
}

interface RootProps {
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (nextOpen: boolean) => void;
  onPositionChange?: (position: ContextMenuPoint | null) => void;
  open?: boolean;
  position?: ContextMenuPoint | null;
  zIndex?: number;
}

interface TriggerProps extends HTMLAttributes<HTMLDivElement> {
  disabled?: boolean;
  longPressDelay?: number;
}

interface PositionerProps extends HTMLAttributes<HTMLDivElement> {
  viewportPadding?: number;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

export function useContextMenu() {
  const context = useContext(ContextMenuContext);

  if (!context) {
    throw new Error('ContextMenu components must be used within ContextMenu.Root');
  }

  return context;
}

// Base UI's own ContextMenu.Root only opens from its own Trigger and is always
// modal (it aria-hides the whole app). This app opens menus from a point it
// already has — Konva canvas events, row bodies that spread
// `useContextMenuTrigger()` — so the popup is a non-modal Menu anchored to a
// zero-size virtual rect at that point. Everything else (roles, roving focus,
// typeahead, dismissal, focus return, submenus) is Base UI's.
function Root({
  children,
  defaultOpen = false,
  onOpenChange,
  onPositionChange,
  open,
  position,
  zIndex,
}: RootProps) {
  const positionerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const isOpenControlled = open !== undefined;
  const isPositionControlled = position !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [uncontrolledPosition, setUncontrolledPosition] = useState<ContextMenuPoint | null>(null);
  const resolvedOpen = isOpenControlled ? open : uncontrolledOpen;
  const resolvedPosition = isPositionControlled ? position : uncontrolledPosition;

  // Participate in the global overlay stack so context menus opened from inside
  // a Dialog/Popover layer above their parent, and so the app-level keyboard
  // shortcuts stand down while one is open. Caller may pass `zIndex` (rare).
  const { zIndex: stackZIndex } = useOverlayStackEntry(resolvedOpen);
  const computedZIndex = zIndex ?? stackZIndex;
  const overlayContainer = useOverlayContainer();

  const setPositionState = useCallback((nextPosition: ContextMenuPoint | null) => {
    if (!isPositionControlled) {
      setUncontrolledPosition(nextPosition);
    }

    onPositionChange?.(nextPosition);
  }, [isPositionControlled, onPositionChange]);

  const setOpenState = useCallback((nextOpen: boolean) => {
    if (!isOpenControlled) {
      setUncontrolledOpen(nextOpen);
    }

    if (!nextOpen) {
      setPositionState(null);
    }

    onOpenChange?.(nextOpen);
  }, [isOpenControlled, onOpenChange, setPositionState]);

  const close = useCallback(() => {
    setOpenState(false);
  }, [setOpenState]);

  const openAt = useCallback((nextPosition: ContextMenuPoint) => {
    setPositionState(nextPosition);
    setOpenState(true);
  }, [setOpenState, setPositionState]);

  const context = useMemo<ContextMenuContextValue>(() => ({
    state: {
      open: resolvedOpen,
      position: resolvedPosition,
    },
    actions: {
      close,
      openAt,
      setOpen: setOpenState,
    },
    meta: {
      positionerRef,
      triggerRef,
      zIndex: computedZIndex,
    },
  }), [close, computedZIndex, openAt, resolvedOpen, resolvedPosition, setOpenState]);

  return (
    <ContextMenuContext.Provider value={context}>
      <Menu.Root
        modal={false}
        open={resolvedOpen && resolvedPosition !== null}
        onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}
      >
        {/*
          Base UI links a menu into its floating tree through its trigger. This
          menu has no Base UI trigger — it opens from a point — so without a
          registered trigger the root reads a submenu's "opened" event as a
          sibling opening and closes itself. A disabled, hidden trigger registers
          the root and is never interactive; it is portalled away so neither it
          nor the focus guards Base UI renders beside it land among the rows a
          caller wrapped, where `:first-child`/`space-y` rules would count them.
        */}
        {createPortal(
          <Menu.Trigger disabled nativeButton={false} render={<span aria-hidden className="hidden" />} />,
          overlayContainer ?? document.body,
        )}
        {children}
      </Menu.Root>
    </ContextMenuContext.Provider>
  );
}

function Trigger({
  children,
  className,
  disabled = false,
  longPressDelay = DEFAULT_LONG_PRESS_DELAY,
  onContextMenu,
  onKeyDown,
  onTouchCancel,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  style,
  ...props
}: TriggerProps) {
  const { actions, meta, state } = useContextMenu();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchOriginRef = useRef<ContextMenuPoint | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const openFromElement = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();

    actions.openAt({
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + Math.min(rect.height, 24) / 2),
    });
  }, [actions]);

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    onContextMenu?.(event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    event.preventDefault();
    actions.openAt({ x: event.clientX, y: event.clientY });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      openFromElement(event.currentTarget);
    }
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    onTouchStart?.(event);

    if (event.defaultPrevented || disabled || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    touchOriginRef.current = { x: touch.clientX, y: touch.clientY };
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      if (!touchOriginRef.current) {
        return;
      }

      actions.openAt(touchOriginRef.current);
      touchOriginRef.current = null;
      longPressTimerRef.current = null;
    }, longPressDelay);
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    onTouchMove?.(event);

    if (!touchOriginRef.current || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchOriginRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchOriginRef.current.y);

    if (deltaX > 10 || deltaY > 10) {
      touchOriginRef.current = null;
      clearLongPress();
    }
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    onTouchEnd?.(event);
    touchOriginRef.current = null;
    clearLongPress();
  }

  function handleTouchCancel(event: ReactTouchEvent<HTMLDivElement>) {
    onTouchCancel?.(event);
    touchOriginRef.current = null;
    clearLongPress();
  }

  useEffect(() => {
    return clearLongPress;
  }, [clearLongPress]);

  return (
    <div
      {...props}
      ref={meta.triggerRef}
      className={className}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
      style={{ ...style, WebkitTouchCallout: 'none' }}
      data-state={state.open ? 'open' : 'closed'}
    >
      {children}
    </div>
  );
}

// The overlay root is `pointer-events: none` so the app stays clickable around
// a menu; the popup opts back in. Exported as `ContextMenu.Portal`, and reused
// by every submenu so they share the stacking context the overlay stack gave
// this root.
function Portal({ children }: { children: ReactNode }) {
  const { meta } = useContextMenu();
  const container = useOverlayContainer();

  return (
    <Menu.Portal
      container={container}
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: meta.zIndex }}
    >
      {children}
    </Menu.Portal>
  );
}

function Positioner({
  children,
  className,
  onContextMenu,
  style,
  viewportPadding = DEFAULT_VIEWPORT_PADDING,
  ...props
}: PositionerProps) {
  const { meta, state } = useContextMenu();
  const x = state.position?.x ?? 0;
  const y = state.position?.y ?? 0;

  // A zero-size rect at the pointer: Base UI then flips/shifts the popup away
  // from the viewport edges exactly as it does for a real anchor element.
  const anchor = useMemo(() => ({
    getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
  }), [x, y]);

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    onContextMenu?.(event);

    if (!event.defaultPrevented) {
      event.preventDefault();
    }
  }

  return (
    <Menu.Positioner
      ref={meta.positionerRef}
      anchor={anchor}
      side="bottom"
      align="start"
      sideOffset={0}
      alignOffset={0}
      collisionPadding={viewportPadding}
      className="outline-hidden"
    >
      <Menu.Popup
        {...(props as ComponentPropsWithoutRef<'div'>)}
        data-context-menu-owned="true"
        // Falls back to whatever had focus before opening when the trigger is a
        // Konva canvas or another element the hook never attached to.
        finalFocus={meta.triggerRef}
        className={cn('pointer-events-auto', className)}
        onContextMenu={handleContextMenu}
        style={style}
      >
        {children}
      </Menu.Popup>
    </Menu.Positioner>
  );
}

// ─── Menu (styled positioner surface) ────────────────────

interface MenuProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

function MenuSurface({ children, className, ...props }: MenuProps) {
  return (
    <Positioner {...props} className={cn(SURFACE_CLASSES, className)}>
      {children}
    </Positioner>
  );
}

// ─── Item ────────────────────────────────────────────────

type ContextMenuItemVariant = 'default' | 'destructive';

interface ItemProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  variant?: ContextMenuItemVariant;
  closeOnSelect?: boolean;
}

function itemVariantClasses(variant: ContextMenuItemVariant, disabled: boolean) {
  return cn(
    ITEM_CLASSES,
    variant === 'destructive'
      ? 'text-error data-[highlighted]:bg-error/15'
      : 'text-secondary data-[highlighted]:bg-tertiary data-[popup-open]:bg-tertiary',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
  );
}

const Item = forwardRef<HTMLButtonElement, ItemProps>(function Item({
  children,
  className,
  closeOnSelect = true,
  disabled = false,
  onClick,
  onSelect,
  variant = 'default',
  ...rest
}, ref) {
  return (
    <Menu.Item
      {...(rest as ComponentPropsWithoutRef<'div'>)}
      ref={ref as Ref<HTMLElement>}
      render={<button type="button" />}
      nativeButton
      disabled={disabled}
      closeOnClick={closeOnSelect}
      data-context-menu-item=""
      onClick={(event) => {
        onClick?.(event as unknown as ReactMouseEvent<HTMLButtonElement>);

        // A caller that preventDefaults owns the click: skip the selection and
        // keep Base UI from closing the menu underneath it.
        if (event.defaultPrevented) {
          event.preventBaseUIHandler();
          return;
        }

        onSelect?.();
      }}
      className={cn(itemVariantClasses(variant, disabled), className)}
    >
      {children}
    </Menu.Item>
  );
});

// ─── Separator ───────────────────────────────────────────

function Separator() {
  return <Menu.Separator className="my-1 h-px bg-tertiary" />;
}

// ─── Submenu (flyout) ────────────────────────────────────

interface SubmenuProps {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

function Submenu({ label, children, disabled = false, className }: SubmenuProps) {
  return (
    <Menu.SubmenuRoot disabled={disabled}>
      <Menu.SubmenuTrigger
        render={<button type="button" />}
        nativeButton
        disabled={disabled}
        className={cn(itemVariantClasses('default', disabled), className)}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="size-3.5 shrink-0 text-tertiary" />
      </Menu.SubmenuTrigger>
      <Portal>
        <Menu.Positioner className="outline-hidden" sideOffset={6}>
          <Menu.Popup data-context-menu-owned="true" className={SURFACE_CLASSES}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Portal>
    </Menu.SubmenuRoot>
  );
}

// ─── Trigger hook (no wrapper element) ───────────────────

interface UseContextMenuTriggerOptions {
  disabled?: boolean;
  longPressDelay?: number;
  // When provided, the trigger becomes focusable and pressing Delete/Backspace
  // while it (not a child input) holds focus invokes this — the keyboard twin of
  // the context menu's destructive item. stopPropagation keeps the global
  // slide/element delete shortcut from also firing for the same keystroke.
  onDelete?: () => void;
}

export function useContextMenuTrigger({
  disabled = false,
  longPressDelay = DEFAULT_LONG_PRESS_DELAY,
  onDelete,
}: UseContextMenuTriggerOptions = {}) {
  // Rows that double as their own drag overlay render the same body outside a
  // ContextMenu.Root: there is nothing to open a menu against a floating copy,
  // and those bodies already drop the Portal in overlay mode. Treat a missing
  // Root as an inert trigger rather than throwing, so one body component can
  // serve both the live row and its overlay — every sortable list does this.
  const context = useContext(ContextMenuContext);
  const inert = disabled || context === null;
  const openAt = context?.actions.openAt;
  const triggerRef = context?.meta.triggerRef;
  const isOpen = context?.state.open ?? false;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchOriginRef = useRef<ContextMenuPoint | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (triggerRef) triggerRef.current = node as HTMLDivElement | null;
    },
    [triggerRef],
  );

  return useMemo(
    () => ({
      ref,
      'data-state': isOpen ? 'open' : 'closed',
      tabIndex: onDelete ? 0 : undefined,
      onContextMenu(event: ReactMouseEvent<HTMLElement>) {
        if (inert) return;
        event.preventDefault();
        openAt?.({ x: event.clientX, y: event.clientY });
      },
      onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
        if (inert) return;
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          openAt?.({
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + Math.min(rect.height, 24) / 2),
          });
          return;
        }
        // Only the focused trigger itself deletes — never a keystroke bubbling up
        // from a child rename input, where Backspace must edit text.
        if (onDelete && event.target === event.currentTarget && (event.key === 'Delete' || event.key === 'Backspace')) {
          event.preventDefault();
          event.stopPropagation();
          onDelete();
        }
      },
      onTouchStart(event: ReactTouchEvent<HTMLElement>) {
        if (inert || event.touches.length !== 1) return;
        const touch = event.touches[0];
        touchOriginRef.current = { x: touch.clientX, y: touch.clientY };
        clearLongPress();
        longPressTimerRef.current = setTimeout(() => {
          if (!touchOriginRef.current) return;
          openAt?.(touchOriginRef.current);
          touchOriginRef.current = null;
          longPressTimerRef.current = null;
        }, longPressDelay);
      },
      onTouchMove(event: ReactTouchEvent<HTMLElement>) {
        if (!touchOriginRef.current || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const deltaX = Math.abs(touch.clientX - touchOriginRef.current.x);
        const deltaY = Math.abs(touch.clientY - touchOriginRef.current.y);
        if (deltaX > 10 || deltaY > 10) {
          touchOriginRef.current = null;
          clearLongPress();
        }
      },
      onTouchEnd() {
        touchOriginRef.current = null;
        clearLongPress();
      },
      onTouchCancel() {
        touchOriginRef.current = null;
        clearLongPress();
      },
    }),
    [clearLongPress, inert, isOpen, longPressDelay, onDelete, openAt, ref],
  );
}

export const ContextMenu = Object.assign(Root, {
  Portal,
  Positioner,
  Root,
  Trigger,
  Menu: MenuSurface,
  Item,
  Separator,
  Submenu,
});
