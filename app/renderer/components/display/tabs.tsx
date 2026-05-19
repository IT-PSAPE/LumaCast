import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';
import { ScrollArea } from '../layout/scroll-area';

type TabsOrientation = 'horizontal' | 'vertical';
type TabsActivationMode = 'automatic' | 'manual';

interface TabsContextValue {
  state: { value: string | undefined };
  actions: {
    registerTrigger: (value: string, node: HTMLButtonElement | null) => void;
    setValue: (value: string) => void;
  };
  meta: {
    activationMode: TabsActivationMode;
    baseId: string;
    orientation: TabsOrientation;
  };
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tabs sub-components must be used within Tabs.Root');
  return context;
}

function sanitizeTabValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

// Inner nav uses max-content sizing so triggers keep their natural width and
// overflow the viewport (which then scrolls) instead of shrinking to fit.
const listStyles = cv({
  base: 'flex items-center gap-2',
  variants: {
    orientation: {
      horizontal: 'w-max',
      vertical: 'h-max flex-col items-start',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

const tabStyles = cv({
  base: 'cursor-pointer leading-tight transition-colors relative h-8 flex items-center justify-center label-xs px-2',
  variants: {
    active: {
      true: 'text-primary',
      false: 'text-tertiary hover:text-secondary',
    }
  },
  defaultVariants: {
    active: false,
  }
});

interface RootProps {
  activationMode?: TabsActivationMode;
  children: ReactNode;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: TabsOrientation;
  value?: string;
}

function Root({ activationMode = 'automatic', children, defaultValue, onValueChange, orientation = 'horizontal', value }: RootProps) {
  const baseId = useId();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const resolvedValue = isControlled ? value : internalValue;
  const triggerMapRef = useRef(new Map<string, HTMLButtonElement>());

  function setValue(nextValue: string) {
    if (!isControlled) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }

  function registerTrigger(triggerValue: string, node: HTMLButtonElement | null) {
    if (!node) {
      triggerMapRef.current.delete(triggerValue);
      return;
    }
    triggerMapRef.current.set(triggerValue, node);
  }

  const context = useMemo<TabsContextValue>(() => ({
    state: { value: resolvedValue },
    actions: { registerTrigger, setValue },
    meta: { activationMode, baseId, orientation },
  }), [activationMode, baseId, orientation, resolvedValue]);

  return <TabsContext.Provider value={context}>{children}</TabsContext.Provider>;
}

interface ListProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  label: string;
  tabsClassName?: string;
}

function List({ children, className, label, tabsClassName, ...rest }: ListProps) {
  const { actions, meta } = useTabs();
  // Override the ScrollArea.Root default `size-full` so the tab list sizes to
  // its triggers along the cross-axis (h-auto for horizontal, w-auto for vertical).
  const rootSizing = meta.orientation === 'horizontal'
    ? 'h-auto w-full min-w-0'
    : 'w-auto h-full min-h-0';

  const classes = listStyles({ orientation: meta.orientation, className: tabsClassName });

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const triggerValues = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
      (node) => node.dataset.tabValue ?? '',
    ).filter(Boolean);

    if (triggerValues.length === 0) return;

    const currentIndex = triggerValues.findIndex((value) => value === (event.target as HTMLElement | null)?.dataset.tabValue);
    if (currentIndex === -1) return;

    const isHorizontal = meta.orientation === 'horizontal';
    const previousKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
    const nextKey = isHorizontal ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== previousKey && event.key !== nextKey && event.key !== 'Home' && event.key !== 'End') return;

    event.preventDefault();

    let nextIndex = currentIndex;
    if (event.key === previousKey) nextIndex = (currentIndex - 1 + triggerValues.length) % triggerValues.length;
    else if (event.key === nextKey) nextIndex = (currentIndex + 1) % triggerValues.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = triggerValues.length - 1;

    const nextValue = triggerValues[nextIndex];
    const nextTrigger = document.getElementById(`${meta.baseId}-trigger-${sanitizeTabValue(nextValue)}`) as HTMLButtonElement | null;
    nextTrigger?.focus();
    if (meta.activationMode === 'automatic') {
      actions.setValue(nextValue);
    }
  }

  return (
    <ScrollArea.Root className={cn(rootSizing, className)}>
      <ScrollArea.Viewport>
        <nav className={classes} aria-label={label} role="tablist" aria-orientation={meta.orientation} onKeyDown={handleKeyDown} {...rest} >
          {children}
        </nav>
      </ScrollArea.Viewport>
    </ScrollArea.Root>
  );
}

interface TriggerProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'children' | 'onChange'> {
  children: ReactNode;
  disabled?: boolean;
  value: string;
}

function Trigger({ children, className, disabled = false, value, ...rest }: TriggerProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { actions, meta, state } = useTabs();
  const active = state.value === value;
  const triggerId = `${meta.baseId}-trigger-${sanitizeTabValue(value)}`;
  const panelId = `${meta.baseId}-panel-${sanitizeTabValue(value)}`;

  useEffect(() => {
    actions.registerTrigger(value, buttonRef.current);
    return () => {
      actions.registerTrigger(value, null);
    };
  }, [actions, value]);

  function handleClick() {
    if (disabled) return;
    actions.setValue(value);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (meta.activationMode !== 'manual') return;
    if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
      event.preventDefault();
      actions.setValue(value);
    }
  }

  const classes = cn(tabStyles({ active }), className);

  return (
    <button
      {...rest}
      ref={buttonRef}
      id={triggerId}
      type="button"
      role="tab"
      data-tab-value={value}
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={classes}
    >
      {children}
      {active && <Indicator />}
    </button>
  );
}

function Panel({ children, value, className }: { children?: ReactNode; className?: string, value: string }) {
  const { state } = useTabs();

  if (value !== state.value) return null;

  return (
    <div className={className}>
      {children}
    </div>
  )
}

function Indicator() {
  return <span className='absolute inset-0 top-auto bg-brand_primary h-[1px]' />;
}

export const Tabs = { Root, List, Trigger, Indicator, Panel };
