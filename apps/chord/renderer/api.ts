// Resolves the renderer's one privileged surface: `window.lumachord` when
// running inside Electron, or an in-memory mock everywhere else (the browser
// preview, and any test that does not stub `../store` outright).
import { createMockApi } from './mock-api';
import type { ChordDesktopAPI } from '../shared/desktop-api';

let mockApi: ChordDesktopAPI | null = null;

export function getApi(): ChordDesktopAPI {
  if (typeof window !== 'undefined' && window.lumachord) return window.lumachord;
  if (!mockApi) mockApi = createMockApi();
  return mockApi;
}
