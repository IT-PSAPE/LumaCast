// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';

import { BrowserSourceManager } from '../../../../apps/stream/main/browser-sources';

describe('LumaStream browser source audio capture', () => {
  const createWindow = () => {
    const window = {
      webContents: {
        id: 13,
        setAudioMuted: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        setFrameRate: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        getMediaSourceId: vi.fn(() => 'web-contents-media-stream://browser-source'),
        isDestroyed: vi.fn(() => false),
        on: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(),
    };
    return window as unknown as BrowserWindow;
  };

  afterEach(() => vi.restoreAllMocks());

  it('mints an audio capture id for the trusted requester and grants only a short permission window', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const window = createWindow();
    const makeWindow = vi.fn(() => window);
    const manager = new BrowserSourceManager(() => requester, makeWindow);
    const sourceId = '00000000-0000-0000-0000-000000000001';
    await manager.create(sourceId, 'https://example.com', 1280, 720);

    expect(makeWindow).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: expect.objectContaining({
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      }),
    }));
    await expect(manager.getAudioCaptureId(sourceId, requester)).resolves.toBe('web-contents-media-stream://browser-source');
    const browserContents = window.webContents as unknown as { getMediaSourceId: ReturnType<typeof vi.fn> };
    expect(browserContents.getMediaSourceId).toHaveBeenCalledWith(requester);
    expect(manager.isAudioCaptureAuthorized(requester.id)).toBe(true);
    expect(manager.isAudioCaptureAuthorized(requester.id + 1)).toBe(false);
  });

  it('accepts large base-canvas sizes while keeping the offscreen viewport at 1080p', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const makeWindow = vi.fn(createWindow);
    const manager = new BrowserSourceManager(() => requester, makeWindow);
    await manager.create('00000000-0000-0000-0000-000000000002', 'https://example.com', 16000, 9000);

    expect(makeWindow).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080 }));
  });

  it('preserves extreme canvas aspect ratios in the capped offscreen viewport', async () => {
    const makeWindow = vi.fn(createWindow);
    const manager = new BrowserSourceManager(() => null, makeWindow);
    await manager.create('00000000-0000-0000-0000-000000000003', 'https://example.com', 16384, 180);

    expect(makeWindow).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 21 }));
  });

  it('rejects capture ids for missing sources', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const manager = new BrowserSourceManager(() => requester, vi.fn(createWindow));
    await expect(manager.getAudioCaptureId('00000000-0000-0000-0000-000000000001', requester)).rejects.toThrow('not available');
    expect(manager.isAudioCaptureAuthorized(requester.id)).toBe(false);
  });
});
