import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';

export type BannerTone = 'info' | 'success' | 'warning' | 'error';

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  /** Body copy. */
  children?: ReactNode;
  /** Defaults to a tone-appropriate glyph; pass `null` to suppress. */
  icon?: ReactNode;
  /** Trailing on wide banners, wraps below the text when narrow. */
  action?: ReactNode;
  /** When supplied, renders a close control. */
  onDismiss?: () => void;
  variant?: 'soft' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

// Tints follow ReacstButton's take/danger variants (`bg-<tone>/15`).
// Info uses the brand colour as its tone.
const bannerVariants = cv({
  base: 'flex w-full flex-wrap items-start rounded-sm text-primary',
  variants: {
    variant: { soft: null, outline: 'border bg-transparent' },
    tone: { info: null, success: null, warning: null, error: null },
    size: { sm: 'gap-x-2 gap-y-1.5 px-2 py-1.5', md: 'gap-x-3 gap-y-2 px-3 py-2.5' },
  },
  compoundVariants: [
    { variant: 'soft', tone: 'info', className: 'bg-brand/15' },
    { variant: 'soft', tone: 'success', className: 'bg-success/15' },
    { variant: 'soft', tone: 'warning', className: 'bg-warning/15' },
    { variant: 'soft', tone: 'error', className: 'bg-error/15' },
    { variant: 'outline', tone: 'info', className: 'border-brand' },
    { variant: 'outline', tone: 'success', className: 'border-success' },
    { variant: 'outline', tone: 'warning', className: 'border-warning' },
    { variant: 'outline', tone: 'error', className: 'border-error' },
  ],
  defaultVariants: { variant: 'soft', tone: 'info', size: 'md' },
});

const iconTone: Record<BannerTone, string> = {
  info: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

function ToneGlyph({ tone }: { tone: BannerTone }): ReactElement {
  const paths: Record<BannerTone, ReactElement> = {
    info: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 7.25v3.5M8 5.1v.01" />
      </>
    ),
    success: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="m5.5 8.2 1.7 1.7 3.3-3.6" />
      </>
    ),
    warning: (
      <>
        <path d="M8 2 14.2 13H1.8L8 2Z" />
        <path d="M8 6.5v3M8 11.3v.01" />
      </>
    ),
    error: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 4.9v3.6M8 10.9v.01" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-full"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[tone]}
    </svg>
  );
}

export function Banner({
  tone = 'info',
  title,
  children,
  icon,
  action,
  onDismiss,
  variant = 'soft',
  size = 'md',
  className,
}: BannerProps): ReactElement {
  const live = tone === 'warning' || tone === 'error';
  const glyph = icon === undefined ? <ToneGlyph tone={tone} /> : icon;
  const hasBody = children !== undefined && children !== null && children !== false;
  const sm = size === 'sm';

  return (
    <div
      role={live ? 'alert' : 'status'}
      aria-live={live ? undefined : 'polite'}
      className={bannerVariants({ tone, variant, size, className })}
    >
      {glyph !== null && glyph !== false ? (
        <span className={cn('flex shrink-0 items-center justify-center', sm ? 'size-4' : 'size-5', iconTone[tone])}>
          {glyph}
        </span>
      ) : null}
      {title || hasBody ? (
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5 self-center">
          {title ? <p className={sm ? 'label-xs' : 'label-sm'}>{title}</p> : null}
          {hasBody ? <div className={cn('text-secondary', sm ? 'paragraph-xs' : 'paragraph-sm')}>{children}</div> : null}
        </div>
      ) : null}
      {action ? <div className="ml-auto flex shrink-0 items-center gap-2 self-center">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center self-center rounded-sm text-secondary transition-colors hover:bg-tertiary hover:text-primary focus-visible:outline-2 focus-visible:outline-brand"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
