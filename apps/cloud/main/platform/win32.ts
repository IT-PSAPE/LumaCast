// The Windows platform adapter: the NSIS oneClick/perMachine:false installer
// every managed app ships (apps/*/electron-builder.yml), discovered through
// the uninstall registry key it writes rather than by guessing a path.
//
// `path.win32` is used explicitly throughout (never the bare `path` module)
// so this file's path logic is identical whether tests run it on macOS/Linux
// CI or a real Windows host.
import path from 'node:path';
import { execFile } from 'node:child_process';
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
import { UPDATER_CACHE_DIR_NAMES, userDataDirCandidates } from './user-data-names';
import { parseRegQueryOutput, type RegQueryEntry } from './win32-registry';

const UNINSTALL_SUBKEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

type Hive = 'HKCU' | 'HKLM';

function installLocations(env: PlatformEnv): Record<InstallScope, string> {
  return {
    // Electron's `appData` on Windows is `%APPDATA%`
    // (`C:\Users\x\AppData\Roaming`); its sibling `Local\Programs` is where
    // an NSIS per-user install lands.
    user: path.win32.join(path.win32.dirname(env.appDataDir), 'Local', 'Programs'),
    // There is no per-machine build (nsis.perMachine is false in every app's
    // electron-builder.yml); this exists only so `installLocations()` always
    // returns both scopes, and install() documents that it ignores `system`.
    system: 'C:\\Program Files',
  };
}

function localAppDataDir(env: PlatformEnv): string {
  return path.win32.join(path.win32.dirname(env.appDataDir), 'Local');
}

function normalizeDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

/** Reads the file version from a Windows executable via PowerShell. */
async function readExeVersion(exePath: string, exec: PlatformAdapterDeps['exec']): Promise<string | null> {
  try {
    // Use PowerShell to get the file version info
    const psCommand = `(Get-Item "${exePath.replace(/"/g, '""')}").VersionInfo.FileVersion`;
    const result = await exec('powershell', ['-NoProfile', '-Command', psCommand], { timeoutMs: 5000 });
    if (result.code === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore errors, fall through to null
  }
  return null;
}

async function findByDisplayName(
  deps: PlatformAdapterDeps,
  hive: Hive,
  displayName: string,
): Promise<RegQueryEntry | null> {
  const result = await deps.exec('reg', ['query', `${hive}\\${UNINSTALL_SUBKEY}`, '/s']);
  if (result.code !== 0) {
    return null;
  }
  const entries = parseRegQueryOutput(result.stdout);
  const target = normalizeDisplayName(displayName);
  return entries.find((entry) => normalizeDisplayName(entry.values.DisplayName ?? '') === target) ?? null;
}

async function discover(deps: PlatformAdapterDeps, app: SuiteAppDescriptor): Promise<InstalledApp | null> {
  const userEntry = await findByDisplayName(deps, 'HKCU', app.win.displayName);
  if (userEntry) {
    return {
      app: app.id,
      version: userEntry.values.DisplayVersion ?? '0.0.0',
      location: userEntry.values.InstallLocation ?? '',
      scope: 'user',
    };
  }

  const systemEntry = await findByDisplayName(deps, 'HKLM', app.win.displayName);
  if (systemEntry) {
    return {
      app: app.id,
      version: systemEntry.values.DisplayVersion ?? '0.0.0',
      location: systemEntry.values.InstallLocation ?? '',
      scope: 'system',
    };
  }

  // Neither hive has an uninstall entry. Try to find the executable and read
  // its version from the file metadata. This handles portable installs or apps
  // installed before Cloud was present.
  const locations = installLocations(deps.env);
  const fallbackExe = path.win32.join(locations.user, app.productName, app.win.executableName);
  if (await deps.fs.exists(fallbackExe)) {
    const version = await readExeVersion(fallbackExe, deps.exec);
    if (version) {
      return {
        app: app.id,
        version,
        location: path.win32.dirname(fallbackExe),
        scope: 'user',
      };
    }
  }
  return null;
}

function parseCommandLine(command: string): { file: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of command) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ' ' && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  const [file, ...args] = tokens;
  if (!file) {
    throw new Error(`Could not parse uninstall command: ${command}`);
  }
  return { file, args };
}

