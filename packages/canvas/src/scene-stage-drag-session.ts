import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import type { SnapBox } from './snap-guides';
import { mapSnapBoxes } from './scene-stage-editor-utils';

export interface DragSession {
  selectedIds: Id[];
  selectedSet: Set<Id>;
  elementById: Map<Id, SlideElement>;
  snapBoxes: SnapBox[];
}

export function createDragSession(effectiveElements: SlideElement[], selectedIds: Id[]): DragSession {
  const selectedSet = new Set(selectedIds);
  const elementById = new Map<Id, SlideElement>(effectiveElements.map((element) => [element.id, element]));
  const snapBoxes = mapSnapBoxes(effectiveElements, selectedSet);
  return {
    selectedIds,
    selectedSet,
    elementById,
    snapBoxes,
  };
}
