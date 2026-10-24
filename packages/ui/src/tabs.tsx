import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { createContext, useContext, type ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';

// Tabs switches between views and owns the panels for them. It is not
// SegmentedControl, which picks a value and has no panels. Keep them distinct.

type Orientation = 'horizontal' | 'vertical';
type Variant = 'underline' | 'pill' | 'plain';
type Size = 'sm' | 'md';

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  orientation?: Orientation;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

export interface TabsListProps {
  className?: string;
  children: ReactNode;
}

export interface TabsTabProps {
  value: string;
  disabled?: boolean;
  icon?: ReactNode;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
}

export interface TabsPanelProps {
  value: string;
  className?: string;
  children: ReactNode;
}

// Tab styling depends on Root props; Base UI's own context carries the rest.
interface TabsStyleValue {
  orientation: Orientation;
  variant: Variant;
  size: Size;
}

const TabsStyleContext = createContext<TabsStyleValue | null>(null);

function useTabsStyle() {
  const context = useContext(TabsStyleContext);
  if (!context) throw new Error('Tabs sub-components must be used within Tabs');
  return context;
}

const listStyles = cv({
  base: 'flex',
  variants: {
    orientation: {
      horizontal: 'flex-row items-center',
      vertical: 'flex-col items-stretch gap-0.5',
    },
    variant: {
      underline: '',
      pill: 'gap-1',
      plain: 'gap-2',
    },
  },
  compoundVariants: [
    { variant: 'underline', orientation: 'horizontal', class: 'border-b border-primary' },
    { variant: 'underline', orientation: 'vertical', class: 'border-r border-primary' },
  ],
  defaultVariants: { orientation: 'horizontal', variant: 'underline' },
});

const tabStyles = cv({
  base: [
    'flex cursor-pointer items-center gap-1.5 outline-none transition-colors',
    'text-tertiary hover:text-secondary data-[active]:text-primary',
    'focus-visible:ring-2 focus-visible:ring-brand/40',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  ],
  variants: {
    orientation: {
      horizontal: 'justify-center',
      vertical: 'justify-start text-left',
    },
    variant: {
      underline: 'border-transparent data-[active]:border-brand data-[active]:text-brand',
      pill: 'rounded-md hover:bg-tertiary data-[active]:bg-brand/10 data-[active]:text-brand',
      plain: 'data-[active]:text-primary',
    },
    size: {
      sm: 'label-xs min-h-6 px-2',
      md: 'label-xs min-h-8 px-3',
    },
  },
  compoundVariants: [
    { variant: 'underline', orientation: 'horizontal', class: 'border-b-2 -mb-px' },
    { variant: 'underline', orientation: 'vertical', class: 'border-r-2 -mr-px' },
  ],
  defaultVariants: { orientation: 'horizontal', variant: 'underline', size: 'md' },
});

function Root({
  value,
  onValueChange,
  orientation = 'horizontal',
  variant = 'underline',
  size = 'md',
  className,
  children,
}: TabsProps) {
  return (
    <TabsStyleContext.Provider value={{ orientation, variant, size }}>
      <BaseTabs.Root
        value={value}
        orientation={orientation}
        onValueChange={(next) => {
          if (typeof next === 'string') onValueChange(next);
        }}
        className={cn(orientation === 'vertical' ? 'flex flex-row' : 'flex flex-col', className)}
      >
        {children}
      </BaseTabs.Root>
    </TabsStyleContext.Provider>
  );
}

function List({ className, children }: TabsListProps) {
  const { orientation, variant } = useTabsStyle();
  return (
    <BaseTabs.List activateOnFocus className={listStyles({ orientation, variant, className })}>
      {children}
    </BaseTabs.List>
  );
}

function Tab({ value, disabled, icon, badge, className, children }: TabsTabProps) {
  const { orientation, variant, size } = useTabsStyle();
  return (
    <BaseTabs.Tab
      value={value}
      disabled={disabled}
      className={tabStyles({ orientation, variant, size, className })}
    >
      {icon}
      <span className="truncate">{children}</span>
      {badge ? <span className="ml-auto text-tertiary">{badge}</span> : null}
    </BaseTabs.Tab>
  );
}

// Base UI unmounts inactive panels by default and wires aria-labelledby to the tab.
function Panel({ value, className, children }: TabsPanelProps) {
  return (
    <BaseTabs.Panel value={value} className={cn('min-h-0 min-w-0 flex-1', className)}>
      {children}
    </BaseTabs.Panel>
  );
}

export const Tabs = Object.assign(Root, { List, Tab, Panel });
