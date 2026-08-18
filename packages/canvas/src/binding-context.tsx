import { createContext, useContext, type ReactNode } from 'react';
import type { BindingValue } from '@lumacast/composition';

export type { BindingValue, BindingOverride } from '@lumacast/composition';

const EMPTY_VALUE: BindingValue = {
  currentSlideText: null,
  nextSlideText: null,
  slideNotes: null,
  talkScriptCurrent: null,
  talkScriptProgress: null,
  armedAtMs: null,
};

const BindingContext = createContext<BindingValue>(EMPTY_VALUE);

export function BindingProvider({ value, children }: { value: BindingValue; children: ReactNode }) {
  return <BindingContext.Provider value={value}>{children}</BindingContext.Provider>;
}

export function useBinding(): BindingValue {
  return useContext(BindingContext);
}