async function install(deps: PlatformAdapterDeps, request: InstallRequest): Promise<InstalledApp> {
  const { app, artifact, artifactPath, signal } = request;
  assertNotSelf(app);
  if (artifact.kind !== 'win-nsis') {
    throw new Error(`win32 adapter expects artifact kind "win-nsis", got "${artifact.kind}"`);
  }

  // NSIS here is always oneClick + perMachine:false: there is no per-machine
  // build to target, so `request.scope` is ignored — the installer always
  // lands in the current user's per-user Programs location.
  const result = await deps.exec(artifactPath, ['/S'], { timeoutMs: 10 * 60 * 1000, signal });
  if (result.code !== 0) {
    throw new Error(`Installer exited ${result.code}: ${result.stderr}`);
  }

  const installed = await discover(deps, app);
  if (!installed) {
    throw new Error(`Install completed but ${app.win.displayName} was not found afterward`);
  }
  return installed;
}

function appendSilentFlag(uninstallString: string | undefined): string | undefined {
  if (!uninstallString) {
    return undefined;
  }
  return `${uninstallString} /S`;
}

async function uninstall(deps: PlatformAdapterDeps, request: UninstallRequest): Promise<void> {
  const { app, installed, removeUserData, signal } = request;
  assertNotSelf(app);

  const hive: Hive = installed.scope === 'system' ? 'HKLM' : 'HKCU';
  const entry = await findByDisplayName(deps, hive, app.win.displayName);
  if (!entry) {
    throw new Error(`No uninstall registry entry found for ${app.win.displayName}`);
  }
  const uninstallCommand = entry.values.QuietUninstallString ?? appendSilentFlag(entry.values.UninstallString);
  if (!uninstallCommand) {
    throw new Error(`Uninstall registry entry for ${app.win.displayName} has no uninstall command`);
  }
  const { file, args } = parseCommandLine(uninstallCommand);
  const result = await deps.exec(file, args, { timeoutMs: 5 * 60 * 1000, signal });
  if (result.code !== 0) {
    throw new Error(`Uninstaller exited ${result.code}: ${result.stderr}`);
  }

  if (removeUserData) {
    for (const name of userDataDirCandidates(app, 'win32')) {
      const dir = path.win32.join(deps.env.appDataDir, name);
      assertInside(deps.env.appDataDir, dir, 'win32');
      await deps.fs.remove(dir);
    }
    const localDir = localAppDataDir(deps.env);
    const updaterDir = path.win32.join(localDir, UPDATER_CACHE_DIR_NAMES[app.id]);
    assertInside(localDir, updaterDir, 'win32');
    if (await deps.fs.exists(updaterDir)) {
      await deps.fs.remove(updaterDir);
    }
  }
}

async function launch(deps: PlatformAdapterDeps, app: SuiteAppDescriptor, installed: InstalledApp): Promise<void> {
  if (!deps.spawnDetached) {
    throw new Error('win32 adapter requires spawnDetached to launch apps');
  }
  const exePath = path.win32.join(installed.location, app.win.executableName);
  await deps.spawnDetached(exePath, []);
}

export function createWin32PlatformAdapter(deps: PlatformAdapterDeps): PlatformAdapter {
  return {
    platform: 'win32',
    installLocations: () => installLocations(deps.env),
    systemScopeWritable: () => deps.fs.writable('C:\\Program Files'),
    discover: (app) => discover(deps, app),
    install: (request) => install(deps, request),
    uninstall: (request) => uninstall(deps, request),
    launch: (app, installedApp) => launch(deps, app, installedApp),
    revealPath: (installedApp) => installedApp.location,
  };
}
