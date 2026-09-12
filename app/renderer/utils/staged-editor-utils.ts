import type { SlideElement } from '@lumacast/composition';

export { cloneElement, cloneElements } from '@lumacast/composition';

export function collectionSignature<T>(items: T[], sigFn: (item: T) => string): string {
  return JSON.stringify(items.map(sigFn));
}

/**
 * Lifts `id` out of `items` and reinserts it at `toIndex` — the same
 * remove-then-insert semantics the `set…Order` IPC ops use, so a staged
 * collection and the database agree on what a drop index means. Returns the
 * same array reference when nothing would move.
 */
export function moveStagedItem<T extends { id: string }>(items: T[], id: string, toIndex: number): T[] {
  const fromIndex = items.findIndex((item) => item.id === id);
  if (fromIndex === -1) return items;
  const target = Math.max(0, Math.min(toIndex, items.length - 1));
  if (fromIndex === target) return items;
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(target, 0, moved);
  return next;
}

export function slideElementsSignature(elements: SlideElement[]): string {
  return JSON.stringify(elements);
}
