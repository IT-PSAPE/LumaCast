import type { ProgramSurfaceKind } from '../../types/ui';

export const SURFACE_LABELS: Record<ProgramSurfaceKind, string> = {
  program: 'Program',
  monitor: 'Monitor',
  stage: 'Stage',
};

export const SURFACE_ORDER: ProgramSurfaceKind[] = ['program', 'monitor', 'stage'];
