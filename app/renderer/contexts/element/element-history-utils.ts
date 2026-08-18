import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import type { ElementCreateInput, ElementUpdateInput } from '@lumacast/protocol';
import { sameElementState } from '../../utils/element-context-utils';

interface SnapshotDiff {
  creates: ElementCreateInput[];
  updates: ElementUpdateInput[];
  deletes: Id[];
}

export function buildSnapshotDiff(current: SlideElement[], target: SlideElement[]): SnapshotDiff {
  const currentById = new Map<Id, SlideElement>();
  const targetById = new Map<Id, SlideElement>();

  for (const element of current) currentById.set(element.id, element);
  for (const element of target) targetById.set(element.id, element);

  const creates: ElementCreateInput[] = [];
  const updates: ElementUpdateInput[] = [];
  const deletes: Id[] = [];

  for (const [id, targetElement] of targetById) {
    const existing = currentById.get(id);
    if (!existing) {
      creates.push({
        id: targetElement.id,
        slideId: targetElement.slideId,
        type: targetElement.type,
        x: targetElement.x,
        y: targetElement.y,
        width: targetElement.width,
        height: targetElement.height,
        rotation: targetElement.rotation,
        opacity: targetElement.opacity,
        zIndex: targetElement.zIndex,
        layer: targetElement.layer,
        payload: targetElement.payload,
      });
      continue;
    }

    if (!sameElementState(existing, targetElement)) {
      updates.push({
        id: targetElement.id,
        x: targetElement.x,
        y: targetElement.y,
        width: targetElement.width,
        height: targetElement.height,
        rotation: targetElement.rotation,
        opacity: targetElement.opacity,
        zIndex: targetElement.zIndex,
        layer: targetElement.layer,
        payload: targetElement.payload,
      });
    }
  }

  for (const id of currentById.keys()) {
    if (!targetById.has(id)) deletes.push(id);
  }

  return { creates, updates, deletes };
}
