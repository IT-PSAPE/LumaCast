import { createContext, useContext, type ReactNode } from 'react';

interface FilterChipsContextValue {
  value: string;
  onChange: (next: string) => void;
}

const FilterChipsContext = createContext<FilterChipsContextValue | null>(null);

function FilterChipsRoot<T extends string>({ value, onChange, children }: {
  value: T;
  onChange: (next: T) => void;
  children: ReactNode;
}) {
  return (
    <FilterChipsContext.Provider value={{ value, onChange: (next) => onChange(next as T) }}>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </FilterChipsContext.Provider>
  );
}

function FilterChipsOption<T extends string>({ value, children }: { value: T; children: ReactNode }) {
  const context = useContext(FilterChipsContext);
  if (!context) throw new Error('FilterChips.Option must be used within FilterChips.Root');

  return (
    <button
      type="button"
      onClick={() => context.onChange(value)}
      className={`rounded px-2 py-0.5 text-xs ${context.value === value ? 'bg-tertiary text-primary' : 'text-secondary hover:bg-tertiary/40'}`}
    >
      {children}
    </button>
  );
}

export const FilterChips = {
  Root: FilterChipsRoot,
  Option: FilterChipsOption,
};
