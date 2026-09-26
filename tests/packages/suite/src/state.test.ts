// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveAppState } from '../../../../packages/suite/src/state';
import { suiteApp } from '../../../../packages/suite/src/registry';
import type { AppRelease, InstalledApp } from '../../../../packages/suite/src/types';

const cast = suiteApp('cast');
const flux = suiteApp('flux');

function installedFor(version: string, app = cast): InstalledApp {
  return { app: app.id, version, location: '/Applications/LumaCast.app', scope: 'user' };
}

function releaseFor(app: typeof cast, version: string): AppRelease {
  return {
    app: app.id,
    version,
    tag: `${app.releaseTagPrefix}${version}`,
    legacy: false,
    publishedAt: null,
    notesUrl: 'https://example.test/notes',
    assets: [],
  };
}

describe('deriveAppState — catalog not loaded (releases === null)', () => {
  it('is not-installed with no installed app', () => {
    const state = deriveAppState({ app: cast, installed: null, releases: null });
    expect(state).toEqual({ app: 'cast', status: 'not-installed', installed: null, latest: null, releases: [] });
  });

  it('is unknown when installed but the catalog has not loaded', () => {
    const installed = installedFor('0.1.26');
    const state = deriveAppState({ app: cast, installed, releases: null });
    expect(state).toEqual({ app: 'cast', status: 'unknown', installed, latest: null, releases: [] });
  });
});

describe('deriveAppState — catalog loaded but empty', () => {
  it('is not-installed with no installed app', () => {
    const state = deriveAppState({ app: cast, installed: null, releases: [] });
    expect(state.status).toBe('not-installed');
    expect(state.latest).toBeNull();
    expect(state.releases).toEqual([]);
  });

  it('is unknown when installed but no release is published', () => {
    const installed = installedFor('0.1.26');
    const state = deriveAppState({ app: cast, installed, releases: [] });
    expect(state.status).toBe('unknown');
    expect(state.latest).toBeNull();
  });
});

describe('deriveAppState — catalog loaded with releases', () => {
  const releases = [releaseFor(cast, '0.2.0'), releaseFor(cast, '0.1.27'), releaseFor(cast, '0.1.26')];

  it('is not-installed when nothing is installed, but still reports latest/releases', () => {
    const state = deriveAppState({ app: cast, installed: null, releases });
    expect(state.status).toBe('not-installed');
    expect(state.installed).toBeNull();
    expect(state.latest).toEqual(releases[0]);
    expect(state.releases).toEqual(releases);
  });

  it('is update-available when installed is older than latest', () => {
    const installed = installedFor('0.1.26');
    const state = deriveAppState({ app: cast, installed, releases });
    expect(state.status).toBe('update-available');
    expect(state.latest).toEqual(releases[0]);
  });

  it('is up-to-date when installed equals latest', () => {
    const installed = installedFor('0.2.0');
    const state = deriveAppState({ app: cast, installed, releases });
    expect(state.status).toBe('up-to-date');
  });

  it('is ahead when installed is newer than anything published', () => {
    const installed = installedFor('9.9.9');
    const state = deriveAppState({ app: cast, installed, releases });
    expect(state.status).toBe('ahead');
  });

  it('is unknown when the installed version fails to parse under the scheme', () => {
    const installed = installedFor('not-a-version');
    const state = deriveAppState({ app: cast, installed, releases });
    expect(state.status).toBe('unknown');
    expect(state.latest).toEqual(releases[0]);
  });
});

describe('deriveAppState — Flux build-revision scheme', () => {
  const releases = [releaseFor(flux, '0.11.0+1'), releaseFor(flux, '0.11.0')];

  it('treats a missing revision as older than a revisioned release', () => {
    const installed = installedFor('0.11.0', flux);
    const state = deriveAppState({ app: flux, installed, releases });
    expect(state.status).toBe('update-available');
  });

  it('treats a revisioned install as newer than the base version', () => {
    const installed = installedFor('0.11.0+1', flux);
    const state = deriveAppState({ app: flux, installed, releases: [releaseFor(flux, '0.11.0')] });
    expect(state.status).toBe('ahead');
  });

  it('matches exactly on the same revision', () => {
    const installed = installedFor('0.11.0+1', flux);
    const state = deriveAppState({ app: flux, installed, releases });
    expect(state.status).toBe('up-to-date');
  });
});
