import type { StreamSource } from '../shared/desktop-api';
import { transformGroupChildren } from '../shared/source-tree';

export function duplicateSource(source: StreamSource, id = crypto.randomUUID()): StreamSource {
  const copy = structuredClone(source);
  const regenerateIds = (item: StreamSource, nextId: string): StreamSource => ({
    ...item,
    id: nextId,
    ...(item.kind === 'group' ? { children: (item.children ?? []).map((child) => regenerateIds(child, crypto.randomUUID())) } : {}),
  });
  const duplicated = regenerateIds(copy, id);
  const transform = { ...duplicated.transform, x: duplicated.transform.x + 40, y: duplicated.transform.y + 40 };
  return {
    ...duplicated,
    name: `Copy of ${source.name}`.slice(0, 120),
    transform,
    ...(duplicated.kind === 'group' ? { children: transformGroupChildren(duplicated.children ?? [], duplicated.transform, transform) } : {}),
  };
}
