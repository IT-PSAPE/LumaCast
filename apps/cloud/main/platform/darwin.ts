// The macOS platform adapter: `.app` bundles under /Applications (system) or
// ~/Applications (user), installed from a zipped bundle or a DMG, discovered
// by reading Contents/Info.plist and falling back to Spotlight (`mdfind`)
// when neither well-known location has the bundle.
import path from 'node:path';
import type { InstalledApp, SuiteAppDescriptor } from '@lumacast/suite';
import type { InstallScope } from '../../shared/desktop-api';
import type {
  InstallRequest,
  PlatformAdapter,
  PlatformAdapterDeps,
  PlatformEnv,
  UninstallRequest,
} from './adapter';
import { readInfoPlist } from './info-plist';
import { assertInside, assertNotSelf } from './safety';
import { updaterCacheDir, userDataDirCandidates } from './user-data-names';

function installLocations(env: PlatformEnv): Record<InstallScope, string> {
  return {
    system: '/Applications',
    user: path.posix.join(env.homeDir, 'Applications'),
  };
}

/** POSIX single-quotes a value for use inside a shell command string. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Escapes a shell command string for embedding inside an AppleScript string literal. */
function escapeForAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function runElevated(deps: PlatformAdapterDeps, shellCommand: string, signal?: AbortSignal): Promise<void> {
  const script = `do shell script "${escapeForAppleScript(shellCommand)}" with administrator privileges`;
  const result = await deps.exec('osascript', ['-e', script], { signal });
  if (result.code !== 0) {
    throw new Error(`Elevated operation failed (${result.code}): ${result.stderr}`);
  }
}

async function readBundleAt(
  deps: PlatformAdapterDeps,
  app: SuiteAppDescriptor,
  bundlePath: string,
  scope: InstalledApp['scope'],
): Promise<InstalledApp | null> {
  const exists = await deps.fs.exists(bundlePath);
  if (!exists) {
    return null;
  }
  let xml: string;
  try {
    xml = await deps.fs.readFile(path.posix.join(bundlePath, 'Contents', 'Info.plist'));
  } catch {
    return null;
  }
  const plist = readInfoPlist(xml);
  if (plist.bundleId !== app.bundleId) {
    // A foreign bundle happens to sit at the expected path name; never trust
    // it just because the directory name matched.
    return null;
  }
  return {
    app: app.id,
    version: plist.shortVersion ?? plist.version ?? '0.0.0',
    location: bundlePath,
    scope,
  };
}

async function discover(deps: PlatformAdapterDeps, app: SuiteAppDescriptor): Promise<InstalledApp | null> {
  const locations = installLocations(deps.env);
  const bundleName = app.mac.bundleName;

  const fromUser = await readBundleAt(deps, app, path.posix.join(locations.user, bundleName), 'user');
  if (fromUser) {
    return fromUser;
  }
  const fromSystem = await readBundleAt(deps, app, path.posix.join(locations.system, bundleName), 'system');
  if (fromSystem) {
    return fromSystem;
  }

  // Neither well-known location has it (a custom install dir, e.g.) — ask
  // Spotlight's metadata index for any bundle registered under this id.
  const result = await deps.exec('mdfind', [`kMDItemCFBundleIdentifier == "${app.bundleId}"`]);
  if (result.code !== 0) {
    return null;
  }
  const candidate = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.endsWith('.app'));
  if (!candidate) {
    return null;
  }
  return readBundleAt(deps, app, candidate, 'unknown');
}

async function findAppBundle(deps: PlatformAdapterDeps, dir: string): Promise<string> {
  const entries = await deps.fs.readDir(dir);
  const match = entries.find((entry) => entry.endsWith('.app'));
  if (!match) {
    throw new Error(`No .app bundle found in ${dir}`);
  }
  return path.posix.join(dir, match);
}

async function extractZip(
  deps: PlatformAdapterDeps,
  artifactPath: string,
  stagingDir: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await deps.exec('ditto', ['-x', '-k', artifactPath, stagingDir], { signal });
  if (result.code !== 0) {
    throw new Error(`ditto extract failed (${result.code}): ${result.stderr}`);
  }
  return findAppBundle(deps, stagingDir);
}

