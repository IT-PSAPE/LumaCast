import { cv } from './cv';

export interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** `current` inherits the surrounding text colour (works inside any button variant). */
  tone?: 'current' | 'brand' | 'neutral';
  /** Accessible name. When absent the spinner is aria-hidden. */
  label?: string;
  className?: string;
}

const spinner = cv({
  base: 'inline-block shrink-0 rounded-full border-solid border-current border-r-transparent motion-safe:animate-spin',
  variants: {
    size: { xs: 'size-3 border', sm: 'size-4 border-2', md: 'size-5 border-2', lg: 'size-8 border-[3px]' },
    tone: { current: 'text-current', brand: 'text-brand', neutral: 'text-tertiary' },
  },
  defaultVariants: { size: 'md', tone: 'current' },
});

// Reduced motion: `motion-safe:animate-spin` leaves a static open ring (a C shape).
export function Spinner({ size = 'md', tone = 'current', label, className }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={spinner({ size, tone, className })}
    />
  );
}
