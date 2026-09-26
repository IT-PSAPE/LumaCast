// The inspector's row/section chrome: every Theme/Cue-tab section (Text,
// Position, Effects, Transition, Background…) is built from these same four
// pieces, so this stays a shared primitive rather than being duplicated per
// section.
import type { ReactNode } from 'react';
import { cn } from '@lumacast/ui';

function Root({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2 border-b border-primary px-3 py-3', className)}>{children}</div>;
}

function Header({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-2', className)}>{children}</div>;
}

function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-1.5', className)}>{children}</div>;
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-1.5', className)}>{children}</div>;
}

export const Section = { Root, Header, Body, Row };
