export function removeSourceVisibilityHotkeys(
  bindings: Record<string, string>,
  removedSourceIds: readonly string[],
): Record<string, string> {
  const removed = new Set(removedSourceIds);
  return Object.fromEntries(Object.entries(bindings).filter(([sourceId]) => !removed.has(sourceId)));
}
