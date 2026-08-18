// One-shot rename of `recast.*` localStorage keys to `lumacast.*` so user
// preferences (workbench mode, drawer view modes, grid sizes, etc.) survive
// the brand rename. Runs once at startup; on subsequent launches there are no
// `recast.*` keys left so it is a no-op.
const LEGACY_PREFIX = 'recast.';
const NEW_PREFIX = 'lumacast.';

export function migrateLegacyRecastStorage(): void {
  if (typeof localStorage === 'undefined') return;
  const legacyKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
  }
  if (legacyKeys.length === 0) return;
  for (const key of legacyKeys) {
    const newKey = NEW_PREFIX + key.slice(LEGACY_PREFIX.length);
    if (localStorage.getItem(newKey) === null) {
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(newKey, value);
    }
    localStorage.removeItem(key);
  }
}

// One-shot removal of localStorage keys orphaned by #219's destruction of
// collections/libraries/playlist-groups: `lumacast.bin.activeCollection.*`
// (one per former bin kind — deck/image/video/audio/theme/overlay/stage/
// macro), and the library panel's expand-state/view-toggle keys. Unlike
// migrateLegacyRecastStorage above this doesn't rename anything forward —
// there is no replacement value for a dead concept — it just deletes.
// Runs once at startup; a no-op once the keys are gone.
const ORPHANED_STORAGE_PREFIX = 'lumacast.bin.activeCollection.';
const ORPHANED_STORAGE_KEYS = [
  'lumacast.library-panel-expanded-groups.v1',
  'lumacast.library-panel-view.v1',
];

export function removeOrphanedLegacyStorage(): void {
  if (typeof localStorage === 'undefined') return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(ORPHANED_STORAGE_PREFIX) || ORPHANED_STORAGE_KEYS.includes(key))) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) localStorage.removeItem(key);
}
