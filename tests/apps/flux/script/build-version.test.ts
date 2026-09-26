import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = path.resolve(__dirname, '../../../../apps/flux');
const require = createRequire(import.meta.url);

const hookPath = path.join(APP_DIR, 'script', 'build-version.cjs');
const hook = require(hookPath) as {
  (context: unknown): Promise<void>;
  deriveBuildVersion(version: unknown): {
    featureVersion: string;
    releaseVersion: string;
    buildVersion: string;
    revision: number;
  };
  beforePack?: unknown;
};

const manifest = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')) as {
  version: string;
};
const builderConfig = readFileSync(path.join(APP_DIR, 'electron-builder.yml'), 'utf8');

describe('apps/flux build version hook', () => {
  it('is the module electron-builder loads as the beforePack function', () => {
    // resolveFunction imports the module and uses `beforePack` when it exists,
    // otherwise the default export. Both must be the hook itself.
    expect(typeof hook).toBe('function');
    expect(hook.beforePack).toBe(hook);
  });

  it('derives a four-component build number from the manifest version', () => {
    expect(hook.deriveBuildVersion('0.11.0+1').buildVersion).toBe('0.11.0.1');
    expect(hook.deriveBuildVersion('0.11.0').buildVersion).toBe('0.11.0.0');
  });

  it('keeps the build revision in the release version, and adds none for a plain version', () => {
    // electron-builder runs semver.clean over the manifest version, so
    // AppInfo.version — and every artifact name and update-feed entry derived
    // from it — loses `+1` unless the hook puts it back. A plain manifest
    // version must stay plain, never gain a synthetic `+0`.
    expect(hook.deriveBuildVersion('0.11.0+1').releaseVersion).toBe('0.11.0+1');
    expect(hook.deriveBuildVersion('0.12.0+3').releaseVersion).toBe('0.12.0+3');
    expect(hook.deriveBuildVersion('0.11.0+12').releaseVersion).toBe('0.11.0+12');
    expect(hook.deriveBuildVersion('65535.65535.65535+65535').releaseVersion).toBe(
      '65535.65535.65535+65535',
    );
    expect(hook.deriveBuildVersion('0.11.0+1 ').releaseVersion).toBe('0.11.0+1');
    expect(hook.deriveBuildVersion('0.11.0').releaseVersion).toBe('0.11.0');
    expect(hook.deriveBuildVersion('0.11.0').releaseVersion).not.toContain('+');
    // An explicit `+0` is still a revision and is preserved verbatim.
    expect(hook.deriveBuildVersion('0.11.0+0').releaseVersion).toBe('0.11.0+0');
  });

  it('follows the manifest forward instead of repeating a pinned number', () => {
    // The defect was a hardcoded `buildVersion: 0.11.0.1` in the builder config,
    // which would still be 0.11.0.1 after the manifest moved to 0.12.0+3.
    expect(hook.deriveBuildVersion('0.12.0+3').buildVersion).toBe('0.12.0.3');
    expect(hook.deriveBuildVersion('1.2.3+1').buildVersion).toBe('1.2.3.1');
    expect(hook.deriveBuildVersion('0.11.0+12').buildVersion).toBe('0.11.0.12');
    expect(hook.deriveBuildVersion('0.11.0+1').featureVersion).toBe('0.11.0');
  });

  it('emits plain integer components Windows can store in 16-bit fields', () => {
    for (const version of ['0.11.0+1', '0.11.0', '12.34.56+78']) {
      const { buildVersion } = hook.deriveBuildVersion(version);
      const components = buildVersion.split('.');

      expect(components).toHaveLength(4);
      for (const component of components) {
        expect(component).toMatch(/^(0|[1-9]\d*)$/);
        expect(Number(component)).toBeLessThanOrEqual(65535);
      }
    }
  });

  it('refuses a version no build number can express', () => {
    for (const version of [
      '0.11.0-beta.1',
      '0.11.0+build',
      '0.11',
      '0.11.0.1',
      '',
      'v0.11.0+1',
      '0.11.0+1 ',
      undefined,
    ]) {
      // Leading and trailing whitespace is trimmed, so a padded version parses.
      if (version === '0.11.0+1 ') {
        expect(hook.deriveBuildVersion(version).buildVersion).toBe('0.11.0.1');
        continue;
      }
      expect(() => hook.deriveBuildVersion(version)).toThrow();
    }
  });

  it('refuses a component that cannot fit the Windows build number', () => {
    expect(() => hook.deriveBuildVersion('65536.0.0+1')).toThrow(/65535/);
    expect(() => hook.deriveBuildVersion('0.11.0+65536')).toThrow(/65535/);
    expect(hook.deriveBuildVersion('65535.65535.65535+65535').buildVersion).toBe(
      '65535.65535.65535.65535',
    );
  });

  it('writes the derived number onto both the config and the built AppInfo', async () => {
    const config: Record<string, unknown> = {};
    const appInfo = { buildVersion: '0.11.0+1' };
    const projectDir = APP_DIR;

    await hook({ packager: { projectDir, config, appInfo } });

    const expected = hook.deriveBuildVersion(manifest.version).buildVersion;
    expect(config.buildVersion).toBe(expected);
    expect(appInfo.buildVersion).toBe(expected);
  });

  it('restores the revisioned version on the metadata and on both AppInfo objects', async () => {
    // The regression: electron-builder strips the revision out of the manifest
    // version, so AppInfo.version, the artifact names, and the generated
    // latest-mac.yml all said 0.11.0 while the release gate tagged 0.11.0+1.
    // `metadata` is what every AppInfo reads `version` from, and by the time
    // beforePack runs both the platform and the root AppInfo already exist.
    const config: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = { version: '0.11.0' };
    const platformAppInfo: Record<string, unknown> = { version: '0.11.0', buildVersion: '0.11.0' };
    const rootAppInfo: Record<string, unknown> = { version: '0.11.0', buildVersion: '0.11.0' };
    const platformSpecificBuildOptions: Record<string, unknown> = {};
    const rootPackager = {
      projectDir: APP_DIR,
      config,
      metadata,
      appInfo: rootAppInfo,
    };
    const platformPackager = {
      info: rootPackager,
      config,
      metadata,
      appInfo: platformAppInfo,
      platform: { buildConfigurationKey: 'mac', nodeName: 'darwin' },
      platformSpecificBuildOptions,
    };

    await hook({ packager: platformPackager });

    const { featureVersion, releaseVersion, buildVersion } = hook.deriveBuildVersion(manifest.version);
    expect(releaseVersion).toBe(manifest.version);
    expect(metadata.version).toBe(releaseVersion);
    expect(platformAppInfo.version).toBe(releaseVersion);
    expect(rootAppInfo.version).toBe(releaseVersion);
    expect(platformAppInfo.buildVersion).toBe(buildVersion);
    expect(rootAppInfo.buildVersion).toBe(buildVersion);
    // winPackager's ProductVersion is `shortVersionWindows`, falling back to
    // getVersionInWeirdWindowsForm(appInfo.version) which drops the revision
    // (0.11.0+1 -> 0.11.0.0) and so disagreed with FileVersion.
    expect(platformAppInfo.shortVersionWindows).toBe(buildVersion);
    expect(rootAppInfo.shortVersionWindows).toBe(buildVersion);
    // buildNumber is what the Linux deb iteration counts; left untouched.
    expect(config).not.toHaveProperty('buildNumber');
    expect(config.buildVersion).toBe(buildVersion);
    // The mac marketing version stays the Apple-shaped feature version.
    expect(platformSpecificBuildOptions.bundleShortVersion).toBe(featureVersion);
  });

  it('pins the short version on mac only, and lets an explicit one win', async () => {
    const macOptions: Record<string, unknown> = {};
    await hook({
      packager: {
        projectDir: APP_DIR,
        platform: { buildConfigurationKey: 'mac', nodeName: 'darwin' },
        platformSpecificBuildOptions: macOptions,
      },
    });
    expect(macOptions.bundleShortVersion).toBe(hook.deriveBuildVersion(manifest.version).featureVersion);

    const winOptions: Record<string, unknown> = {};
    await hook({
      packager: {
        projectDir: APP_DIR,
        platform: { buildConfigurationKey: 'win', nodeName: 'win32' },
        platformSpecificBuildOptions: winOptions,
      },
    });
    expect(winOptions).not.toHaveProperty('bundleShortVersion');

    const pinnedOptions: Record<string, unknown> = { bundleShortVersion: '9.9.9' };
    await hook({
      packager: {
        projectDir: APP_DIR,
        platform: { buildConfigurationKey: 'mac', nodeName: 'darwin' },
        platformSpecificBuildOptions: pinnedOptions,
      },
    });
    expect(pinnedOptions.bundleShortVersion).toBe('9.9.9');
  });

  it('builds the manifest version the release gate tags', () => {
    // `tool/release-version.mjs` accepts major.minor.patch+<number> for Flux and
    // rejects anything else, so the manifest must stay in that exact form.
    expect(manifest.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\+((0|[1-9]\d*))$/);
    expect(hook.deriveBuildVersion(manifest.version).buildVersion).toBe('0.11.0.1');
    // The gate compares the revision, so the version electron-builder reports
    // and names artifacts with must be the exact string the gate tags.
    expect(hook.deriveBuildVersion(manifest.version).releaseVersion).toBe(manifest.version);
  });
});

describe('apps/flux electron-builder config', () => {
  it('carries no build number or app version of its own', () => {
    // electron-builder has no `version` config key, and a literal buildVersion
    // cannot track the manifest.
    expect(builderConfig).not.toMatch(/^version:/m);
    expect(builderConfig).not.toMatch(/^buildVersion:/m);
    expect(builderConfig).toMatch(/^beforePack: /m);
  });

  it('carries no mac short version of its own, so the hook pins it to the feature version', () => {
    // A literal bundleShortVersion would go stale exactly like a literal
    // buildVersion did, and the hook would then leave it alone.
    expect(builderConfig).not.toMatch(/^\s+bundleShortVersion:/m);
  });

  it('resolves the hook the same way electron-builder does, from any directory', () => {
    // electron-builder resolves a relative beforePack against the invocation
    // directory, and this app is packaged both from apps/flux and from the
    // repository root, so the config names a resolvable package subpath.
    const specifier = builderConfig.match(/^beforePack: "([^"]+)"$/m)?.[1];
    expect(specifier).toBe('@lumacast/flux/script/build-version.cjs');
    expect(require.resolve(specifier!)).toBe(hookPath);
  });
});
