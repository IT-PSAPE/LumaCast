import { createContext, useContext } from 'react';

export function createScreenContext<T>(name: string) {
  const ScreenContext = createContext<T | null>(null);

  function useScreenContext(): T {
    const context = useContext(ScreenContext);
    if (!context) throw new Error(`${name} must be used within ${name}Provider`);
    return context;
  }

  return [ScreenContext.Provider, useScreenContext] as const;
}
