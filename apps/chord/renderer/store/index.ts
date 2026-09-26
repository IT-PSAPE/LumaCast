// Public entry point for the renderer store: the app-wide singleton every
// feature reads and mutates the document through, wired to the real
// (or mocked, via `../api`) desktop API. Tests that need a store with a
// specific fake API should call `createChordStore` directly instead of
// importing this singleton.
import { getApi } from '../api';
import { createChordStore } from './create-store';

export const useChordStore = createChordStore(getApi());
export { createChordStore };
export type { ChordStoreImpl } from './create-store';

// Development only: lets an automated smoke test (Playwright over CDP) drive
// the real store without native dialogs. Stripped from production bundles by
// Vite's dead-code elimination of `import.meta.env.DEV`.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __lumachordStore?: typeof useChordStore }).__lumachordStore = useChordStore;
}
