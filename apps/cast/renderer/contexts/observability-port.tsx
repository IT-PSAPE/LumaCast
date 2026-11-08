import { createContext, useContext, type ReactNode } from 'react';

export type ObsEventCategory =
  | 'ndi'
  | 'layer'
  | 'overlay'
  | 'playback'
  | 'slide'
  | 'system'
  | 'audio'
  | 'video'
  | 'error';

export type ObsEventLevel = 'info' | 'warn' | 'error';

export interface ObservabilityPort {
  record: (
    category: ObsEventCategory,
    message: string,
    details?: Record<string, unknown>,
    level?: ObsEventLevel,
  ) => void;
}

const ObservabilityPortContext = createContext<ObservabilityPort | null>(null);

export function ObservabilityPortProvider({
  port,
  children,
}: {
  port: ObservabilityPort;
  children: ReactNode;
}) {
  return <ObservabilityPortContext.Provider value={port}>{children}</ObservabilityPortContext.Provider>;
}

export function useObservabilityPort(): ObservabilityPort {
  const port = useContext(ObservabilityPortContext);
  if (!port) throw new Error('ObservabilityPortProvider is missing from the Cast renderer tree.');
  return port;
}
