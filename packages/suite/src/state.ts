// Derives the state Cloud renders for one app card from what is installed on
// disk and what the release catalog says is available. Pure and headless:
// discovering `installed` and loading `releases` both happen elsewhere.
import type { AppRelease, AppState, AppStatus, InstalledApp, SuiteAppDescriptor } from './types';
import { compareVersions, isValidVersion } from './version';

export function deriveAppState(input: {
  app: SuiteAppDescriptor;
  installed: InstalledApp | null;
  releases: AppRelease[] | null;
}): AppState {
  const { app, installed, releases } = input;

  if (releases === null) {
    return {
      app: app.id,
      status: installed ? 'unknown' : 'not-installed',
      installed,
      latest: null,
      releases: [],
    };
  }

  const latest = releases[0] ?? null;

  if (!installed) {
    return { app: app.id, status: 'not-installed', installed: null, latest, releases };
  }

  if (releases.length === 0) {
    return { app: app.id, status: 'unknown', installed, latest, releases };
  }

  if (!isValidVersion(installed.version, app.versionScheme)) {
    return { app: app.id, status: 'unknown', installed, latest, releases };
  }

  const comparison = compareVersions(installed.version, latest!.version, app.versionScheme);
  const status: AppStatus = comparison < 0 ? 'update-available' : comparison === 0 ? 'up-to-date' : 'ahead';
  return { app: app.id, status, installed, latest, releases };
}
