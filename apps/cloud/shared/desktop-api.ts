// The LumaCloud renderer's entire privileged surface, and the only module both
// processes depend on. It is a contract boundary, not code: no Electron, no
// Node builtins, and no main-process module may be named here, so the same
// shape is importable from main (which implements it over IPC) and from the
// renderer (which consumes `window.lumacloud`). Suite data types come from
// @lumacast/suite, which is renderer-safe by construction.
import type {
  AppRelease,
  AppState,
  HostArch,
  HostPlatform,
  SuiteAppId,
} from '@lumacast/suite';

/** Where Cloud puts the apps it installs. */
export type InstallScope = 'user' | 'system';

export interface HostInfo {
  platform: HostPlatform;
  arch: HostArch;
  /** LumaCloud's own version (`app.getVersion()`). */
  cloudVersion: string;
  /** False in `electron-vite dev`: installs still work, self-update does not. */
  packaged: boolean;
  /** Absolute install directory for each scope on this host. */
  installLocations: Record<InstallScope, string>;
  /** Whether the system-scope location is writable without elevation. */
  systemScopeWritable: boolean;
}

/**
 * A grant is the user's explicit consent for Cloud to install, update,
 * downgrade, uninstall, and launch one managed identity. Main refuses every
 * one of those for an identity without a grant, so the renderer must ask
 * first. Cloud's own identity is managed by its self-updater, never by a
 * grant.
 */
export interface PermissionGrant {
  bundleId: string;
  app: SuiteAppId;
  grantedAt: string;
}

export interface CloudSettings {
  installScope: InstallScope;
  /** Refresh the catalog when the window opens. */
  checkOnLaunch: boolean;
  grants: PermissionGrant[];
}

export type CloudSettingsPatch = Partial<Pick<CloudSettings, 'installScope' | 'checkOnLaunch'>>;

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SuiteOverview {
  host: HostInfo;
  settings: CloudSettings;
  catalog: {
    status: CatalogStatus;
    /** ISO time of the last successful fetch, null before the first. */
    fetchedAt: string | null;
    /** Set when status is 'error'. */
    error: string | null;
  };
  /** One entry per managed app, in registry order (Cloud included). */
  apps: AppState[];
  selfUpdate: SelfUpdateState;
}

export type OperationKind = 'install' | 'update' | 'downgrade' | 'uninstall';

export type OperationStatus =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'removing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface OperationProgress {
  transferred: number;
  total: number | null;
  /** 0–100, or null when the total is unknown. */
  percent: number | null;
  bytesPerSecond: number | null;
}

export interface OperationSnapshot {
  id: string;
  app: SuiteAppId;
  kind: OperationKind;
  /** The version being installed, or the version being removed. */
  version: string;
  status: OperationStatus;
  progress: OperationProgress;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** LumaCloud's own electron-updater state, surfaced instead of dialogs. */
export type SelfUpdateStatus =
  | 'unavailable' // unpackaged build
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface SelfUpdateState {
  status: SelfUpdateStatus;
  availableVersion: string | null;
  percent: number | null;
  error: string | null;
  checkedAt: string | null;
}

export interface UninstallOptions {
  removeUserData?: boolean;
}

export interface CloudDesktopAPI {
  overview: () => Promise<SuiteOverview>;
  /** Re-fetches the catalog and rescans installed apps. */
  refresh: () => Promise<SuiteOverview>;
  /** Every installable release for an app, newest first. */
  releases: (app: SuiteAppId) => Promise<AppRelease[]>;

  grant: (app: SuiteAppId) => Promise<CloudSettings>;
  revoke: (app: SuiteAppId) => Promise<CloudSettings>;
  updateSettings: (patch: CloudSettingsPatch) => Promise<CloudSettings>;

  /**
   * Installs `version`, or the latest when omitted. Main labels the operation
   * install/update/downgrade from what is on disk. Resolves with the queued
   * operation; progress arrives through `onOperation`.
   */
  install: (app: SuiteAppId, version?: string) => Promise<OperationSnapshot>;
  uninstall: (app: SuiteAppId, options?: UninstallOptions) => Promise<OperationSnapshot>;
  cancel: (operationId: string) => Promise<void>;
  operations: () => Promise<OperationSnapshot[]>;

  open: (app: SuiteAppId) => Promise<void>;
  reveal: (app: SuiteAppId) => Promise<void>;
  /** Opens a release's GitHub notes in the OS browser. */
  openReleaseNotes: (app: SuiteAppId, version: string) => Promise<void>;

  checkForSelfUpdate: () => Promise<SelfUpdateState>;
  installSelfUpdate: () => Promise<void>;

  onOverview: (callback: (overview: SuiteOverview) => void) => () => void;
  onOperation: (callback: (operation: OperationSnapshot) => void) => () => void;
}

declare global {
  interface Window {
    lumacloud?: CloudDesktopAPI;
  }
}
