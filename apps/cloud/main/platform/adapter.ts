// The per-platform seam of the suite manager. Everything that touches the
// filesystem layout of an installed app, a package manager, the registry, or
// an installer binary lives behind this interface, one implementation per
// platform (darwin.ts, win32.ts, linux.ts). Everything above it — catalog,
// download, verification, permissions, operations, IPC — is platform-neutral.
//
// Implementations receive their side effects (`exec`, `fs`) injected so the
// unit tests under tests/apps/cloud/main/platform can drive them with fakes.
import type {
  HostArch,
  HostPlatform,
  InstallArtifact,
  InstalledApp,
  SuiteAppDescriptor,
} from '@lumacast/suite';
import type { InstallScope } from '../../shared/desktop-api';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell. Rejects only when the program cannot start. */
export type ExecFn = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ExecResult>;

export interface PlatformFs {
  exists: (path: string) => Promise<boolean>;
  readFile: (path: string) => Promise<string>;
  readDir: (path: string) => Promise<string[]>;
  mkdir: (path: string) => Promise<void>;
  copyFile: (from: string, to: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  /** True when the directory can be written without elevation. */
  writable: (path: string) => Promise<boolean>;
  /** Moves a path to the OS trash (`shell.trashItem`). */
  trash: (path: string) => Promise<void>;
}

export interface PlatformEnv {
  platform: HostPlatform;
  arch: HostArch;
  homeDir: string;
  /** `app.getPath('appData')` — the parent of every app's user-data dir. */
  appDataDir: string;
  /** Cloud's own temp/download directory. */
  downloadsDir: string;
}

export interface InstallRequest {
  app: SuiteAppDescriptor;
  artifact: InstallArtifact;
  /** Absolute path of the downloaded, hash-verified artifact. */
  artifactPath: string;
  scope: InstallScope;
  signal?: AbortSignal;
  /** Reported while extracting/installing when the step can measure it. */
  onStage?: (stage: string) => void;
}

export interface UninstallRequest {
  app: SuiteAppDescriptor;
  installed: InstalledApp;
  removeUserData: boolean;
  signal?: AbortSignal;
}

export interface PlatformAdapter {
  readonly platform: HostPlatform;
  /** Absolute install directory per scope. */
  installLocations: () => Record<InstallScope, string>;
  systemScopeWritable: () => Promise<boolean>;
  /** Finds an installed copy of one app; null when absent. */
  discover: (app: SuiteAppDescriptor) => Promise<InstalledApp | null>;
  /** Installs (or replaces) the app from a verified artifact. Returns the new install. */
  install: (request: InstallRequest) => Promise<InstalledApp>;
  uninstall: (request: UninstallRequest) => Promise<void>;
  launch: (app: SuiteAppDescriptor, installed: InstalledApp) => Promise<void>;
  /** The path to reveal in the file manager for an installed app. */
  revealPath: (installed: InstalledApp) => string;
}

export interface PlatformAdapterDeps {
  env: PlatformEnv;
  exec: ExecFn;
  fs: PlatformFs;
  /**
   * Spawns a detached, unwaited process. Used to launch an installed app on
   * win32/linux, since `ExecFn` waits for exit (darwin uses `exec('open', …)`
   * instead, which returns once the app is asked to open). Optional so a
   * `PlatformAdapterDeps` built before this field existed still typechecks.
   */
  spawnDetached?: (file: string, args: readonly string[]) => Promise<void>;
}
