import { Children, createContext, isValidElement, useContext, useId, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Accordion } from './accordion';
import { cn } from './cn';
import { cv } from './cv';
import { Field } from './field';

// A titled property group. Collapsing is NOT reimplemented here: when
// `collapsible`, Section renders the shared Accordion (one item) and its
// Header/Body map onto Accordion.Header/Accordion.Panel, so aria-expanded,
// keyboard handling, animated height and reduced-motion come from there.
// Non-collapsible sections are plain markup. Section.Row is a thin layout over
// Field (see SectionRowProps).

type Density = 'compact' | 'comfortable';

export interface SectionProps {
  collapsible?: boolean;
  /** Initial state when uncontrolled. Defaults to open. */
  defaultOpen?: boolean;
  /** Controlled open state. Ignored unless `collapsible`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  density?: Density;
  className?: string;
  children: ReactNode;
}
export interface SectionHeaderProps {
  /** Optional icon before the title. */
  icon?: ReactNode;
  className?: string;
  /** Section.Title and Section.Actions. */
  children: ReactNode;
}
export interface SectionTitleProps {
  children: ReactNode;
}
export interface SectionActionsProps {
  children: ReactNode;
}
export interface SectionBodyProps {
  className?: string;
  children: ReactNode;
}
export interface SectionRowProps {
  /** Visible label. Omit for a label-less row (e.g. controls with their own hidden labels). */
  label?: string;
  /** `2` lays children out as an equal two-column grid. Default 1 (single control). */
  columns?: 1 | 2;
  /** Id of the control the label names (forwarded to Field). */
  htmlFor?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  /** `inline`: label beside the control. `stacked`: label above it. */
  layout?: 'inline' | 'stacked';
  /** Inline label column width in px or any CSS length. Default 6rem. */
  labelWidth?: number | string;
  className?: string;
  children: ReactNode;
}

const SectionContext = createContext<{ collapsible: boolean; density: Density }>({
  collapsible: false,
  density: 'comfortable',
});

const rootStyles = cv({
  base: 'flex min-w-0 flex-col',
  variants: { density: { compact: 'gap-1', comfortable: 'gap-2' } },
});
const headerStyles = cv({
  base: 'flex min-w-0 items-center gap-1',
  variants: { density: { compact: 'py-1', comfortable: 'py-1.5' } },
});
const titleStyles = cv({
  base: 'm-0 min-w-0 flex-1 truncate text-primary',
  variants: { density: { compact: 'label-xs', comfortable: 'label-sm' } },
});
const bodyStyles = cv({
  base: 'flex min-w-0 flex-col',
  variants: { density: { compact: 'gap-1.5', comfortable: 'gap-3' } },
});

function Title(_props: SectionTitleProps): ReactElement | null {
  // Slot marker: Header reads its children. Never rendered directly.
  return null;
}
function Actions(_props: SectionActionsProps): ReactElement | null {
  return null;
}

function Root({ collapsible = false, defaultOpen = true, open, onOpenChange, density = 'comfortable', className, children }: SectionProps) {
  const itemId = useId();
  const content = (
    <div className={rootStyles({ density, className })}>{children}</div>
  );
  if (!collapsible) {
    return <SectionContext.Provider value={{ collapsible, density }}>{content}</SectionContext.Provider>;
  }
  return (
    <SectionContext.Provider value={{ collapsible, density }}>
      <Accordion
        multiple
        variant="plain"
        size={density === 'compact' ? 'sm' : 'md'}
        value={open === undefined ? undefined : open ? [itemId] : []}
        defaultValue={defaultOpen ? [itemId] : []}
        onValueChange={(next) => onOpenChange?.(next.includes(itemId))}
        className={className}
      >
        <Accordion.Item value={itemId}>{children}</Accordion.Item>
      </Accordion>
    </SectionContext.Provider>
  );
}

function Header({ icon, className, children }: SectionHeaderProps) {
  const { collapsible, density } = useContext(SectionContext);
  let title: ReactNode = null;
  let actions: ReactNode = null;
  for (const child of Children.toArray(children)) {
    if (isValidElement<{ children: ReactNode }>(child)) {
      if (child.type === Title) title = child.props.children;
      else if (child.type === Actions) actions = child.props.children;
    }
  }
  if (collapsible) {
    return (
      <Accordion.Header icon={icon} actions={actions} className={className}>
        {title}
      </Accordion.Header>
    );
  }
  return (
    <div className={headerStyles({ density, className })}>
      {icon ? <span className="inline-flex shrink-0 text-secondary">{icon}</span> : null}
      <h3 className={titleStyles({ density })}>{title}</h3>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

function Body({ className, children }: SectionBodyProps) {
  const { collapsible, density } = useContext(SectionContext);
  if (collapsible) {
    return (
      <Accordion.Panel>
        <div className={bodyStyles({ density, className })}>{children}</div>
      </Accordion.Panel>
    );
  }
  return <div className={bodyStyles({ density, className })}>{children}</div>;
}

function Row({ label, columns = 1, htmlFor, hint, error, disabled, layout = 'inline', labelWidth = '6rem', className, children }: SectionRowProps) {
  const width = typeof labelWidth === 'number' ? `${labelWidth}px` : labelWidth;
  const content = columns === 2 ? <div className="grid min-w-0 grid-cols-2 gap-1.5">{children}</div> : children;
  if (label === undefined) {
    return <div className={cn('min-w-0', className)}>{content}</div>;
  }
  return (
    <div style={{ '--section-label-w': width } as CSSProperties} className="min-w-0">
      <Field
        label={label}
        labelPlacement={layout === 'inline' ? 'inline' : 'top'}
        htmlFor={htmlFor}
        hint={hint}
        error={error}
        disabled={disabled}
        className={cn(layout === 'inline' && '[&>div>label]:w-(--section-label-w) [&>div>label]:truncate', className)}
      >
        {content}
      </Field>
    </div>
  );
}

export const Section = Object.assign(Root, { Header, Title, Actions, Body, Row });
