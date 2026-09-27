// The Windows platform adapter: every managed app ships an NSIS installer
// (apps/*/electron-builder.yml), discovered through the uninstall registry
// key it writes rather than by guessing a path.
//
// The registry shape is messier than the key name suggests: the entry key is
// an opaque GUID, `DisplayName` carries a version suffix (`LumaChord 0.1.1`,
// not `LumaChord`), and `InstallLocation` is usually absent. Matching is
// therefore done per app descriptor — version-suffix-tolerant display-name
// comparison plus the executable name as an app-id signal in the uninstall
// and icon paths — and the install location is inferred from
// `InstallLocation`, else the uninstall command's executable, else the icon
// path. Only when no registry entry matches does discovery fall back to
// probing the filesystem (and reading the version off the executable via
// PowerShell).
//
// `path.win32` is used explicitly throughout (never the bare `path` module)
// so this file's path logic is identical whether tests run it on macOS/Linux
// CI or a real Windows host.
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

/**
 * Strips the version suffix NSIS appends to the registry display name
 * (`LumaChord 0.1.1` -> `LumaChord`); a bare product name is returned
 * unchanged.
 */
function stripVersionSuffix(displayName: string): string {
  return displayName.replace(/\s+\d+\.\d+(\.\d+)*(\+\d+)?$/, '');
}

/**
 * Whether an uninstall registry entry belongs to `app`. The display name is
 * compared version-suffix-tolerantly, and the executable name acts as the
 * app-id signal inside the uninstall and icon paths, so an entry is still
 * recognized when its display name was customized.
 */
function entryMatchesApp(entry: RegQueryEntry, app: SuiteAppDescriptor): boolean {
  const display = entry.values.DisplayName ?? '';
  const target = normalizeDisplayName(app.win.displayName);
  if (normalizeDisplayName(display) === target) return true;
  if (normalizeDisplayName(stripVersionSuffix(display)) === target) return true;
  const exeName = app.win.executableName.toLowerCase();
  for (const field of [entry.values.UninstallString, entry.values.QuietUninstallString, entry.values.DisplayIcon]) {
    if (field && field.toLowerCase().includes(exeName)) return true;
  }
  return false;
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

async function findAppEntry(
  deps: PlatformAdapterDeps,
  hive: Hive,
  app: SuiteAppDescriptor,
): Promise<RegQueryEntry | null> {
  const result = await deps.exec('reg', ['query', `${hive}\\${UNINSTALL_SUBKEY}`, '/s']);
  if (result.code !== 0) {
    return null;
  }
  const entries = parseRegQueryOutput(result.stdout);
  return entries.find((entry) => entryMatchesApp(entry, app)) ?? null;
}

/** Best-effort executable path out of an uninstall command; null when unparseable. */
function exeDirFromCommand(command: string | undefined): string | null {
  if (!command) return null;
  try {
    return path.win32.dirname(parseCommandLine(command).file);
  } catch {
    return null;
  }
}

/**
 * The install directory for a registry entry. NSIS entries usually omit
 * `InstallLocation`, so it is inferred from the uninstall command's
 * executable, else the icon path (`<dir>\<exe>,0`).
 */
function inferInstallLocation(entry: RegQueryEntry): string {
  const installLocation = (entry.values.InstallLocation ?? '').trim();
  if (installLocation) return installLocation;
  const fromUninstall =
    exeDirFromCommand(entry.values.QuietUninstallString) ?? exeDirFromCommand(entry.values.UninstallString);
  if (fromUninstall) return fromUninstall;
  const iconPath = (entry.values.DisplayIcon ?? '').split(',')[0]?.trim().replace(/^"|"$/g, '');
  if (iconPath) return path.win32.dirname(iconPath);
  return '';
}

async function entryToInstalled(
  deps: PlatformAdapterDeps,
  entry: RegQueryEntry,
  app: SuiteAppDescriptor,
  scope: InstalledApp['scope'],
): Promise<InstalledApp> {
  const location = inferInstallLocation(entry);
  let version = (entry.values.DisplayVersion ?? '').trim();
  if (!version && location) {
    version = (await readExeVersion(path.win32.join(location, app.win.executableName), deps.exec)) ?? '';
  }
  return { app: app.id, version: version || '0.0.0', location, scope };
}

/**
 * Finds a subdirectory of `baseDir` containing `exeName`. The NSIS install
 * directory is derived from the npm package name rather than the product
 * name (`@lumacast/chord` -> `@lumacastchord`, `@lumacast/cast` ->
 * `lumacast`), so the directory cannot be guessed from the descriptor alone
 * and is searched instead.
 */
async function findExeDir(
  deps: PlatformAdapterDeps,
  baseDir: string,
  exeName: string,
): Promise<string | null> {
  let names: string[];
  try {
    names = await deps.fs.readDir(baseDir);
  } catch {
    return null;
  }
  for (const name of names) {
    const candidate = path.win32.join(baseDir, name, exeName);
    try {
      if (await deps.fs.exists(candidate)) return path.win32.join(baseDir, name);
    } catch {
      continue;
    }
  }
  return null;
}

async function discover(deps: PlatformAdapterDeps, app: SuiteAppDescriptor): Promise<InstalledApp | null> {
  const userEntry = await findAppEntry(deps, 'HKCU', app);
  if (userEntry) {
    return entryToInstalled(deps, userEntry, app, 'user');
  }

  const systemEntry = await findAppEntry(deps, 'HKLM', app);
  if (systemEntry) {
    return entryToInstalled(deps, systemEntry, app, 'system');
  }

  // Neither hive has an uninstall entry. Probe the conventional product-name
  // directory first (the common case), then scan the install locations for
  // the executable, and read its version from the file metadata. This handles
  // portable installs or apps installed before Cloud was present.
  const locations = installLocations(deps.env);
  const candidates: Array<{ dir: string; scope: InstalledApp['scope'] }> = [
    { dir: path.win32.join(locations.user, app.productName), scope: 'user' },
  ];
  const scannedUserDir = await findExeDir(deps, locations.user, app.win.executableName);
  if (scannedUserDir) candidates.push({ dir: scannedUserDir, scope: 'user' });
  const scannedSystemDir = await findExeDir(deps, locations.system, app.win.executableName);
  if (scannedSystemDir) candidates.push({ dir: scannedSystemDir, scope: 'system' });

  for (const candidate of candidates) {
    const exePath = path.win32.join(candidate.dir, app.win.executableName);
    if (await deps.fs.exists(exePath)) {
      const version = await readExeVersion(exePath, deps.exec);
      if (version) {
        return { app: app.id, version, location: candidate.dir, scope: candidate.scope };
      }
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
  const entry = await findAppEntry(deps, hive, app);
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
