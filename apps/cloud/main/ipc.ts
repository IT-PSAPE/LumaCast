// The suite-manager IPC surface. `createIpcHandlers` is a pure function
// (manager, self-updater, and shell effects are all injected) so its
// argument validation and delegation can be unit-tested without Electron;
// `registerIpc` is the thin binding that wires it to real `ipcMain`, real
// `shell` effects, and this window's push channels — mirroring
// apps/flux/main/index.ts's sender-validated `ipcMain.handle` wrapper.
import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { isSuiteAppId, type AppRelease, type SuiteAppId } from '@lumacast/suite';
import type {
  CloudSettings,
  CloudSettingsPatch,
  OperationSnapshot,
  SelfUpdateState,
  SuiteOverview,
  UninstallOptions,
} from '../shared/desktop-api';
import {
  IPC_CHANNELS,
  INVOKED_CHANNELS,
  OPERATION_CHANGE_CHANNEL,
  OVERVIEW_CHANGE_CHANNEL,
  type IpcChannel,
} from './ipc-channels';
import { isApprovedExternalUrl } from './navigation-policy';

// Narrow interfaces rather than the concrete SuiteManager/SelfUpdater classes:
// a fake satisfying these shapes needs no Electron runtime, which is what
// lets tests/apps/cloud/main/ipc.test.ts exercise `createIpcHandlers` under
// plain Node/vitest.
export interface IpcSuiteManager {
  overview(): SuiteOverview;
  refresh(): Promise<SuiteOverview>;
  releases(app: SuiteAppId): AppRelease[];
  grant(app: SuiteAppId): Promise<CloudSettings>;
  revoke(app: SuiteAppId): Promise<CloudSettings>;
  updateSettings(patch: CloudSettingsPatch): Promise<CloudSettings>;
  install(app: SuiteAppId, version?: string): Promise<OperationSnapshot>;
  uninstall(app: SuiteAppId, options?: UninstallOptions): Promise<OperationSnapshot>;
  cancel(operationId: string): Promise<void>;
  operations(): OperationSnapshot[];
  open(app: SuiteAppId): Promise<void>;
  reveal(app: SuiteAppId): string;
  releaseNotesUrl(app: SuiteAppId, version: string): string;
  on(event: 'overview-change', listener: (overview: SuiteOverview) => void): unknown;
  on(event: 'operation-change', listener: (operation: OperationSnapshot) => void): unknown;
}

export interface IpcSelfUpdater {
  state(): SelfUpdateState;
  check(): Promise<SelfUpdateState>;
  installAndRestart(): void;
  on(event: 'change', listener: (state: SelfUpdateState) => void): unknown;
}

export interface IpcEffects {
  showItemInFolder: (path: string) => void;
  openExternal: (url: string) => Promise<void>;
}

export type IpcHandlerMap = Record<IpcChannel, (...args: unknown[]) => unknown>;

function parseAppId(value: unknown): SuiteAppId {
  const candidate = z.string().parse(value);
  if (!isSuiteAppId(candidate)) {
    throw new Error(`Unknown suite app id: ${candidate}`);
  }
  return candidate;
}

// electron-builder release tags and version strings are short; 64 is a
// generous bound that still rejects an absurd or malicious payload.
const versionStringSchema = z.string().min(1).max(64);
const operationIdSchema = z.string().min(1).max(128);

const settingsPatchSchema = z.object({
  installScope: z.enum(['user', 'system']).optional(),
  checkOnLaunch: z.boolean().optional(),
});

const uninstallOptionsSchema = z.object({
  removeUserData: z.boolean().optional(),
});

function parseOptionalVersion(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return versionStringSchema.parse(value);
}

function parseUninstallOptions(value: unknown): UninstallOptions | undefined {
  if (value === undefined) return undefined;
  return uninstallOptionsSchema.parse(value);
}

