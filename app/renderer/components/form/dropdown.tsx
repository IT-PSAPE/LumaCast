import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { Popover, PopoverPlacement } from '../overlays/popover';

// ─── Context ─────────────────────────────────────────────

interface DropdownContextValue {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
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
  const [typeAhead, setTypeAhead] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const highlightedRef = useRef(-1);
  const typeAheadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function getItemNodes(): HTMLElement[] {
    if (!panelRef.current) return [];
    return Array.from(panelRef.current.querySelectorAll<HTMLElement>('[data-dropdown-item]:not([data-disabled])'));
  }

  function setHighlight(index: number) {
    const items = getItemNodes();
    const prev = items[highlightedRef.current];
    if (prev) prev.removeAttribute('data-highlighted');
    const next = items[index];
    if (next) {
      next.setAttribute('data-highlighted', '');
      next.scrollIntoView({ block: 'nearest' });
    }
    highlightedRef.current = index;
  }

  const handleOpen = useCallback(() => {
    setOpen(true);
    highlightedRef.current = -1;
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    highlightedRef.current = -1;
    setTypeAhead('');
  }, []);

  function handleTypeAheadChar(char: string) {
    const next = typeAhead + char.toLowerCase();
    setTypeAhead(next);
    clearTimeout(typeAheadTimer.current);
    typeAheadTimer.current = setTimeout(() => setTypeAhead(''), 500);

    const items = getItemNodes();
    const matchIndex = items.findIndex((n) => (n.textContent ?? '').toLowerCase().startsWith(next));
    if (matchIndex >= 0) setHighlight(matchIndex);
  }

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        handleOpen();
      }
      return;
    }

    const items = getItemNodes();
    const count = items.length;
    if (count === 0) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        setHighlight(Math.min(highlightedRef.current + 1, count - 1));
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        setHighlight(Math.max(highlightedRef.current - 1, 0));
        break;
      }
      case 'Home': {
        event.preventDefault();
        setHighlight(0);
        break;
      }
      case 'End': {
        event.preventDefault();
        setHighlight(count - 1);
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const highlighted = items[highlightedRef.current];
        if (highlighted) highlighted.click();
        break;
      }
      case 'Escape': {
        event.preventDefault();
        handleClose();
        triggerRef.current?.focus();
        break;
      }
      case 'Tab': {
        handleClose();
        break;
      }
      default: {
        if (event.key.length === 1) {
          event.preventDefault();
          handleTypeAheadChar(event.key);
        }
      }
    }
  }, [open, handleOpen, handleClose]);

  useEffect(() => {
    return () => clearTimeout(typeAheadTimer.current);
  }, []);

  const ctx = useMemo<DropdownContextValue>(() => ({
    open,
    triggerRef,
    panelRef,
    onOpen: handleOpen,
    onClose: handleClose,
    handleKeyDown,
  }), [open, handleOpen, handleClose, handleKeyDown]);

  return (
    <DropdownContext.Provider value={ctx}>
      <div className={cn('relative min-w-0', className)}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

// ─── Trigger ─────────────────────────────────────────────

interface TriggerProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick' | 'onKeyDown' | 'onPointerDown'> {
  children: ReactNode;
}

function Trigger({ children, className, ...rest }: TriggerProps) {
  const ctx = useDropdown();

  // Toggle on pointerdown rather than click. The Popover registers its
  // outside-close listener on `window` for `pointerdown`; using `click` here
  // means another open dropdown closes during pointerdown and the click that
  // should open this one can be lost when React re-renders between events.
  // Handling both on pointerdown keeps the toggle in the same event tick.
  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (ctx.open) ctx.onClose();
    else ctx.onOpen();
  }

  return (
    <button
      {...rest}
      ref={ctx.triggerRef}
      type="button"
      aria-expanded={ctx.open}
      aria-haspopup="menu"
      onPointerDown={handlePointerDown}
      onKeyDown={ctx.handleKeyDown}
      className={className}
    >
      {children}
    </button>
  );
}

// ─── Panel ───────────────────────────────────────────────

interface PanelProps {
  children: ReactNode;
  className?: string;
  placement?: PopoverPlacement;
}

function Panel({ children, className, placement }: PanelProps) {
  const ctx = useDropdown();

  return (
    <Popover anchor={ctx.triggerRef.current} open={ctx.open} onClose={ctx.onClose} placement={placement} offset={4} axisLock>
      <div
        ref={ctx.panelRef}
        role="menu"
        onKeyDown={ctx.handleKeyDown}
        className={cn('min-w-30 rounded-md border border-primary bg-primary shadow-lg max-h-60 overflow-y-auto p-1', className)}
      // style={{ minWidth: ctx.triggerRef.current?.offsetWidth }}
      >
        {children}
      </div>
    </Popover>
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
  const { onClose } = useDropdown();

  function handleClick() {
    if (disabled) return;
    onClick?.();
    onClose();
  }

  return (
    <button
      type="button"
      data-dropdown-item=""
      data-disabled={disabled || undefined}
      role="menuitem"
      onClick={handleClick}
      onPointerDown={(e) => e.preventDefault()}
      className={cn('w-full flex gap-2 rounded px-2 py-1.5 text-sm text-left select-none text-secondary data-[highlighted]:bg-secondary hover:bg-tertiary data-[highlighted]:text-primary', disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer', className)}>
      {children}
    </button>
  );
}

// ─── Separator ───────────────────────────────────────────

function Separator() {
  return <div role="separator" className="my-1 h-px bg-tertiary" />;
}

// ─── Export ──────────────────────────────────────────────

export { useDropdown };
export const Dropdown = Object.assign(Root, { Trigger, Panel, Item, Separator });
