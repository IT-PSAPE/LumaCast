import type { ReactNode } from 'react';

function Root({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-secondary">
      {children}
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return (
    <div className="h-10 px-2 flex items-center text-lg font-medium">
      {children}
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-3 flex flex-col gap-2">
      {children}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-1">
      {children}
    </div>
  );
}

export const Section = { Root, Header, Body, Row };
