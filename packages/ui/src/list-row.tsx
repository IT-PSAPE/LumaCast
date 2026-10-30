import { Children, createContext, isValidElement, useContext, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';

// A selectable list/nav row: leading icon, truncating label, meta, actions.
//
// Nested-interactive rule: the row is a container <div>. The clickable surface
// (button / a / role=button div) holds Leading, Label and Meta only. Actions
// are rendered as a SIBLING of that surface, never inside it, so a button in
// Actions is never a descendant of another button/link, and its clicks and
// keys cannot reach the row's handler. Both are in tab order. Actions are
// hidden until hover/focus-within for pointer users but stay in the tab order
// (opacity, not display/visibility), so keyboard users reach them.

type Density = 'compact' | 'comfortable';

export interface ListRowProps {
  selected?: boolean;
  disabled?: boolean;
  density?: Density;
  /** `hover`: actions fade in on hover, focus-within or selection (always keyboard reachable). `always`: always visible. Default `hover`. */
  actions?: 'hover' | 'always';
  /** Element of the clickable surface. `div` renders role="button" when `onClick` is set. */
  as?: 'div' | 'button' | 'a';
  /** Only used with `as="a"`. */
  href?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  'aria-label'?: string;
  className?: string;
  children: ReactNode;
}
export interface ListRowPartProps {
  className?: string;
  children: ReactNode;
}

const DensityContext = createContext<Density>('comfortable');

const rowStyles = cv({
  base: 'group/row relative flex min-w-0 items-center gap-1 rounded-control border-l-2 transition-colors motion-reduce:transition-none',
  variants: {
    density: { compact: 'min-h-6 pr-1', comfortable: 'min-h-8 pr-1.5' },
    selected: {
      true: 'border-primary bg-tertiary text-primary',
      false: 'border-transparent text-secondary hover:bg-tertiary/55',
    },
    disabled: { true: 'opacity-50', false: '' },
  },
  defaultVariants: { density: 'comfortable', selected: false, disabled: false },
});

const surfaceStyles = cv({
  base: 'flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
  variants: {
    density: { compact: 'pl-1.5', comfortable: 'pl-2' },
    interactive: { true: 'cursor-pointer', false: '' },
    disabled: { true: 'cursor-not-allowed', false: '' },
  },
});

function Leading({ className, children }: ListRowPartProps) {
  return <span className={cn('inline-flex shrink-0 items-center text-tertiary', className)}>{children}</span>;
}

export interface ListRowLabelProps extends ListRowPartProps {
  /** Secondary line under the label, truncated. */
  description?: ReactNode;
}

function Label({ className, description, children }: ListRowLabelProps) {
  const density = useContext(DensityContext);
  if (description !== undefined && description !== null && description !== false) {
    return (
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className={cn('min-w-0 truncate group-data-[selected]/row:font-semibold', density === 'compact' ? 'label-xs' : 'label-sm', className)}>{children}</span>
        <span data-list-row-description="" className="min-w-0 truncate label-xs text-tertiary">{description}</span>
      </span>
    );
  }
  return (
    <span className={cn('min-w-0 flex-1 truncate group-data-[selected]/row:font-semibold', density === 'compact' ? 'label-xs' : 'label-sm', className)}>
      {children}
    </span>
  );
}

function Meta({ className, children }: ListRowPartProps) {
  return <span className={cn('label-xs shrink-0 tabular-nums text-tertiary', className)}>{children}</span>;
}

function Actions(_props: ListRowPartProps): ReactElement | null {
  // Slot marker: Root renders it outside the clickable surface.
  return null;
}

function Root({ selected = false, disabled = false, density = 'comfortable', actions: actionsMode = 'hover', as = 'div', href, onClick, 'aria-label': ariaLabel, className, children }: ListRowProps) {
  const surface: ReactNode[] = [];
  let actions: ReactNode = null;
  let actionsClassName: string | undefined;
  for (const child of Children.toArray(children)) {
    if (isValidElement<ListRowPartProps>(child) && child.type === Actions) {
      actions = child.props.children;
      actionsClassName = child.props.className;
    } else {
      surface.push(child);
    }
  }

  const surfaceClass = surfaceStyles({ density, interactive: Boolean(onClick) || as !== 'div', disabled });
  const common = { 'aria-label': ariaLabel, 'aria-current': selected ? ('true' as const) : undefined, className: surfaceClass };

  let surfaceEl: ReactElement;
  if (as === 'button') {
    surfaceEl = (
      <button type="button" disabled={disabled} onClick={onClick} {...common}>
        {surface}
      </button>
    );
  } else if (as === 'a') {
    surfaceEl = (
      <a
        href={disabled ? undefined : href}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={disabled ? (event) => event.preventDefault() : onClick}
        {...common}
      >
        {surface}
      </a>
    );
  } else if (onClick) {
    surfaceEl = (
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (disabled || event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
        {...common}
      >
        {surface}
      </div>
    );
  } else {
    surfaceEl = <div {...common}>{surface}</div>;
  }

  return (
    <DensityContext.Provider value={density}>
      <div data-selected={selected ? '' : undefined} data-disabled={disabled ? '' : undefined} className={rowStyles({ density, selected, disabled, className })}>
        {surfaceEl}
        {actions ? (
          <div
            className={cn(
              'flex shrink-0 items-center gap-1',
              actionsMode === 'hover' && 'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[selected]/row:opacity-100 motion-reduce:transition-none',
              actionsClassName,
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </DensityContext.Provider>
  );
}

export const ListRow = Object.assign(Root, { Leading, Label, Meta, Actions });
