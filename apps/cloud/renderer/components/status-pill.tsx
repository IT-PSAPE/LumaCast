import type { AppStatus } from '@lumacast/suite';
import { cn, cv } from '@lumacast/ui';

const pillStyles = cv({
  base: 'inline-flex w-fit items-center rounded-full px-2 py-0.5 label-xs',
  variants: {
    status: {
      'not-installed': 'bg-tertiary text-tertiary',
      'up-to-date': 'bg-success/15 text-success',
      'update-available': 'bg-brand/15 text-brand',
      ahead: 'bg-tertiary text-secondary',
      unknown: 'bg-tertiary text-tertiary',
    },
  },
  defaultVariants: { status: 'unknown' },
});

interface StatusPillProps {
  status: AppStatus;
  label: string;
  className?: string;
}

export function StatusPill({ status, label, className }: StatusPillProps) {
  return <span className={cn(pillStyles({ status }), className)}>{label}</span>;
}
