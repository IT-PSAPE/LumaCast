import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';
import { ScrollArea } from '../layout/scroll-area';

type TabsOrientation = 'horizontal' | 'vertical';
type TabsActivationMode = 'automatic' | 'manual';

// Only List needs to know the orientation/activation mode chosen on Root (to
// size its ScrollArea wrapper and to tell Base UI's List whether arrow-key
// focus should activate a tab immediately). Tab/Panel/Indicator get
// everything else they need from Base UI's own internal Tabs context.
interface TabsMetaValue {
  activationMode: TabsActivationMode;
  orientation: TabsOrientation;
}

const TabsMetaContext = createContext<TabsMetaValue | null>(null);

function useTabsMeta() {
  const context = useContext(TabsMetaContext);
  if (!context) throw new Error('Tabs sub-components must be used within Tabs.Root');
  return context;
}

// Inner nav uses max-content sizing so triggers keep their natural width and
// overflow the viewport (which then scrolls) instead of shrinking to fit.
const listStyles = cv({
  base: 'relative flex items-center gap-2',
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

interface RootProps {
  activationMode?: TabsActivationMode;
  children: ReactNode;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: TabsOrientation;
  value?: string;
}

function Root({ activationMode = 'automatic', children, defaultValue, onValueChange, orientation = 'horizontal', value }: RootProps) {
  return (
    <TabsMetaContext.Provider value={{ activationMode, orientation }}>
      {/* display:contents keeps Root out of the box tree, same as the plain
          context provider this used to be, so surrounding flex/grid layouts
          see List/Panel as if they were direct children. */}
      <BaseTabs.Root
        className="contents"
        orientation={orientation}
        value={value}
        defaultValue={defaultValue ?? null}
        onValueChange={(nextValue) => {
          if (typeof nextValue === 'string') onValueChange?.(nextValue);
        }}
      >
        {children}
      </BaseTabs.Root>
    </TabsMetaContext.Provider>
  );
}

interface ListProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  label: string;
  tabsClassName?: string;
}

function List({ children, className, label, tabsClassName, ...rest }: ListProps) {
  const { activationMode, orientation } = useTabsMeta();
  // Override the ScrollArea.Root default `size-full` so the tab list sizes to
  // its triggers along the cross-axis (h-auto for horizontal, w-auto for vertical).
  const rootSizing = orientation === 'horizontal'
    ? 'h-auto w-full min-w-0'
    : 'w-auto h-full min-h-0';

  return (
    <ScrollArea.Root className={cn(rootSizing, className)}>
      <ScrollArea.Viewport>
        <BaseTabs.List
          {...rest}
          activateOnFocus={activationMode === 'automatic'}
          render={<nav aria-label={label} />}
          className={listStyles({ orientation, className: tabsClassName })}
        >
          {children}
          <Indicator />
        </BaseTabs.List>
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
  return (
    <BaseTabs.Tab
      {...rest}
      value={value}
      disabled={disabled}
      className={cn(
        'cursor-pointer leading-tight transition-colors h-8 flex items-center justify-center label-xs px-2 outline-none',
        'text-tertiary hover:text-secondary data-[active]:text-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
    >
      {children}
    </BaseTabs.Tab>
  );
}

function Panel({ children, value, className }: { children?: ReactNode; className?: string, value: string }) {
  return (
    <BaseTabs.Panel value={value} className={className}>
      {children}
    </BaseTabs.Panel>
  );
}

function Indicator() {
  return (
    <BaseTabs.Indicator className="absolute bottom-0 left-0 h-px w-(--active-tab-width) translate-x-(--active-tab-left) bg-brand/15 transition-[translate,width]" />
  );
}

export const Tabs = { Root, List, Trigger, Indicator, Panel };
