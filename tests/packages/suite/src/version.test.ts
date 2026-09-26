// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareVersions, isValidVersion, parseVersion } from '../../../../packages/suite/src/version';

describe('parseVersion', () => {
  it('parses a plain semver under the default scheme', () => {
    expect(parseVersion('0.1.27')).toEqual([0, 1, 27]);
    expect(parseVersion('1.2.3', 'semver')).toEqual([1, 2, 3]);
    expect(parseVersion('10.20.30')).toEqual([10, 20, 30]);
  });

  it('parses a revision version under semver-revision', () => {
    expect(parseVersion('0.11.0+1', 'semver-revision')).toEqual([0, 11, 0, 1]);
    expect(parseVersion('0.11.0+42', 'semver-revision')).toEqual([0, 11, 0, 42]);
  });

  it('parses a plain semver under semver-revision too', () => {
    expect(parseVersion('0.11.0', 'semver-revision')).toEqual([0, 11, 0]);
  });

  it('rejects a revision suffix under the plain semver scheme', () => {
    expect(() => parseVersion('0.11.0+1', 'semver')).toThrow(/stable semantic version/);
  });

  it('rejects a leading zero in any component', () => {
    expect(() => parseVersion('01.2.3')).toThrow();
    expect(() => parseVersion('1.02.3')).toThrow();
    expect(() => parseVersion('1.2.03')).toThrow();
  });

  it('rejects a prerelease tag under every scheme', () => {
    expect(() => parseVersion('1.0.0-beta.1')).toThrow();
    expect(() => parseVersion('1.0.0-beta.1', 'semver-revision')).toThrow();
  });

  it('rejects non-numeric build metadata under semver', () => {
    expect(() => parseVersion('1.0.0+1')).toThrow();
    expect(() => parseVersion('1.0.0+abc', 'semver-revision')).toThrow();
  });

  it('rejects malformed or incomplete versions', () => {
    expect(() => parseVersion('')).toThrow();
    expect(() => parseVersion('1.2')).toThrow();
    expect(() => parseVersion('1.2.3.4')).toThrow();
    expect(() => parseVersion('v1.2.3')).toThrow();
    expect(() => parseVersion('1.2.x')).toThrow();
  });

  it('rejects a revision beyond the safe integer range', () => {
    expect(() => parseVersion('1.0.0+9007199254740993', 'semver-revision')).toThrow(
      /exactly comparable range/,
    );
  });
});

describe('isValidVersion', () => {
  it('mirrors parseVersion success/failure', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidVersion('1.2.3-beta')).toBe(false);
    expect(isValidVersion('0.11.0+1')).toBe(false);
    expect(isValidVersion('0.11.0+1', 'semver-revision')).toBe(true);
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats a missing revision as 0 under semver-revision', () => {
    expect(compareVersions('0.11.0', '0.11.0+1', 'semver-revision')).toBeLessThan(0);
    expect(compareVersions('0.11.0+1', '0.11.0', 'semver-revision')).toBeGreaterThan(0);
    expect(compareVersions('0.11.0+0', '0.11.0', 'semver-revision')).toBe(0);
  });

  it('orders revisions numerically, not lexically', () => {
    expect(compareVersions('0.11.0+2', '0.11.0+10', 'semver-revision')).toBeLessThan(0);
  });

  it('throws when either side is invalid for the scheme', () => {
    expect(() => compareVersions('1.2.3', '1.2.3-beta')).toThrow();
    expect(() => compareVersions('0.11.0+1', '0.11.0')).toThrow();
  });
});
