import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

const { handleRegistrations, nativeImageApi, parseFile } = vi.hoisted(() => ({
  handleRegistrations: new Map<string, InvokeHandler>(),
  nativeImageApi: {
    createFromBuffer: vi.fn(),
  },
  parseFile: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: InvokeHandler) => {
      handleRegistrations.set(channel, handler);
    }),
    on: vi.fn(),
  },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  Menu: {
    buildFromTemplate: vi.fn(() => []),
    setApplicationMenu: vi.fn(),
    getApplicationMenu: vi.fn(() => null),
  },
  app: { isPackaged: false, getPath: () => '/tmp' },
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  nativeImage: nativeImageApi,
}));

vi.mock('music-metadata', () => ({
  parseFile,
}));

vi.mock('./security', () => ({
  assertTrustedIpcSender: vi.fn(),
}));

vi.mock('./media-capability', () => ({
  maskManagedMediaResult: vi.fn((value: unknown) => value),
  resolveManagedMedia: vi.fn((src: string, use: string) => (
    src === 'managed://audio-1' && use === 'audio'
      ? { ok: true, filePath: '/tmp/audio-1.mp3' }
      : { ok: false }
  )),
  resolveManagedMediaArgs: vi.fn((args: unknown[]) => args),
  revokeAllManagedMedia: vi.fn(),
}));

import { IPC } from '@lumacast/protocol';
import { registerIpcHandlers } from './ipc';
import type { PersistenceServiceLike } from './persistence/persistence-service-proxy';
import type { NdiServiceLike } from '@lumacast/engine';
import type { AppUpdater } from './app-updater';

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
    onFrameReleased: vi.fn(() => () => {}),
    flushBlackoutAndDestroy: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('getAudioCoverArt IPC handler', () => {
  beforeEach(() => {
    handleRegistrations.clear();
    vi.clearAllMocks();

    registerIpcHandlers(
      {} as unknown as PersistenceServiceLike,
      makeFakeNdiService(),
      () => null,
      {} as unknown as AppUpdater,
    );
  });

  it('downscales embedded art before returning it to the renderer', async () => {
    const png = Buffer.alloc(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(360, 20);
    const resize = vi.fn(() => ({
      toPNG: vi.fn(() => Buffer.from('scaled')),
    }));

    nativeImageApi.createFromBuffer.mockReturnValue({ isEmpty: () => false, resize });
    parseFile.mockResolvedValue({
      common: {
        picture: [{ data: png }],
      },
    });

    const handler = handleRegistrations.get(IPC.getAudioCoverArt);
    const result = await handler?.(fakeEvent(), 'managed://audio-1');

    expect(parseFile).toHaveBeenCalledWith('/tmp/audio-1.mp3');
    expect(nativeImageApi.createFromBuffer).toHaveBeenCalledWith(png);
    expect(resize).toHaveBeenCalledWith({ width: 64, height: 36, quality: 'good' });
    expect(result).toBe(`data:image/png;base64,${Buffer.from('scaled').toString('base64')}`);
  });

  it('returns null when a track has no embedded artwork', async () => {
    parseFile.mockResolvedValue({ common: { picture: [] } });

    const handler = handleRegistrations.get(IPC.getAudioCoverArt);
    const result = await handler?.(fakeEvent(), 'managed://audio-1');

    expect(result).toBeNull();
    expect(nativeImageApi.createFromBuffer).not.toHaveBeenCalled();
  });

  it('rejects malformed embedded artwork before native decode', async () => {
    parseFile.mockResolvedValue({
      common: {
        picture: [{ data: Buffer.from([0x00, 0x01, 0x02, 0x03]) }],
      },
    });

    const handler = handleRegistrations.get(IPC.getAudioCoverArt);
    const result = await handler?.(fakeEvent(), 'managed://audio-1');

    expect(result).toBeNull();
    expect(nativeImageApi.createFromBuffer).not.toHaveBeenCalled();
  });

  it('rejects oversized embedded artwork dimensions before native decode', async () => {
    const png = Buffer.alloc(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.writeUInt32BE(20_000, 16);
    png.writeUInt32BE(20_000, 20);
    parseFile.mockResolvedValue({
      common: {
        picture: [{ data: png }],
      },
    });

    const handler = handleRegistrations.get(IPC.getAudioCoverArt);
    const result = await handler?.(fakeEvent(), 'managed://audio-1');

    expect(result).toBeNull();
    expect(nativeImageApi.createFromBuffer).not.toHaveBeenCalled();
  });

  it('fits narrow/tall artwork within 64x64 without upscaling the long edge', async () => {
    const png = Buffer.alloc(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.writeUInt32BE(1, 16);
    png.writeUInt32BE(8192, 20);
    const resize = vi.fn(() => ({
      toPNG: vi.fn(() => Buffer.from('tall')),
    }));

    nativeImageApi.createFromBuffer.mockReturnValue({ isEmpty: () => false, resize });
    parseFile.mockResolvedValue({
      common: {
        picture: [{ data: png }],
      },
    });

    const handler = handleRegistrations.get(IPC.getAudioCoverArt);
    const result = await handler?.(fakeEvent(), 'managed://audio-1');

    expect(result).toBe(`data:image/png;base64,${Buffer.from('tall').toString('base64')}`);
    expect(resize).toHaveBeenCalledWith({ width: 1, height: 64, quality: 'good' });
  });
});
