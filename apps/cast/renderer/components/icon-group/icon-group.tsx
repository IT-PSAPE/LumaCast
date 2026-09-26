import type { HTMLAttributes, ReactNode } from 'react';
import { cn, cv } from '@lumacast/ui';

const iconGroupRootStyles = cv({
  base: 'flex items-stretch gap-px rounded-md rounded-l-md overflow-clip',
  variants: {
    fill: {
      true: ['w-full'],
      false: ['w-fit'],
    },
  },
  defaultVariants: {
    fill: false,
  },
});

interface IconGroupRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  fill?: boolean;
  rounded?: boolean;
}

export function IconGroupRoot({ children, className, fill = false, ...divProps }: IconGroupRootProps) {
  return (
    <div
      {...divProps}
      className={cn(iconGroupRootStyles({ fill }), className)}
    >
      {children}
    </div>
  );
}
