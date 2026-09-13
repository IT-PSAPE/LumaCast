import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { decideStableRelease } from '../../tool/release-version.mjs';

describe('decideStableRelease', () => {
  it('releases a higher stable version pushed to main', () => {
    expect(decideStableRelease({
      eventName: 'push',
      currentVersion: '0.1.21',
      previousVersion: '0.1.20',
      tagExists: false,
    })).toEqual({ shouldRelease: true, reason: 'version-increased' });
  });

  it('stops after validation when the version is unchanged', () => {
    expect(decideStableRelease({
      eventName: 'push',
      currentVersion: '0.1.21',
      previousVersion: '0.1.21',
      tagExists: false,
    })).toEqual({ shouldRelease: false, reason: 'version-unchanged' });
  });

  it('does not replace an existing release', () => {
    expect(decideStableRelease({
      eventName: 'push',
      currentVersion: '0.1.21',
      previousVersion: '0.1.20',
      tagExists: true,
    })).toEqual({ shouldRelease: false, reason: 'tag-exists' });
  });

  it('allows a manual retry for an unpublished stable version', () => {
    expect(decideStableRelease({
      eventName: 'workflow_dispatch',
      currentVersion: '0.1.21',
      previousVersion: undefined,
      tagExists: false,
    })).toEqual({ shouldRelease: true, reason: 'manual-unpublished-version' });
  });

  it('rejects a version downgrade', () => {
    expect(() => decideStableRelease({
      eventName: 'push',
      currentVersion: '0.1.20',
      previousVersion: '0.1.21',
      tagExists: false,
    })).toThrow('must be greater than');
  });

  it('rejects prerelease versions', () => {
    expect(() => decideStableRelease({
      eventName: 'push',
      currentVersion: '0.1.22-beta.1',
      previousVersion: '0.1.21',
      tagExists: false,
    })).toThrow('stable semantic version');
  });

  it('writes GitHub Actions outputs when run as a command', () => {
    const output = execFileSync(process.execPath, [path.resolve('tool/release-version.mjs')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CURRENT_VERSION: '1.2.0',
        PREVIOUS_VERSION: '1.1.9',
        TAG_EXISTS: 'false',
        GITHUB_EVENT_NAME: 'push',
      },
    });

    expect(output).toBe([
      'version=1.2.0',
      'should_release=true',
      'reason=version-increased',
      '',
    ].join('\n'));
  });
});
