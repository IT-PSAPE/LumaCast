import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * Regression coverage for issue #152: main registers every RPC handler
 * through the canonical operation map (`IPC` / `RpcOperations` in
 * app/core/ipc.ts), and unknown operations or malformed input fail before
 * application/repository code rather than silently doing nothing.
 *
 * `app/main/ipc.ts` now builds a single `rpcHandlers` object literal typed
 * against `RpcHandlerMap` (a mapped type over `RpcOperations`) and registers
 * it in one call to `registerRpcHandlers`, which iterates the canonical `IPC`
 * map (skipping the two frame channels) and calls `ipcMain.handle` for each.
 * That gives a compile-time guarantee that `rpcHandlers` has exactly the
 * required keys — this file adds the runtime half: that the *actual*
 * `ipcMain.handle`/`ipcMain.on` registrations produced by
 * `registerIpcHandlers` match that map exactly, with nothing missing and
 * nothing extra.
 *
 * `electron` is mocked following the pattern in
 * app/main/application-menu.test.ts: `vi.mock('electron', ...)` with
 * `vi.fn()` spies, declared before importing the module under test.
 * `./security`'s `assertTrustedIpcSender` is also mocked to a no-op so tests
 * can invoke captured handlers directly without constructing a real trusted
 * `BrowserWindow`/webContents graph — sender-trust enforcement is covered by
 * its own test, not this one.
 *
 * `preload.ts` is deliberately never imported here (it calls
 * `contextBridge`/`ipcRenderer` at module scope and is not safely importable
 * in a test environment). Its completeness against the canonical map is
 * enforced at compile time instead: `preload.ts`'s exported `api` object
 * `satisfies MainApi`, and `MainApi`'s RPC surface is itself derived from
 * `RpcOperations`, so an extra, missing, or mistyped member there fails
 * `tsc`, not this test.
 */

// safeHandle in app/main/ipc.ts always registers an async wrapper, so every
// captured handler here is a promise-returning function at runtime.
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;
type OnListener = (...args: unknown[]) => void;

const { handleRegistrations, onRegistrations } = vi.hoisted(() => {
  return {
    handleRegistrations: new Map<string, InvokeHandler>(),
    onRegistrations: new Map<string, OnListener>(),
  };
});

vi.mock('electron', () => {
  const handle = vi.fn((channel: string, handler: InvokeHandler) => {
    handleRegistrations.set(channel, handler);
  });
  const on = vi.fn((channel: string, listener: OnListener) => {
    onRegistrations.set(channel, listener);
  });
  return {
    ipcMain: { handle, on },
    BrowserWindow: { fromWebContents: vi.fn(() => null) },
    Menu: {
      buildFromTemplate: vi.fn(() => []),
      setApplicationMenu: vi.fn(),
      getApplicationMenu: vi.fn(() => null),
    },
    app: { isPackaged: false },
    clipboard: { readText: vi.fn(), writeText: vi.fn() },
    dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
    shell: { openPath: vi.fn(), openExternal: vi.fn() },
  };
});

vi.mock('./security', () => ({
  assertTrustedIpcSender: vi.fn(),
}));

import { IPC, NDI_FRAME_CHANNEL_NAMES } from '@lumacast/protocol';
import { registerIpcHandlers } from './ipc';
import type { CastRepository } from '@lumacast/persistence-sqlite';
import type { NdiServiceLike } from '@lumacast/engine';
import type { AppUpdater } from './app-updater';

const FRAME_CHANNEL_NAME_SET = new Set<string>(NDI_FRAME_CHANNEL_NAMES);

// Every `IPC` key that is not one of the two frame channels: this is the set
// `registerRpcHandlers` is expected to register through `ipcMain.handle`,
// mirroring `RpcChannelName` (`keyof RpcOperations`) in app/main/ipc.ts.
const RPC_CHANNEL_NAMES = (Object.keys(IPC) as (keyof typeof IPC)[]).filter(
  (name) => !FRAME_CHANNEL_NAME_SET.has(name),
);

function fakeEvent(): IpcMainInvokeEvent {
  return {} as IpcMainInvokeEvent;
}

