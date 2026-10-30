import { Accordion as BaseAccordion } from '@base-ui/react/accordion';
import { createContext, useContext, type ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';

// Built on Base UI's Accordion: it owns the animated-height CSS variable,
// aria-expanded/aria-controls wiring, roving arrow-key/Home/End focus and
// controlled/uncontrolled state.

type Variant = 'plain' | 'bordered' | 'panel';
type Size = 'sm' | 'md';

export interface AccordionProps {
  value?: string[];
  onValueChange?: (value: string[]) => void;
  defaultValue?: string[];
  multiple?: boolean;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}
export interface AccordionItemProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}
export interface AccordionHeaderProps {
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}
export interface AccordionPanelProps {
  className?: string;
  children: ReactNode;
}

const StyleContext = createContext<{ variant: Variant; size: Size }>({ variant: 'plain', size: 'md' });

const rootStyles = cv({
  base: 'flex flex-col',
  variants: {
    variant: { plain: '', bordered: '', panel: 'gap-2' },
  },
});

const itemStyles = cv({
  variants: {
    variant: {
      plain: '',
      bordered: 'border-b border-secondary first:border-t',
      panel: 'overflow-hidden rounded-container border border-primary bg-secondary',
    },
  },
});

const headerRowStyles = cv({
  base: 'flex items-center gap-1',
  variants: {
    size: { sm: 'px-2', md: 'px-3' },
  },
});

const triggerStyles = cv({
  base: 'group/trigger flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-primary outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  variants: {
    size: { sm: 'label-xs py-1.5', md: 'label-sm py-2' },
  },
});

const panelContentStyles = cv({
  variants: {
    size: { sm: 'px-2 pb-2', md: 'px-3 pb-3' },
  },
});

function Root({
  value,
  onValueChange,
  defaultValue,
  multiple = true,
  variant = 'plain',
  size = 'md',
  className,
  children,
}: AccordionProps) {
  // Controlled only when `value` is supplied: Base UI treats an `undefined`
  // value as uncontrolled and `defaultValue` is ignored once controlled, so a
  // controlled consumer's state is the single source of truth.
  return (
    <StyleContext.Provider value={{ variant, size }}>
      <BaseAccordion.Root
        multiple={multiple}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onValueChange={(next) => onValueChange?.(next.map(String))}
        className={rootStyles({ variant, className })}
      >
        {children}
      </BaseAccordion.Root>
    </StyleContext.Provider>
  );
}

function Item({ value, disabled, className, children }: AccordionItemProps) {
  const { variant } = useContext(StyleContext);
  return (
    <BaseAccordion.Item value={value} disabled={disabled} className={itemStyles({ variant, className })}>
      {children}
    </BaseAccordion.Item>
  );
}

function Header({ icon, actions, className, children }: AccordionHeaderProps) {
  const { size } = useContext(StyleContext);
  // `actions` is a sibling of the heading/trigger, not a descendant of the
  // button, so clicks and key presses on it never reach the trigger.
  return (
    <div className={headerRowStyles({ size, className })}>
      <BaseAccordion.Header className="m-0 flex min-w-0 flex-1">
        <BaseAccordion.Trigger className={triggerStyles({ size })}>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4 shrink-0 text-tertiary transition-transform motion-reduce:transition-none group-data-[panel-open]/trigger:rotate-90"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          {icon ? <span className="inline-flex shrink-0 text-secondary">{icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{children}</span>
        </BaseAccordion.Trigger>
      </BaseAccordion.Header>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

function Panel({ className, children }: AccordionPanelProps) {
  const { size } = useContext(StyleContext);
  return (
    <BaseAccordion.Panel className="h-(--accordion-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none">
      <div className={cn(panelContentStyles({ size }), className)}>{children}</div>
    </BaseAccordion.Panel>
  );
}

export const Accordion = Object.assign(Root, { Item, Header, Panel });
