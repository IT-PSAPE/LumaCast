import type { ReactNode } from 'react';
import { ShowScreenContextBridge } from './screen-context-bridge';
import { useShowScreen } from './screen-context-core';

export function ShowScreenProvider({ children }: { children: ReactNode }) {
  return <ShowScreenContextBridge>{children}</ShowScreenContextBridge>;
}

export { useShowScreen };
