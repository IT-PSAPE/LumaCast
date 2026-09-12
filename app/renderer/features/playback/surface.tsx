import type { ReactNode } from 'react';
import type { ProgramSurfaceKind } from '../../types/ui';
import { ProgramSurface } from './program-surface';
import { MonitorSurface } from './monitor-surface';
import { StageSurface } from './stage-surface';

export function Surface({ kind, label }: { kind: ProgramSurfaceKind; label?: ReactNode }) {
  if (kind === 'program') return <ProgramSurface label={label} />;
  if (kind === 'monitor') return <MonitorSurface label={label} />;
  return <StageSurface label={label} />;
}
