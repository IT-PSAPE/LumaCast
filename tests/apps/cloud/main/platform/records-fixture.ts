// An in-memory InstallRecords for adapter tests. Not a test file.
import type { InstallRecords } from '../../../../../apps/cloud/main/platform/adapter';
import type { InstalledApp } from '@lumacast/suite';

export function createFakeRecords(initial: InstalledApp[] = []): InstallRecords & { all: () => InstalledApp[] } {
  const map = new Map<string, InstalledApp>();
  for (const record of initial) map.set(`${record.app}:${record.scope}`, record);
  return {
    get: (app, scope) => map.get(`${app}:${scope}`),
    set: async (installed) => void map.set(`${installed.app}:${installed.scope}`, installed),
    remove: async (app, scope) => void map.delete(`${app}:${scope}`),
    all: () => [...map.values()],
  };
}
