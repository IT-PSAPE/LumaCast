import { describe, expect, it } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allowsBuildRevision,
  appManifestPath,
  compareStableVersions,
  decideStableRelease,
  highestPublishedVersionFor,
  parseStableVersion,
  readManifestVersion,
  releaseTagFor,
} from '../../tool/release-version.mjs';

const CLI = fileURLToPath(new URL('../../tool/release-version.mjs', import.meta.url));

function writeManifest(version: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-version-'));
  const manifestPath = path.join(directory, 'package.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({ name: '@lumacast/cast', version }, null, 2)}\n`);
  return manifestPath;
}

function runCli(env: Record<string, string | undefined>): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_APP: 'cast', TAG_EXISTS: 'false', GITHUB_EVENT_NAME: 'push', ...env },
  });
}

function outputOf(result: SpawnSyncReturns<string>): Record<string, string> {
  expect(result.status, result.stderr).toBe(0);
  return Object.fromEntries(
    result.stdout
      .trim()
      .split('\n')
      .map((line: string) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

describe('decideStableRelease', () => {
  it('releases a higher stable version pushed to main', () => {
    expect(decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: true, reason: 'version-increased' });
  });

  it('releases against the root-manifest baseline left by the Cast migration', () => {
    expect(decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'root-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: true, reason: 'version-increased' });
  });

  it('stops after validation when the version is unchanged', () => {
    expect(decideStableRelease({
      app: 'cloud',
      eventName: 'push',
      currentVersion: '1.2.0',
      previousVersion: '1.2.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: false, reason: 'version-unchanged' });
  });

  it('does not replace a published release on a rerun', () => {
    expect(decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '1.2.0',
      previousVersion: '1.1.9',
      previousVersionSource: 'app-manifest',
      tagExists: true,
    })).toEqual({ shouldRelease: false, reason: 'tag-exists' });
  });

  it('never releases from a manual dispatch', () => {
    expect(decideStableRelease({
      app: 'cast',
      eventName: 'workflow_dispatch',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: false, reason: 'manual-ci-only' });
  });

  it('never releases from a pull request', () => {
    expect(decideStableRelease({
      app: 'cast',
      eventName: 'pull_request',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: false, reason: 'unsupported-event' });
  });

  it('never auto-releases when the previous app version is absent', () => {
    for (const app of ['cast', 'cloud', 'flux', 'chord']) {
      expect(decideStableRelease({
        app,
        eventName: 'push',
        currentVersion: '0.1.28',
        previousVersion: undefined,
        previousVersionSource: undefined,
        tagExists: false,
      })).toEqual({ shouldRelease: false, reason: 'no-baseline-version' });
    }
  });

  it('reports a missing baseline even when a version increase would otherwise qualify', () => {
    // Cloud and Flux have no migration baseline, so their first push to main
    // cannot publish: there is nothing to prove an increase against.
    expect(decideStableRelease({
      app: 'cloud',
      eventName: 'push',
      currentVersion: '0.1.0',
      previousVersion: undefined,
      tagExists: false,
    })).toEqual({ shouldRelease: false, reason: 'no-baseline-version' });
  });

  it('rejects a version downgrade', () => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.26',
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('must be greater than');
  });

  it('refuses a push older than the highest published version', () => {
    // A delayed or reverted push can be newer than its baseline yet older than
    // the maximum already published; releasing it would roll Cast latest and
    // the feed back to an old version.
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: false,
      highestPublishedVersion: '0.1.30',
    })).toThrow('highest published');
  });

  it('refuses a stale already-published rerun even when the tag exists', () => {
    // The tag-exists check must not mask the stale-version guard: an old
    // published push rerunning against a higher published version cannot
    // initialize the feed from the stale tag.
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: true,
      highestPublishedVersion: '0.1.30',
    })).toThrow('highest published');
  });

  it('refuses an unchanged baseline older than the highest published version', () => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.28',
      previousVersionSource: 'app-manifest',
      tagExists: false,
      highestPublishedVersion: '0.1.30',
    })).toThrow('highest published');
  });

  it('refuses a missing baseline older than the highest published version', () => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: undefined,
      previousVersionSource: undefined,
      tagExists: false,
      highestPublishedVersion: '0.1.30',
    })).toThrow('highest published');
  });

  it('treats the highest published version as already released', () => {
    // The installers are not rebuilt; the feed job heals from the published
    // release on rerun.
    expect(decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.30',
      previousVersion: '0.1.29',
      previousVersionSource: 'app-manifest',
      tagExists: false,
      highestPublishedVersion: '0.1.30',
    })).toEqual({ shouldRelease: false, reason: 'tag-exists' });
  });

  it('releases ahead of the highest published version', () => {
    expect(decideStableRelease({
      app: 'cloud',
      eventName: 'push',
      currentVersion: '1.3.0',
      previousVersion: '1.2.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
      highestPublishedVersion: '1.2.0',
    })).toEqual({ shouldRelease: true, reason: 'version-increased' });
  });

  it('rejects a baseline that is not a stable version', () => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27-rc.1',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('stable semantic version');
  });

  it('rejects a highest published version that is not stable', () => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: false,
      highestPublishedVersion: '0.1.28-rc.1',
    })).toThrow('stable semantic version');
  });

  it.each([
    ['prerelease', '0.1.28-beta.1'],
    ['tag prefix', 'v0.1.28'],
    ['missing patch', '0.1'],
    ['leading zero', '01.1.28'],
    ['four components', '0.1.28.1'],
    ['build metadata', '0.1.28+build.1'],
    ['empty', ''],
  ])('rejects an unstable version: %s', (_label, currentVersion) => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion,
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('stable semantic version');
  });

  it('rejects an app outside the released set', () => {
    expect(() => decideStableRelease({
      app: 'studio',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('Unknown release app');
  });

  it('releases a Flux build revision as a version increase', () => {
    expect(decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '0.11.0+1',
      previousVersion: '0.11.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: true, reason: 'version-increased' });
  });

  it('releases a higher Flux build revision of an already-revisioned baseline', () => {
    expect(decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '0.11.0+2',
      previousVersion: '0.11.0+1',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: true, reason: 'version-increased' });
  });

  it('rejects a Flux build revision downgrade', () => {
    expect(() => decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '0.11.0+1',
      previousVersion: '0.11.0+2',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('must be greater than');
  });

  it('refuses a Flux push older than the highest published revision', () => {
    expect(() => decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '0.11.0+1',
      previousVersion: '0.11.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
      highestPublishedVersion: '0.11.0+2',
    })).toThrow('highest published');
  });

  it('treats a published Flux revision as already released', () => {
    expect(decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '0.11.0+1',
      previousVersion: '0.11.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
      highestPublishedVersion: '0.11.0+1',
    })).toEqual({ shouldRelease: false, reason: 'tag-exists' });
  });

  it('lets a feature-version increase outrank any revision', () => {
    // A revision is only a fourth component: 0.11.1 still beats 0.11.0+99.
    expect(decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '0.11.1',
      previousVersion: '0.11.0+99',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: true, reason: 'version-increased' });
  });

  it('releases a Flux version whose components all sit at the build boundary', () => {
    expect(decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '65535.0.0+65535',
      previousVersion: '65535.0.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toEqual({ shouldRelease: true, reason: 'version-increased' });
  });

  it.each([
    ['major', '65536.0.0'],
    ['minor', '0.65536.0'],
    ['patch', '0.0.65536'],
    ['revision', '0.11.0+65536'],
  ])('refuses to release a Flux push whose %s exceeds the build boundary', (_label, currentVersion) => {
    // The Windows build reads these components as 16-bit fields, so the gate
    // refuses before packaging rather than after an upload.
    expect(() => decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion,
      previousVersion: '0.11.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('between 0 and 65535');
  });

  it('refuses a Flux baseline past the build boundary', () => {
    expect(() => decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion: '0.12.0',
      previousVersion: '0.11.65536',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('between 0 and 65535');
  });

  it.each(['cast', 'cloud'])('keeps %s on strict plain SemVer', (app) => {
    expect(() => decideStableRelease({
      app,
      eventName: 'push',
      currentVersion: '0.11.0+1',
      previousVersion: '0.11.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('stable semantic version');
  });

  it.each([
    ['a prerelease alongside a revision', '0.11.0-rc.1+1'],
    ['non-numeric build metadata', '0.11.0+build.1'],
    ['a leading zero revision', '0.11.0+01'],
    ['a signed revision', '0.11.0+-1'],
    ['two revisions', '0.11.0+1+2'],
    ['a revision beyond exact comparison', `0.11.0+${Number.MAX_SAFE_INTEGER + 10}`],
    ['four numeric components', '0.11.0.1'],
  ])('rejects a Flux version carrying %s', (_label, currentVersion) => {
    expect(() => decideStableRelease({
      app: 'flux',
      eventName: 'push',
      currentVersion,
      previousVersion: '0.11.0',
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow(/stable semantic version|exactly comparable range/);
  });

  it('rejects a baseline without a declared source', () => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: undefined,
      tagExists: false,
    })).toThrow('requires a previous version source');
  });

  it('rejects a source without a baseline', () => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: undefined,
      previousVersionSource: 'app-manifest',
      tagExists: false,
    })).toThrow('requires a baseline version');
  });

  it('rejects an unknown baseline source', () => {
    expect(() => decideStableRelease({
      app: 'cast',
      eventName: 'push',
      currentVersion: '0.1.28',
      previousVersion: '0.1.27',
      previousVersionSource: 'tag',
      tagExists: false,
    })).toThrow('Unknown previous version source');
  });
});

