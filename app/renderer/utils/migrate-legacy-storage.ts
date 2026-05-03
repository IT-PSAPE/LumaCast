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
