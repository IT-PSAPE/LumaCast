import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@renderer/utils/cn';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { OverlayPortal } from './overlay-primitives';
import { Popover } from './popover';

const DEFAULT_LONG_PRESS_DELAY = 500;
const DEFAULT_VIEWPORT_PADDING = 8;
const OWNED_MENU_SELECTOR = '[data-context-menu-owned="true"]';

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
  // a Dialog/Popover layer above their parent. Caller may pass `zIndex` to
  // override (rare). NB: depend on the stable `register`/`unregister` callbacks,
  // not the whole `overlayStack` object — see Popover for the same caveat.
  const { overlayStack } = useWorkbench();
  const { register, unregister } = overlayStack;
  const contextMenuId = useId();
  useEffect(() => {
    if (!resolvedOpen) return undefined;
    register(contextMenuId);
    return () => unregister(contextMenuId);
  }, [contextMenuId, register, unregister, resolvedOpen]);
  const stackIndex = overlayStack.stack.indexOf(contextMenuId);
  const computedZIndex = zIndex ?? overlayStack.baseZIndex + Math.max(stackIndex, 0) * 10;

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

  useEffect(() => {
    if (!resolvedOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (target instanceof Element && target.closest(OWNED_MENU_SELECTOR)) {
        return;
      }

      if (positionerRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }

      close();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      close();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, resolvedOpen]);

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
      {children}
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

function Portal({ children }: { children: ReactNode }) {
  const { meta, state } = useContextMenu();

  return (
    <OverlayPortal isOpen={state.open && state.position !== null} zIndex={meta.zIndex}>
      {children}
    </OverlayPortal>
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
  const [position, setPosition] = useState<ContextMenuPoint | null>(null);

  const clampPosition = useCallback(() => {
    const nextPosition = state.position;
    const node = meta.positionerRef.current;

    if (!nextPosition || !node) {
      return;
    }

    const rect = node.getBoundingClientRect();

    setPosition({
      x: Math.max(
        viewportPadding,
        Math.min(nextPosition.x, window.innerWidth - rect.width - viewportPadding),
      ),
      y: Math.max(
        viewportPadding,
        Math.min(nextPosition.y, window.innerHeight - rect.height - viewportPadding),
      ),
    });
  }, [meta.positionerRef, state.position, viewportPadding]);

  useLayoutEffect(() => {
    if (!state.open || !state.position) {
      setPosition(null);
      return;
    }

    clampPosition();
  }, [clampPosition, state.open, state.position]);

  useEffect(() => {
    if (!state.open || !state.position) {
      return undefined;
    }

    function handleResize() {
      clampPosition();
    }

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [clampPosition, state.open, state.position]);

  if (!state.open || !state.position) {
    return null;
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    onContextMenu?.(event);

    if (!event.defaultPrevented) {
      event.preventDefault();
    }
  }

  const isPositioned = position !== null;

  return (
    <div
      {...props}
      ref={meta.positionerRef}
      data-context-menu-owned="true"
      className={cn('pointer-events-auto fixed', className)}
      onContextMenu={handleContextMenu}
      style={{
        ...style,
        left: isPositioned ? position.x : -9999,
        top: isPositioned ? position.y : -9999,
        visibility: isPositioned ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>
  );
}

// ─── Menu (styled positioner surface) ────────────────────

interface MenuProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

function Menu({ children, className, ...props }: MenuProps) {
  return (
    <Positioner
      role="menu"
      {...props}
      className={cn(
        'min-w-30 max-h-60 overflow-y-auto rounded-md border border-primary bg-primary p-1 shadow-lg',
        className,
      )}
    >
      {children}
    </Positioner>
  );
}

// ─── Item ────────────────────────────────────────────────

type ContextMenuItemVariant = 'default' | 'destructive';

interface ItemProps {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: ContextMenuItemVariant;
}

function Item({ children, onSelect, disabled = false, className, variant = 'default' }: ItemProps) {
  const { actions } = useContextMenu();

  function handleClick() {
    if (disabled) return;
    onSelect?.();
    actions.close();
  }

  const variantClasses = variant === 'destructive'
    ? 'text-error hover:bg-error_primary hover:text-error'
    : 'text-secondary hover:bg-tertiary';

  return (
    <button
      type="button"
      role="menuitem"
      data-context-menu-item=""
      data-disabled={disabled || undefined}
      onClick={handleClick}
      // Prevent the document pointerdown from closing the menu before the click fires.
      onPointerDown={(event) => event.preventDefault()}
      className={cn(
        'flex w-full select-none gap-2 rounded px-2 py-1.5 text-left text-sm',
        variantClasses,
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ─── Separator ───────────────────────────────────────────

function Separator() {
  return <div role="separator" className="my-1 h-px bg-tertiary" />;
}

// ─── Submenu (flyout) ────────────────────────────────────
// Opens a sibling menu to the right of the trigger row when hovered or
// activated by keyboard. The submenu reuses Popover for positioning so it
// flips to the left edge when the parent menu is near the viewport.

const SUBMENU_HOVER_CLOSE_DELAY = 120;

interface SubmenuProps {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

function Submenu({ label, children, disabled = false, className }: SubmenuProps) {
  const { state: parentState } = useContextMenu();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the parent menu closes (e.g. after a child Item fires actions.close)
  // collapse the submenu too so its popover doesn't linger.
  useEffect(() => {
    if (!parentState.open) setOpen(false);
  }, [parentState.open]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), SUBMENU_HOVER_CLOSE_DELAY);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  function handleTriggerClick() {
    if (disabled) return;
    cancelClose();
    setOpen((prev) => !prev);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      cancelClose();
      setOpen(true);
    } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        data-context-menu-item=""
        data-disabled={disabled || undefined}
        onPointerDown={(event) => event.preventDefault()}
        onMouseEnter={() => { cancelClose(); if (!disabled) setOpen(true); }}
        onMouseLeave={scheduleClose}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex w-full select-none items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-secondary hover:bg-tertiary',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          className,
        )}
      >
        <span className="flex-1">{label}</span>
        <ChevronRight className="size-3.5 shrink-0 text-tertiary" />
      </button>
      <Popover
        anchor={triggerRef.current}
        open={open && !disabled}
        onClose={() => setOpen(false)}
        placement="right-start"
        offset={4}
      >
        <div
          role="menu"
          data-context-menu-owned="true"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className="min-w-30 max-h-60 overflow-y-auto rounded-md border border-primary bg-primary p-1 shadow-lg"
        >
          {children}
        </div>
      </Popover>
    </>
  );
}

// ─── Trigger hook (no wrapper element) ───────────────────

interface UseContextMenuTriggerOptions {
  disabled?: boolean;
  longPressDelay?: number;
}

export function useContextMenuTrigger({
  disabled = false,
  longPressDelay = DEFAULT_LONG_PRESS_DELAY,
}: UseContextMenuTriggerOptions = {}) {
  const { actions, meta, state } = useContextMenu();
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
      meta.triggerRef.current = node as HTMLDivElement | null;
    },
    [meta.triggerRef],
  );

  return useMemo(
    () => ({
      ref,
      'data-state': state.open ? 'open' : 'closed',
      onContextMenu(event: ReactMouseEvent<HTMLElement>) {
        if (disabled) return;
        event.preventDefault();
        actions.openAt({ x: event.clientX, y: event.clientY });
      },
      onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
        if (disabled) return;
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          actions.openAt({
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + Math.min(rect.height, 24) / 2),
          });
        }
      },
      onTouchStart(event: ReactTouchEvent<HTMLElement>) {
        if (disabled || event.touches.length !== 1) return;
        const touch = event.touches[0];
        touchOriginRef.current = { x: touch.clientX, y: touch.clientY };
        clearLongPress();
        longPressTimerRef.current = setTimeout(() => {
          if (!touchOriginRef.current) return;
          actions.openAt(touchOriginRef.current);
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
    [actions, clearLongPress, disabled, longPressDelay, ref, state.open],
  );
}

export const ContextMenu = Object.assign(Root, {
  Portal,
  Positioner,
  Root,
  Trigger,
  Menu,
  Item,
  Separator,
  Submenu,
});
