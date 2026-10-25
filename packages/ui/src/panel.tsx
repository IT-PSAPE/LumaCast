import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { Badge } from './badge';
import { cn } from './cn';
import { cv } from './cv';

type PanelVariant = 'plain' | 'bordered' | 'raised';
type PanelDensity = 'compact' | 'comfortable';

const rootStyles = cv({
  base: 'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-primary',
  variants: {
    variant: {
      plain: 'bg-primary',
      bordered: 'border border-secondary bg-primary',
      raised: 'rounded-md border border-secondary bg-secondary',
    },
  },
  defaultVariants: { variant: 'plain' },
});

const headerStyles = cv({
  base: 'flex shrink-0 items-center justify-between gap-2 px-3',
  variants: {
    density: { compact: 'h-8', comfortable: 'h-10' },
    divided: { true: 'border-b border-secondary', false: '' },
  },
  defaultVariants: { density: 'comfortable', divided: true },
});

const subheaderStyles = cv({
  base: 'flex shrink-0 items-center justify-between gap-2 px-3',
  variants: {
    density: { compact: 'h-7', comfortable: 'h-9' },
    divided: { true: 'border-b border-secondary', false: '' },
  },
  defaultVariants: { density: 'comfortable', divided: true },
});

const footerStyles = cv({
  base: 'flex shrink-0 items-center justify-between gap-2 border-t border-secondary px-3',
  variants: {
    density: { compact: 'min-h-8', comfortable: 'min-h-10' },
  },
  defaultVariants: { density: 'comfortable' },
});

const bodyStyles = cv({
  // flex-1 + min-h-0: a flex child defaults to min-height:auto and would grow
  // to its content instead of shrinking and scrolling inside the column.
  base: 'min-h-0 min-w-0 flex-1',
  variants: {
    scroll: { true: 'overflow-y-auto', false: 'overflow-hidden' },
    padded: { true: 'p-3', false: '' },
  },
  defaultVariants: { scroll: true, padded: false },
});

const DensityContext = createContext<PanelDensity>('comfortable');

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: PanelVariant;
  density?: PanelDensity;
}

export interface PanelHeaderProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Bottom border. Default true. */
  divided?: boolean;
}

export interface PanelHeaderTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
  icon?: ReactNode;
  /** Trailing count rendered as a Badge. */
  count?: number;
}

export interface PanelHeaderActionsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export interface PanelSubheaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Bottom border. Default true. */
  divided?: boolean;
}

export interface PanelBodyProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Scroll vertically when content overflows. Default true. */
  scroll?: boolean;
  padded?: boolean;
}

export interface PanelFooterProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export interface PanelFooterSegmentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

function Root({ children, variant, density = 'comfortable', className, ...rest }: PanelProps) {
  return (
    <DensityContext.Provider value={density}>
      <section {...rest} className={cn(rootStyles({ variant }), className)}>
        {children}
      </section>
    </DensityContext.Provider>
  );
}

function Header({ children, divided, className, ...rest }: PanelHeaderProps) {
  const density = useContext(DensityContext);
  return (
    <header {...rest} className={cn(headerStyles({ density, divided }), className)}>
      {children}
    </header>
  );
}

function HeaderTitle({ children, icon, count, className, ...rest }: PanelHeaderTitleProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {icon ? <span aria-hidden="true" className="inline-flex shrink-0 text-tertiary">{icon}</span> : null}
      <h2 {...rest} className={cn('min-w-0 truncate label-sm text-primary', className)}>{children}</h2>
      {count === undefined ? null : <Badge size="sm">{count}</Badge>}
    </div>
  );
}

function HeaderActions({ children, className, ...rest }: PanelHeaderActionsProps) {
  return (
    <div {...rest} className={cn('ml-auto flex shrink-0 items-center gap-1', className)}>
      {children}
    </div>
  );
}

function Subheader({ children, divided, className, ...rest }: PanelSubheaderProps) {
  const density = useContext(DensityContext);
  return (
    <div {...rest} className={cn(subheaderStyles({ density, divided }), className)}>
      {children}
    </div>
  );
}

function Body({ children, scroll, padded, className, ...rest }: PanelBodyProps) {
  return (
    <div {...rest} className={cn(bodyStyles({ scroll, padded }), className)}>
      {children}
    </div>
  );
}

function FooterRoot({ children, className, ...rest }: PanelFooterProps) {
  const density = useContext(DensityContext);
  return (
    <footer {...rest} className={cn(footerStyles({ density }), className)}>
      {children}
    </footer>
  );
}

function FooterStart({ children, className, ...rest }: PanelFooterSegmentProps) {
  return (
    <div {...rest} className={cn('flex min-w-0 items-center gap-2 label-xs text-tertiary', className)}>
      {children}
    </div>
  );
}

function FooterEnd({ children, className, ...rest }: PanelFooterSegmentProps) {
  return (
    <div {...rest} className={cn('ml-auto flex shrink-0 items-center gap-2 label-xs text-tertiary', className)}>
      {children}
    </div>
  );
}

const Footer = Object.assign(FooterRoot, { Start: FooterStart, End: FooterEnd });

export const Panel = Object.assign(Root, { Header, HeaderTitle, HeaderActions, Subheader, Body, Footer });