describe('version helpers', () => {
  it('splits a stable version into numeric components', () => {
    expect(parseStableVersion('1.2.0')).toEqual([1, 2, 0]);
    expect(() => parseStableVersion('1.2')).toThrow('stable semantic version');
  });

  it('reads a Flux build revision as a fourth component', () => {
    expect(parseStableVersion('0.11.0+1', 'flux')).toEqual([0, 11, 0, 1]);
    expect(parseStableVersion('0.11.0+0', 'flux')).toEqual([0, 11, 0, 0]);
  });

  it('allows every Flux component at the 65535 Windows build boundary', () => {
    // 65535 is the largest value the four 16-bit Windows buildVersion fields
    // hold, so it is a Flux version, not merely a near miss.
    expect(parseStableVersion('65535.65535.65535', 'flux')).toEqual([65535, 65535, 65535]);
    expect(parseStableVersion('65535.65535.65535+65535', 'flux')).toEqual([65535, 65535, 65535, 65535]);
  });

  it.each([
    ['major', '65536.0.0'],
    ['minor', '0.65536.0'],
    ['patch', '0.0.65536'],
    ['revision', '0.0.0+65536'],
    ['a revision beyond the build boundary', '0.11.0+65536'],
  ])('rejects a Flux %s above the 65535 Windows build boundary', (_label, version) => {
    expect(() => parseStableVersion(version, 'flux')).toThrow('between 0 and 65535');
  });

  it.each(['cast', 'cloud', undefined])('leaves %s outside the Windows build boundary cap', (app) => {
    // The 16-bit cap is a Flux packaging constraint. Cast and Cloud must keep
    // their exact current strict reading rather than inherit a new rejection.
    expect(parseStableVersion('65536.70000.0', app)).toEqual([65536, 70000, 0]);
  });

  it('rejects a build revision without an app and for the strict apps', () => {
    for (const app of [undefined, 'cast', 'cloud']) {
      expect(() => parseStableVersion('0.11.0+1', app)).toThrow('stable semantic version');
    }
  });

  it('orders build revisions numerically as a fourth component', () => {
    expect(compareStableVersions('0.11.0+1', '0.11.0', 'flux')).toBeGreaterThan(0);
    expect(compareStableVersions('0.11.0', '0.11.0+1', 'flux')).toBeLessThan(0);
    expect(compareStableVersions('0.11.0+2', '0.11.0+10', 'flux')).toBeLessThan(0);
    expect(compareStableVersions('0.11.1', '0.11.0+99', 'flux')).toBeGreaterThan(0);
    expect(compareStableVersions('0.11.0+1', '0.11.0+1', 'flux')).toBe(0);
    expect(compareStableVersions([0, 11, 0, 1], '0.11.0', 'flux')).toBeGreaterThan(0);
  });

  it('names the apps that publish build revisions', () => {
    expect(allowsBuildRevision('flux')).toBe(true);
    expect(allowsBuildRevision('cast')).toBe(false);
    expect(allowsBuildRevision('cloud')).toBe(false);
  });

  it('orders stable versions numerically rather than lexically', () => {
    expect(compareStableVersions('0.1.9', '0.1.10')).toBeLessThan(0);
    expect(compareStableVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareStableVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('returns undefined when no tags are published', () => {
    expect(highestPublishedVersionFor('cast', [])).toBeUndefined();
  });

  it('finds a single numeric maximum across more than one page of releases', () => {
    // The workflow streams every tag across all gh pages and reduces to one
    // numeric max; a per-page max would emit one line per page past 100
    // releases and fail the stable gate. Lexical sorting would pick 0.1.99
    // over 0.1.100 here.
    const publishedTags = Array.from({ length: 150 }, (_, index) => `cast-v0.1.${index + 1}`);
    expect(highestPublishedVersionFor('cast', publishedTags)).toBe('0.1.150');
  });

  it('ignores other apps, prerelease, invalid, legacy, and feed tags', () => {
    expect(highestPublishedVersionFor('cast', [
      'cloud-v0.1.50',
      'flux-v1.0.0',
      'cast-v0.1.100-rc.1',
      'cast-v-not-a-version',
      'cast-v0.1.99',
      'cast-0.1.98',
      'cast-feed-v0.1.97',
      'cast-v0.1.101',
      'cast-v0.1.96-extra',
  ])).toBe('0.1.101');
  });

  it('compares Flux revision tags against plain and invalid ones', () => {
    expect(highestPublishedVersionFor('flux', [
      'flux-v0.11.0+2',
      'flux-v0.11.0+10',
      'flux-v0.11.0',
      'flux-v0.11.1',
      'flux-v0.11.2-rc.1',
      'flux-v0.11.0+build.1',
      'flux-v0.11.0+9007199254740993',
      'cast-v0.1.100',
    ])).toBe('0.11.1');
  });

  it('never accepts a revision tag for a strict app', () => {
    expect(highestPublishedVersionFor('cast', ['cast-v0.1.28+1', 'cast-v0.1.27'])).toBe('0.1.27');
  });

  it('skips Flux tags past the Windows build boundary instead of throwing', () => {
    // The published tag list is external input, so an unbuildable tag must be
    // skipped rather than fail the scan for every other tag in the set.
    expect(highestPublishedVersionFor('flux', [
      'flux-v65536.0.0',
      'flux-v0.65536.0',
      'flux-v0.0.65536',
      'flux-v0.11.0+65536',
      'flux-v0.11.0+2',
    ])).toBe('0.11.0+2');
  });

  it('reads a Flux tag at the build boundary as the highest published version', () => {
    expect(highestPublishedVersionFor('flux', [
      'flux-v0.11.0',
      'flux-v65535.65535.65535+65535',
    ])).toBe('65535.65535.65535+65535');
  });

  it('prefixes release tags per app', () => {
    expect(releaseTagFor('cast', '0.1.28')).toBe('cast-v0.1.28');
    expect(releaseTagFor('cloud', '1.0.0')).toBe('cloud-v1.0.0');
    expect(releaseTagFor('flux', '1.0.0')).toBe('flux-v1.0.0');
    expect(releaseTagFor('flux', '0.11.0+1')).toBe('flux-v0.11.0+1');
  });

  it('resolves the app manifest path inside apps', () => {
    expect(appManifestPath('cast', '/repo')).toBe(path.join('/repo', 'apps', 'cast', 'package.json'));
  });

  it('reads the version from an app manifest', () => {
    expect(readManifestVersion(writeManifest('0.1.28'))).toBe('0.1.28');
  });

  it('fails when the app manifest is missing', () => {
    expect(() => readManifestVersion(path.join(os.tmpdir(), 'release-version-missing', 'package.json')))
      .toThrow('unreadable');
  });

  it('fails when the app manifest declares no version', () => {
    const manifestPath = writeManifest(undefined as unknown as string);
    expect(() => readManifestVersion(manifestPath)).toThrow('declares no version');
  });

  it('fails when the app manifest is not JSON', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-version-'));
    const manifestPath = path.join(directory, 'package.json');
    fs.writeFileSync(manifestPath, 'not json');
    expect(() => readManifestVersion(manifestPath)).toThrow('not valid JSON');
  });
});

describe('release-version command interface', () => {
  it('publishes the app, version, and tag a version increase implies', () => {
    const output = outputOf(runCli({
      APP_MANIFEST: writeManifest('0.1.28'),
      PREVIOUS_VERSION: '0.1.27',
      PREVIOUS_VERSION_SOURCE: 'app-manifest',
    }));

    expect(output).toEqual({
      app: 'cast',
      version: '0.1.28',
      tag: 'cast-v0.1.28',
      should_release: 'true',
      reason: 'version-increased',
      previous_version: '0.1.27',
      previous_version_source: 'app-manifest',
    });
  });

  it('resolves the manifest from the app name when none is given', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-version-root-'));
    fs.mkdirSync(path.join(root, 'apps', 'flux'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'apps', 'flux', 'package.json'),
      `${JSON.stringify({ name: '@lumacast/flux', version: '1.2.0' }, null, 2)}\n`,
    );

    const result = spawnSync(process.execPath, [CLI], {
      encoding: 'utf8',
      cwd: root,
      env: {
        ...process.env,
        RELEASE_APP: 'flux',
        TAG_EXISTS: 'false',
        GITHUB_EVENT_NAME: 'push',
        PREVIOUS_VERSION: '1.1.0',
        PREVIOUS_VERSION_SOURCE: 'app-manifest',
      },
    });

    const output = outputOf(result);
    expect(output.app).toBe('flux');
    expect(output.version).toBe('1.2.0');
    expect(output.tag).toBe('flux-v1.2.0');
    expect(output.should_release).toBe('true');
  });

  it('reports a manual dispatch as CI-only', () => {
    const output = outputOf(runCli({
      APP_MANIFEST: writeManifest('0.1.28'),
      PREVIOUS_VERSION: '0.1.27',
      PREVIOUS_VERSION_SOURCE: 'app-manifest',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
    }));

    expect(output.should_release).toBe('false');
    expect(output.reason).toBe('manual-ci-only');
  });

  it('reports no baseline when the previous app version is absent', () => {
    const output = outputOf(runCli({
      APP_MANIFEST: writeManifest('0.1.0'),
      PREVIOUS_VERSION: '',
      PREVIOUS_VERSION_SOURCE: '',
      RELEASE_APP: 'cloud',
    }));

    expect(output.should_release).toBe('false');
    expect(output.reason).toBe('no-baseline-version');
    expect(output.previous_version).toBe('');
  });

  it('refuses a rerun older than the highest published version', () => {
    const result = runCli({
      APP_MANIFEST: writeManifest('0.1.28'),
      PREVIOUS_VERSION: '0.1.27',
      PREVIOUS_VERSION_SOURCE: 'app-manifest',
      HIGHEST_PUBLISHED_VERSION: '0.1.30',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('highest published');
  });

  it('treats the highest published version as already released', () => {
    const output = outputOf(runCli({
      APP_MANIFEST: writeManifest('0.1.30'),
      PREVIOUS_VERSION: '0.1.29',
      PREVIOUS_VERSION_SOURCE: 'app-manifest',
      HIGHEST_PUBLISHED_VERSION: '0.1.30',
    }));

    expect(output.should_release).toBe('false');
    expect(output.reason).toBe('tag-exists');
  });

  it('fails for an unknown app', () => {
    const result = runCli({ RELEASE_APP: 'studio', APP_MANIFEST: writeManifest('0.1.28') });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown release app');
  });

  it('fails for an unstable app version', () => {
    const result = runCli({
      APP_MANIFEST: writeManifest('0.1.28-rc.1'),
      PREVIOUS_VERSION: '0.1.27',
      PREVIOUS_VERSION_SOURCE: 'app-manifest',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stable semantic version');
  });

  it('publishes a Flux revision manifest under its revisioned tag', () => {
    const output = outputOf(runCli({
      RELEASE_APP: 'flux',
      APP_MANIFEST: writeManifest('0.11.0+1'),
      PREVIOUS_VERSION: '0.11.0',
      PREVIOUS_VERSION_SOURCE: 'app-manifest',
    }));

    expect(output).toEqual({
      app: 'flux',
      version: '0.11.0+1',
      tag: 'flux-v0.11.0+1',
      should_release: 'true',
      reason: 'version-increased',
      previous_version: '0.11.0',
      previous_version_source: 'app-manifest',
    });
  });

  it('fails a Cast manifest that carries a build revision', () => {
    const result = runCli({
      APP_MANIFEST: writeManifest('0.11.0+1'),
      PREVIOUS_VERSION: '0.11.0',
      PREVIOUS_VERSION_SOURCE: 'app-manifest',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stable semantic version');
  });

  it('fails a Flux manifest whose component exceeds the Windows build boundary', () => {
    const result = runCli({
      RELEASE_APP: 'flux',
      APP_MANIFEST: writeManifest('0.11.0+65536'),
      PREVIOUS_VERSION: '0.11.0',
      PREVIOUS_VERSION_SOURCE: 'app-manifest',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('between 0 and 65535');
  });

  it('fails for a missing app manifest', () => {
    const result = runCli({ APP_MANIFEST: path.join(os.tmpdir(), 'release-version-absent', 'package.json') });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unreadable');
  });
});
