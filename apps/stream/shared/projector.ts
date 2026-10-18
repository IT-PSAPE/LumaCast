export type ProjectorKind = 'preview' | 'program' | 'multiview';

export const PROJECTOR_WINDOW_NAMES: Record<ProjectorKind, string> = {
  preview: 'lumastream-preview-projector',
  program: 'lumastream-program-projector',
  multiview: 'lumastream-multiview',
};

export function projectorTitleForFrameName(frameName: string): string {
  if (frameName === PROJECTOR_WINDOW_NAMES.preview) return 'LumaStream Preview';
  if (frameName === PROJECTOR_WINDOW_NAMES.program) return 'LumaStream Program';
  if (frameName === PROJECTOR_WINDOW_NAMES.multiview) return 'Multiview';
  return 'LumaStream Projector';
}
