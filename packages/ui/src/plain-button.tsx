import type { ComponentProps } from 'react';
import { Button } from '@base-ui/react/button';
import { cn } from './cn';

// PlainButton is the Flux-app `Btn`: a Base UI Button that always carries the
// `btn` class, which owns the app's button styling. It is the minimal, generic
// sibling of ReacstButton (which is variant-driven) and stays in the package
// because `btn` plus Base UI behaviour is domain-agnostic.
export function PlainButton({ children, className = '', ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      // Base UI accepts a state callback here, but `cn` only merges strings, so a
      // callback is forwarded wrapped: the caller's state is preserved and `btn`
      // is still merged ahead of the caller's classes.
      className={
        typeof className === 'function'
          ? (state) => cn('btn', className(state))
          : cn('btn', className)
      }
      {...props}
    >
      {children}
    </Button>
  );
}
