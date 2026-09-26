import type { ReactNode } from 'react';

export function SectionShell({ title, subtitle, headerExtra, children }: {
  title: string;
  subtitle?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-primary pb-6 last:border-b-0">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
          {subtitle ? <p className="text-xs text-tertiary">{subtitle}</p> : null}
        </div>
        {headerExtra}
      </header>
      {children}
    </section>
  );
}
