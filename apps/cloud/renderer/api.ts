// The renderer's single source for its privileged surface: the real bridge
// when it exists (a packaged/dev Electron window), otherwise the in-memory
// mock — so `vite`'s browser preview and tests run the same UI code as the
// packaged app.
import type { CloudDesktopAPI } from '../shared/desktop-api';
import { createMockApi } from './mock-api';

let mock: CloudDesktopAPI | null = null;

export function getApi(): CloudDesktopAPI {
  if (typeof window !== 'undefined' && window.lumacloud) return window.lumacloud;
  if (!mock) mock = createMockApi();
  return mock;
}
