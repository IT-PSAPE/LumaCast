import { cn } from './cn';
import { cv } from './cv';

// Standalone divider. Menu dividers stay owned by ContextMenu.Separator; this
// one matches its weight (1px rule on the tertiary-adjacent border tokens).

export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  tone?: 'primary' | 'secondary';
  /** Inset from the container edges. */
  inset?: boolean;
  /** Centred label; the rule breaks around it and the element becomes decorative. */
  label?: string;
  className?: string;
}

const ruleStyles = cv({
  base: 'shrink-0',
  variants: {
    orientation: {
      // `self-stretch` + `w-px` lets a vertical rule take the cross-axis height
      // of a flex row instead of collapsing to zero; `min-h-4` is the floor.
      horizontal: 'h-px w-full border-t',
      vertical: 'min-h-4 w-px self-stretch border-l',
    },
    tone: {
      primary: 'border-primary',
      secondary: 'border-secondary',
    },
    inset: { true: '', false: '' },
  },
  compoundVariants: [
    { orientation: 'horizontal', inset: true, class: 'mx-3' },
    { orientation: 'vertical', inset: true, class: 'my-1' },
  ],
  defaultVariants: { orientation: 'horizontal', tone: 'secondary', inset: false },
});

export function Separator({
  orientation = 'horizontal',
  tone = 'secondary',
  inset = false,
  label,
  className,
}: SeparatorProps) {
  if (label && orientation === 'horizontal') {
    return (
      <div
        role="presentation"
        className={cn('flex w-full shrink-0 items-center gap-2', inset && 'px-3', className)}
      >
        <span className={cn(ruleStyles({ orientation, tone }), 'w-auto flex-1')} />
        <span className="label-xs text-tertiary">{label}</span>
        <span className={cn(ruleStyles({ orientation, tone }), 'w-auto flex-1')} />
      </div>
    );
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={ruleStyles({ orientation, tone, inset, className })}
    />
  );
}
