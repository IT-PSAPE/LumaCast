export type ProjectorKind = 'preview' | 'program';

export const PROJECTOR_WINDOW_NAMES: Record<ProjectorKind, string> = {
  preview: 'lumastream-preview-projector',
  program: 'lumastream-program-projector',
};

export function projectorTitleForFrameName(frameName: string): string {
  if (frameName === PROJECTOR_WINDOW_NAMES.preview) return 'LumaStream Preview';
  if (frameName === PROJECTOR_WINDOW_NAMES.program) return 'LumaStream Program';
  return 'LumaStream Projector';
}
