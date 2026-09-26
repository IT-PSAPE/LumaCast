import type { ElementInspectorDraft } from '../../types/ui';

export type ElementAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function alignElementDraft(
  draft: ElementInspectorDraft,
  sceneWidth: number,
  sceneHeight: number,
  alignment: ElementAlignment,
): ElementInspectorDraft {
  if (alignment === 'left') {
    return { ...draft, x: 0 };
  }

  if (alignment === 'center') {
    return { ...draft, x: Math.max(0, (sceneWidth - draft.width) / 2) };
  }

  if (alignment === 'right') {
    return { ...draft, x: Math.max(0, sceneWidth - draft.width) };
  }

  if (alignment === 'top') {
    return { ...draft, y: 0 };
  }

  if (alignment === 'middle') {
    return { ...draft, y: Math.max(0, (sceneHeight - draft.height) / 2) };
  }

  return { ...draft, y: Math.max(0, sceneHeight - draft.height) };
}
