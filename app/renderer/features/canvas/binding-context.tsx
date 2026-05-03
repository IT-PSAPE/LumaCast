import { createContext, useContext, type ReactNode } from 'react';

export interface BindingValue {
  currentSlideText: string | null;
  nextSlideText: string | null;
  slideNotes: string | null;
  armedAtMs: number | null;
}

export type BindingOverride = Partial<BindingValue>;

const EMPTY_VALUE: BindingValue = {
  currentSlideText: null,
  nextSlideText: null,
  slideNotes: null,
  armedAtMs: null,
};

const BindingContext = createContext<BindingValue>(EMPTY_VALUE);

export function BindingProvider({ value, children }: { value: BindingValue; children: ReactNode }) {
  return <BindingContext.Provider value={value}>{children}</BindingContext.Provider>;
}

export function useBinding(): BindingValue {
  return useContext(BindingContext);
}