function makeFakeNdiService(): NdiServiceLike {
  return {
    getOutputState: vi.fn(),
    getOutputConfigs: vi.fn(),
    getDiagnostics: vi.fn(),
    setOutputEnabled: vi.fn(),
    updateOutputConfig: vi.fn(),
    receiveFrame: vi.fn(),
    receiveAudioFrame: vi.fn(),
    onOutputStateChanged: vi.fn(() => () => {}),
    onDiagnosticsChanged: vi.fn(() => () => {}),
    flushBlackoutAndDestroy: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('main IPC registration (issue #152)', () => {
  beforeEach(() => {
    handleRegistrations.clear();
    onRegistrations.clear();
    vi.clearAllMocks();

    // A minimal repo stub is enough: every test either checks registration
    // shape without invoking a handler, or invokes a handler whose codec
    // validation throws before any `repo.*` method is reached.
    const repo = {} as unknown as CastRepository;
    const ndiService = makeFakeNdiService();
    const appUpdater = {} as unknown as AppUpdater;

    registerIpcHandlers(repo, ndiService, () => null, appUpdater);
  });

  it('registers a handler for every operation in the canonical map (missing-registration regression)', () => {
    const missing = RPC_CHANNEL_NAMES.filter((name) => !handleRegistrations.has(IPC[name]));
    expect(missing, `missing ipcMain.handle registration for: ${missing.join(', ')}`).toEqual([]);
    // Sanity: this is the full 107-operation surface, not a partial list.
    expect(RPC_CHANNEL_NAMES.length).toBe(107);
  });

  it('registers nothing outside the canonical map (extra-registration regression)', () => {
    // Widened to Set<string> deliberately: the registered channels this is
    // compared against are Map keys typed as plain strings, and the point of
    // the test is to catch a channel *outside* the canonical union.
    const canonicalChannels = new Set<string>(RPC_CHANNEL_NAMES.map((name) => IPC[name]));
    const registeredChannels = [...handleRegistrations.keys()];
    const extra = registeredChannels.filter((channel) => !canonicalChannels.has(channel));

    expect(extra, `unexpected ipcMain.handle registration(s) for: ${extra.join(', ')}`).toEqual([]);
    expect(registeredChannels.length).toBe(canonicalChannels.size);
  });

  it('fails rather than silently succeeding for an unknown/unregistered operation', async () => {
    const bogusChannel = 'cast:totallyMadeUpOperation';
    expect(handleRegistrations.has(bogusChannel)).toBe(false);

    // Mirrors Electron's own ipcMain.handle/invoke contract: calling invoke
    // on a channel with no registered handler rejects instead of resolving
    // silently. There is no real `ipcRenderer.invoke` in this unit test, so
    // this small wrapper models exactly that documented failure mode against
    // the handler map `registerIpcHandlers` actually produced.
    async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = handleRegistrations.get(channel);
      if (!handler) throw new Error(`No handler registered for '${channel}'`);
      return handler(fakeEvent(), ...args);
    }

    await expect(invoke(bogusChannel)).rejects.toThrow(`No handler registered for '${bogusChannel}'`);
  });

  it('registers the two NDI frame channels via ipcMain.on only, never through the RPC handle path', () => {
    for (const frameChannelName of NDI_FRAME_CHANNEL_NAMES) {
      const channel = IPC[frameChannelName];
      expect(onRegistrations.has(channel), `expected ${frameChannelName} to be registered via ipcMain.on`).toBe(true);
      expect(handleRegistrations.has(channel), `${frameChannelName} must not be registered via ipcMain.handle`).toBe(false);
    }
  });

  it('serializes a typed CodecError instead of swallowing it, after malformed input is rejected before repository code', async () => {
    const handler = handleRegistrations.get(IPC.deleteCue);
    expect(handler).toBeDefined();

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // `deleteCue`'s only argument must be a string id. Passing a number is
    // rejected by `expectRpcPrimitiveArgs` before `repo.deleteCue` — which
    // this test's stub repo does not even implement — is ever reached.
    await expect(handler!(fakeEvent(), 123)).rejects.toThrow(/\[rpc\/deleteCue\].*must be a string/);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[IPC ${IPC.deleteCue}]`),
      expect.stringContaining('must be a string'),
    );

    consoleErrorSpy.mockRestore();
  });
});