export function createIpcHandlers(
  manager: IpcSuiteManager,
  selfUpdater: IpcSelfUpdater,
  effects: IpcEffects,
): IpcHandlerMap {
  return {
    [IPC_CHANNELS.overview]: async () => manager.overview(),

    [IPC_CHANNELS.refresh]: async () => manager.refresh(),

    [IPC_CHANNELS.releases]: async (appArg: unknown) => manager.releases(parseAppId(appArg)),

    [IPC_CHANNELS.grant]: async (appArg: unknown) => manager.grant(parseAppId(appArg)),

    [IPC_CHANNELS.revoke]: async (appArg: unknown) => manager.revoke(parseAppId(appArg)),

    [IPC_CHANNELS.updateSettings]: async (patchArg: unknown) =>
      manager.updateSettings(settingsPatchSchema.parse(patchArg ?? {})),

    [IPC_CHANNELS.install]: async (appArg: unknown, versionArg?: unknown) =>
      manager.install(parseAppId(appArg), parseOptionalVersion(versionArg)),

    [IPC_CHANNELS.uninstall]: async (appArg: unknown, optionsArg?: unknown) =>
      manager.uninstall(parseAppId(appArg), parseUninstallOptions(optionsArg)),

    [IPC_CHANNELS.cancel]: async (idArg: unknown) => manager.cancel(operationIdSchema.parse(idArg)),

    [IPC_CHANNELS.operations]: async () => manager.operations(),

    [IPC_CHANNELS.open]: async (appArg: unknown) => manager.open(parseAppId(appArg)),

    [IPC_CHANNELS.reveal]: async (appArg: unknown) => {
      effects.showItemInFolder(manager.reveal(parseAppId(appArg)));
    },

    [IPC_CHANNELS.openReleaseNotes]: async (appArg: unknown, versionArg: unknown) => {
      const url = manager.releaseNotesUrl(parseAppId(appArg), versionStringSchema.parse(versionArg));
      // Defense in depth: manager.releaseNotesUrl already restricts itself to
      // https://github.com/..., but shell.openExternal only ever runs behind
      // this app-wide allow-list check, same as window-open in main/window.ts.
      if (!isApprovedExternalUrl(url)) {
        throw new Error(`Refusing to open an unapproved external URL: ${url}`);
      }
      await effects.openExternal(url);
    },

    [IPC_CHANNELS.checkForSelfUpdate]: async () => selfUpdater.check(),

    [IPC_CHANNELS.installSelfUpdate]: async () => {
      selfUpdater.installAndRestart();
    },
  };
}

export interface RegisterIpcOptions {
  manager: IpcSuiteManager;
  selfUpdater: IpcSelfUpdater;
  getWindow: () => BrowserWindow | null;
}

export function registerIpc(options: RegisterIpcOptions): void {
  const { manager, selfUpdater, getWindow } = options;
  const effects: IpcEffects = {
    showItemInFolder: (path) => {
      shell.showItemInFolder(path);
    },
    openExternal: (url) => shell.openExternal(url),
  };
  const handlers = createIpcHandlers(manager, selfUpdater, effects);

  for (const channel of INVOKED_CHANNELS) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const window = getWindow();
      if (event.sender !== window?.webContents || event.senderFrame !== window?.webContents.mainFrame) {
        throw new Error('Invalid IPC sender');
      }
      return handlers[channel](...args);
    });
  }

  const pushOverview = (overview: SuiteOverview): void => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(OVERVIEW_CHANGE_CHANNEL, overview);
  };
  const pushOperation = (operation: OperationSnapshot): void => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(OPERATION_CHANGE_CHANNEL, operation);
  };

  manager.on('overview-change', pushOverview);
  manager.on('operation-change', pushOperation);
  // The self-updater isn't a manager event, but its state is embedded in
  // every overview (`SuiteOverview.selfUpdate`); without this the renderer's
  // self-update section would only ever refresh on the next manual refresh.
  selfUpdater.on('change', () => pushOverview(manager.overview()));
}
