// The Linux platform adapter. Two independent installer kinds, each with its
// own discovery and removal path: a deb package (system scope, dpkg-owned,
// `/opt/<productName>`) and a portable AppImage (user scope only, a plain
// file in `~/Applications` named by electron-builder's artifactName).
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
import { assertInside, assertNotSelf } from './safety';
import { updaterCacheDir, userDataDirCandidates } from './user-data-names';

function installLocations(env: PlatformEnv): Record<InstallScope, string> {
  return {
    user: path.posix.join(env.homeDir, 'Applications'),
    system: '/opt',
  };
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches an AppImage electron-builder's `artifactName` produces
 * (`${productName}-${version}-${arch}-linux.AppImage`), and — since a
 * version may itself be built without an arch token — the same shape
 * without one.
 */
function appImagePattern(productName: string, withArch: boolean): RegExp {
  const escaped = escapeForRegExp(productName);
  return withArch
    ? new RegExp(`^${escaped}-(.+)-(x64|arm64)-linux\\.AppImage$`)
    : new RegExp(`^${escaped}-(.+)-linux\\.AppImage$`);
}

function matchAppImage(app: SuiteAppDescriptor, fileName: string): RegExpExecArray | null {
  return appImagePattern(app.productName, true).exec(fileName) ?? appImagePattern(app.productName, false).exec(fileName);
}

async function discoverDeb(deps: PlatformAdapterDeps, app: SuiteAppDescriptor): Promise<InstalledApp | null> {
  const result = await deps.exec('dpkg-query', ['-W', '-f=${Version}', app.linux.debPackageName]);
  if (result.code !== 0) {
    return null;
  }
  const version = result.stdout.trim();
  if (!version) {
    return null;
  }
  return {
    app: app.id,
    version,
    location: path.posix.join('/opt', app.productName),
    scope: 'system',
  };
}

async function discoverAppImage(deps: PlatformAdapterDeps, app: SuiteAppDescriptor): Promise<InstalledApp | null> {
  const dir = installLocations(deps.env).user;
  let entries: string[];
  try {
    entries = await deps.fs.readDir(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const match = matchAppImage(app, entry);
    if (match) {
      return {
        app: app.id,
        version: match[1],
        location: path.posix.join(dir, entry),
        scope: 'user',
      };
    }
  }
  return null;
}

async function discover(deps: PlatformAdapterDeps, app: SuiteAppDescriptor): Promise<InstalledApp | null> {
  const deb = await discoverDeb(deps, app);
  if (deb) {
    return deb;
  }
  return discoverAppImage(deps, app);
}

async function installAppImage(deps: PlatformAdapterDeps, request: InstallRequest): Promise<InstalledApp> {
  const { app, artifact, artifactPath } = request;
  const dir = installLocations(deps.env).user;
  await deps.fs.mkdir(dir);

  // AppImage has no system-scope install: it always lands in the per-user
  // Applications dir regardless of `request.scope` (see the module comment).
  const fileName = path.posix.basename(artifact.name);
  const targetPath = path.posix.join(dir, fileName);
  assertInside(dir, targetPath);

  await deps.fs.copyFile(artifactPath, targetPath);
  await deps.fs.chmod(targetPath, 0o755);

  const entries = await deps.fs.readDir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (entry === fileName) {
      continue;
    }
    if (matchAppImage(app, entry)) {
      const stalePath = path.posix.join(dir, entry);
      assertInside(dir, stalePath);
      await deps.fs.remove(stalePath);
    }
  }

  const installed = await discover(deps, app);
  if (!installed) {
    throw new Error(`Install completed but ${fileName} was not found afterward`);
  }
  return installed;
}

async function installDeb(deps: PlatformAdapterDeps, request: InstallRequest): Promise<InstalledApp> {
  const { app, artifactPath, signal } = request;
  const result = await deps.exec('pkexec', ['dpkg', '-i', artifactPath], { signal });
  if (result.code !== 0) {
    throw new Error(`dpkg install failed (${result.code}): ${result.stderr}`);
  }
  const installed = await discover(deps, app);
  if (!installed) {
    throw new Error(`Install completed but ${app.linux.debPackageName} was not found afterward`);
  }
  return installed;
}

async function install(deps: PlatformAdapterDeps, request: InstallRequest): Promise<InstalledApp> {
  assertNotSelf(request.app);
  if (request.artifact.kind === 'linux-appimage') {
    return installAppImage(deps, request);
  }
  if (request.artifact.kind === 'linux-deb') {
    return installDeb(deps, request);
  }
  throw new Error(`linux adapter cannot install artifact kind ${request.artifact.kind}`);
}

async function uninstall(deps: PlatformAdapterDeps, request: UninstallRequest): Promise<void> {
  const { app, installed, removeUserData, signal } = request;
  assertNotSelf(app);

  if (installed.location.endsWith('.AppImage')) {
    const dir = installLocations(deps.env).user;
    assertInside(dir, installed.location);
    await deps.fs.trash(installed.location);
  } else {
    const result = await deps.exec('pkexec', ['dpkg', '-r', app.linux.debPackageName], { signal });
    if (result.code !== 0) {
      throw new Error(`dpkg remove failed (${result.code}): ${result.stderr}`);
    }
  }

  if (removeUserData) {
    for (const name of userDataDirCandidates(app, 'linux')) {
      const dir = path.posix.join(deps.env.appDataDir, name);
      assertInside(deps.env.appDataDir, dir);
      await deps.fs.remove(dir);
    }
    const updater = updaterCacheDir(app, 'linux', deps.env);
    assertInside(updater.root, updater.dir);
    if (await deps.fs.exists(updater.dir)) {
      await deps.fs.remove(updater.dir);
    }
  }
}

async function launch(deps: PlatformAdapterDeps, app: SuiteAppDescriptor, installed: InstalledApp): Promise<void> {
  if (!deps.spawnDetached) {
    throw new Error('linux adapter requires spawnDetached to launch apps');
  }
  const target = installed.location.endsWith('.AppImage')
    ? installed.location
    : path.posix.join('/opt', app.productName, app.linux.executableName);
  await deps.spawnDetached(target, []);
}

export function createLinuxPlatformAdapter(deps: PlatformAdapterDeps): PlatformAdapter {
  return {
    platform: 'linux',
    installLocations: () => installLocations(deps.env),
    systemScopeWritable: () => deps.fs.writable('/opt'),
    discover: (app) => discover(deps, app),
    install: (request) => install(deps, request),
    uninstall: (request) => uninstall(deps, request),
    launch: (app, installedApp) => launch(deps, app, installedApp),
    revealPath: (installedApp) => installedApp.location,
  };
}