async function extractDmg(
  deps: PlatformAdapterDeps,
  artifactPath: string,
  stagingDir: string,
  signal?: AbortSignal,
): Promise<string> {
  const mountPoint = path.posix.join(stagingDir, 'mount');
  await deps.fs.mkdir(mountPoint);
  const attach = await deps.exec(
    'hdiutil',
    ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, artifactPath],
    { signal },
  );
  if (attach.code !== 0) {
    throw new Error(`hdiutil attach failed (${attach.code}): ${attach.stderr}`);
  }
  try {
    const mountedName = (await deps.fs.readDir(mountPoint)).find((entry) => entry.endsWith('.app'));
    if (!mountedName) {
      throw new Error(`No .app bundle found in ${artifactPath}`);
    }
    const copyDir = path.posix.join(stagingDir, 'app');
    await deps.fs.mkdir(copyDir);
    const stagedAppPath = path.posix.join(copyDir, mountedName);
    const copyResult = await deps.exec('ditto', [path.posix.join(mountPoint, mountedName), stagedAppPath], {
      signal,
    });
    if (copyResult.code !== 0) {
      throw new Error(`ditto copy from dmg failed (${copyResult.code}): ${copyResult.stderr}`);
    }
    return stagedAppPath;
  } finally {
    await deps.exec('hdiutil', ['detach', mountPoint]).catch(() => undefined);
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function install(deps: PlatformAdapterDeps, request: InstallRequest): Promise<InstalledApp> {
  const { app, artifact, artifactPath, scope, signal, onStage } = request;
  assertNotSelf(app);

  const locations = installLocations(deps.env);
  const targetDir = locations[scope];
  const bundleName = app.mac.bundleName;
  const stagingDir = path.posix.join(deps.env.downloadsDir, `staging-${app.id}-${randomSuffix()}`);
  await deps.fs.mkdir(stagingDir);

  try {
    onStage?.('extracting');
    const stagedAppPath: string =
      artifact.kind === 'mac-zip'
        ? await extractZip(deps, artifactPath, stagingDir, signal)
        : artifact.kind === 'mac-dmg'
          ? await extractDmg(deps, artifactPath, stagingDir, signal)
          : failUnsupportedArtifact(artifact.kind);

    assertInside(stagingDir, stagedAppPath);

    const stagedXml = await deps.fs.readFile(path.posix.join(stagedAppPath, 'Contents', 'Info.plist'));
    const stagedPlist = readInfoPlist(stagedXml);
    if (stagedPlist.bundleId !== app.bundleId) {
      throw new Error(
        `Downloaded bundle identifies as ${stagedPlist.bundleId ?? 'unknown'}, expected ${app.bundleId}`,
      );
    }

    onStage?.('placing');
    const targetPath = path.posix.join(targetDir, bundleName);
    assertInside(targetDir, targetPath);

    const writable = await deps.fs.writable(targetDir);
    if (writable) {
      if (await deps.fs.exists(targetPath)) {
        // Trash rather than rm: a failed placement is then recoverable.
        await deps.fs.trash(targetPath);
      }
      try {
        await deps.fs.rename(stagedAppPath, targetPath);
      } catch {
        // Cross-volume rename (EXDEV — staging on a different filesystem
        // than the target) can't move; copy then drop the staging copy.
        const copyResult = await deps.exec('ditto', [stagedAppPath, targetPath]);
        if (copyResult.code !== 0) {
          throw new Error(`ditto place failed (${copyResult.code}): ${copyResult.stderr}`);
        }
        await deps.fs.remove(stagedAppPath);
      }
    } else {
      const shellCommand = [
        `rm -rf ${shellQuote(targetPath)}`,
        `ditto ${shellQuote(stagedAppPath)} ${shellQuote(targetPath)}`,
      ].join(' && ');
      await runElevated(deps, shellCommand, signal);
    }
  } finally {
    await deps.fs.remove(stagingDir).catch(() => undefined);
  }

  const installed = await discover(deps, app);
  if (!installed) {
    throw new Error(`Install completed but ${bundleName} was not found afterward`);
  }
  return installed;
}

function failUnsupportedArtifact(kind: string): never {
  throw new Error(`darwin adapter cannot install artifact kind ${kind}`);
}

async function uninstall(deps: PlatformAdapterDeps, request: UninstallRequest): Promise<void> {
  const { app, installed, removeUserData, signal } = request;
  assertNotSelf(app);

  if (path.posix.basename(installed.location) !== app.mac.bundleName) {
    throw new Error(`Refusing to remove ${installed.location}: does not match ${app.mac.bundleName}`);
  }
  const locations = installLocations(deps.env);
  if (installed.scope === 'user' || installed.scope === 'system') {
    assertInside(locations[installed.scope], installed.location);
  }

  const containingDir = path.posix.dirname(installed.location);
  const writable = await deps.fs.writable(containingDir);
  if (writable) {
    await deps.fs.trash(installed.location);
  } else {
    await runElevated(deps, `rm -rf ${shellQuote(installed.location)}`, signal);
  }

  if (removeUserData) {
    for (const name of userDataDirCandidates(app, 'darwin')) {
      const dir = path.posix.join(deps.env.appDataDir, name);
      assertInside(deps.env.appDataDir, dir);
      await deps.fs.remove(dir);
    }
    const updater = updaterCacheDir(app, 'darwin', deps.env);
    assertInside(updater.root, updater.dir);
    if (await deps.fs.exists(updater.dir)) {
      await deps.fs.remove(updater.dir);
    }
  }
}

async function launch(deps: PlatformAdapterDeps, app: SuiteAppDescriptor, installed: InstalledApp): Promise<void> {
  const result = await deps.exec('open', ['-a', installed.location]);
  if (result.code !== 0) {
    throw new Error(`Failed to launch ${app.productName} (${result.code}): ${result.stderr}`);
  }
}

export function createDarwinPlatformAdapter(deps: PlatformAdapterDeps): PlatformAdapter {
  return {
    platform: 'darwin',
    installLocations: () => installLocations(deps.env),
    systemScopeWritable: () => deps.fs.writable('/Applications'),
    discover: (app) => discover(deps, app),
    install: (request) => install(deps, request),
    uninstall: (request) => uninstall(deps, request),
    launch: (app, installedApp) => launch(deps, app, installedApp),
    revealPath: (installedApp) => installedApp.location,
  };
}

