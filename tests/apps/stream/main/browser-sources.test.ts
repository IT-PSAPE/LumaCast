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

describe('LumaStream browser source interaction', () => {
  const createInteractiveWindow = () => {
    let attached = false;
    const debuggerSession = {
      isAttached: vi.fn(() => attached),
      attach: vi.fn(() => { attached = true; }),
      sendCommand: vi.fn(async () => ({})),
    };
    const window = {
      webContents: {
        id: 14,
        setAudioMuted: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        setFrameRate: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        getMediaSourceId: vi.fn(() => 'web-contents-media-stream://browser-source'),
        isDestroyed: vi.fn(() => false),
        debugger: debuggerSession,
        on: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(),
    };
    return { window: window as unknown as BrowserWindow, debuggerSession };
  };

  it('dispatches pointer, keyboard and wheel input through CDP without focusing the hidden window', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const { window, debuggerSession } = createInteractiveWindow();
    const createWindow = vi.fn(() => window);
    const manager = new BrowserSourceManager(() => requester, createWindow);
    const sourceId = '00000000-0000-0000-0000-000000000011';
    await manager.create(sourceId, 'https://example.test/form', 2560, 1440);

    await manager.sendInput(sourceId, { type: 'pointer', action: 'down', x: 0.5, y: 1, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
    await manager.sendInput(sourceId, { type: 'key', action: 'down', key: 'A', code: 'KeyA', text: 'A', modifiers: 8 });
    await manager.sendInput(sourceId, { type: 'wheel', x: 0.25, y: 0.75, deltaX: 0, deltaY: 480, modifiers: 0 });

    expect(debuggerSession.attach).toHaveBeenCalledOnce();
    expect(debuggerSession.sendCommand).toHaveBeenNthCalledWith(1, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: 960, y: 1079, button: 'left', buttons: 1, clickCount: 1, modifiers: 8,
    });
    expect(debuggerSession.sendCommand).toHaveBeenNthCalledWith(2, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'A', code: 'KeyA', text: 'A', modifiers: 8,
    });
    expect(debuggerSession.sendCommand).toHaveBeenNthCalledWith(3, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 480, y: 809, deltaX: 0, deltaY: 480, modifiers: 0,
    });
    expect(window.isDestroyed()).toBe(false);
    expect(createWindow).toHaveBeenCalledOnce();
  });

  it('rejects malformed input before attaching the debugger or dispatching CDP commands', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const { window, debuggerSession } = createInteractiveWindow();
    const manager = new BrowserSourceManager(() => requester, vi.fn(() => window));
    const sourceId = '00000000-0000-0000-0000-000000000012';
    await manager.create(sourceId, 'https://example.test', 1280, 720);

    const malformedInputs: unknown[] = [
      { type: 'pointer', action: 'down', x: -0.1, y: 0.5, button: 'left' },
      { type: 'pointer', action: 'down', x: 0.5, y: 0.5, button: 'back' },
      { type: 'pointer', action: 'hover', x: 0.5, y: 0.5 },
      { type: 'wheel', x: 0.5, y: 0.5, deltaX: Number.NaN, deltaY: 0 },
      { type: 'wheel', x: 0.5, y: 0.5, deltaX: 0, deltaY: 10_001 },
      { type: 'key', action: 'execute', key: 'A', code: 'KeyA' },
      { type: 'key', action: 'down', key: 'A', code: 'KeyA', modifiers: 16 },
      { type: 'key', action: 'down', key: '\n', code: 'Enter' },
      { type: 'key', action: 'down', key: 'A', code: 'KeyA', debug: true },
      { type: 'devtools', method: 'Runtime.evaluate', params: { expression: 'alert(1)' } },
      null,
    ];
    for (const input of malformedInputs) await expect(manager.sendInput(sourceId, input)).rejects.toThrow();

    expect(debuggerSession.attach).not.toHaveBeenCalled();
    expect(debuggerSession.sendCommand).not.toHaveBeenCalled();
  });

  it('resets the authored URL in the existing BrowserWindow session', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const { window } = createInteractiveWindow();
    const createWindow = vi.fn(() => window);
    const manager = new BrowserSourceManager(() => requester, createWindow);
    const sourceId = '00000000-0000-0000-0000-000000000013';
    await manager.create(sourceId, 'https://example.test/original?fixture=1', 1280, 720);

    await manager.reset(sourceId);

    expect(window.loadURL).toHaveBeenCalledTimes(2);
    expect(window.loadURL).toHaveBeenLastCalledWith('https://example.test/original?fixture=1');
    expect(createWindow).toHaveBeenCalledOnce();
  });

  it('throttles inactive sources and resets only on an opt-in Program entry edge', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const { window } = createInteractiveWindow();
    const createWindow = vi.fn(() => window);
    const manager = new BrowserSourceManager(() => requester, createWindow);
    const sourceId = '00000000-0000-0000-0000-000000000016';
    await manager.create(sourceId, 'https://example.test/stateful', 1280, 720);
    const contents = window.webContents as unknown as {
      setBackgroundThrottling: ReturnType<typeof vi.fn>;
      setFrameRate: ReturnType<typeof vi.fn>;
    };

    await manager.setActivity(sourceId, { active: false, programActive: false, resetOnEntry: true });
    expect(contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    expect(contents.setFrameRate).toHaveBeenLastCalledWith(1);
    expect(window.loadURL).toHaveBeenCalledOnce();

    await manager.setActivity(sourceId, { active: true, programActive: true, resetOnEntry: true });
    expect(contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
    expect(contents.setFrameRate).toHaveBeenLastCalledWith(15);
    expect(window.loadURL).toHaveBeenCalledTimes(2);

    await manager.setActivity(sourceId, { active: true, programActive: true, resetOnEntry: true });
    expect(window.loadURL).toHaveBeenCalledTimes(2);
    await manager.setActivity(sourceId, { active: true, programActive: false, resetOnEntry: true });
    await manager.setActivity(sourceId, { active: true, programActive: true, resetOnEntry: true });
    expect(window.loadURL).toHaveBeenCalledTimes(3);
    expect(createWindow).toHaveBeenCalledOnce();
  });

  it('serializes input after Program-entry reset and rejects open-ended activity objects', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const { window, debuggerSession } = createInteractiveWindow();
    let resolveNavigation: (() => void) | undefined;
    const loadURL = vi.fn(() => new Promise<void>((resolve) => { resolveNavigation = resolve; }));
    window.loadURL = loadURL;
    const manager = new BrowserSourceManager(() => requester, vi.fn(() => window));
    const sourceId = '00000000-0000-0000-0000-000000000017';
    const creation = manager.create(sourceId, 'https://example.test/stateful', 1280, 720);
    resolveNavigation?.();
    await creation;

    const enteringProgram = manager.setActivity(sourceId, { active: true, programActive: true, resetOnEntry: true });
    const dispatch = manager.sendInput(sourceId, { type: 'key', action: 'down', key: 'a', code: 'KeyA', text: 'a' });
    await Promise.resolve();
    expect(loadURL).toHaveBeenCalledTimes(2);
    expect(debuggerSession.sendCommand).not.toHaveBeenCalled();
    resolveNavigation?.();
    await Promise.all([enteringProgram, dispatch]);
    expect(debuggerSession.sendCommand).toHaveBeenCalledOnce();

    await expect(manager.setActivity(sourceId, { active: true, programActive: true, resetOnEntry: false, debug: true })).rejects.toThrow('Invalid browser source activity');
  });

  it('rejects input and reset for missing or destroyed sessions', async () => {
    const requester = { id: 7, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
    const { window, debuggerSession } = createInteractiveWindow();
    const manager = new BrowserSourceManager(() => requester, vi.fn(() => window));

    await expect(manager.sendInput('00000000-0000-0000-0000-000000000014', { type: 'key', action: 'down', key: 'a', code: 'KeyA' })).rejects.toThrow('not available');
    await expect(manager.reset('00000000-0000-0000-0000-000000000014')).rejects.toThrow('not available');
    await expect(manager.setActivity('00000000-0000-0000-0000-000000000014', { active: false, programActive: false, resetOnEntry: false })).rejects.toThrow('not available');
    await manager.create('00000000-0000-0000-0000-000000000015', 'https://example.test', 1280, 720);
    window.isDestroyed = vi.fn(() => true);
    await expect(manager.sendInput('00000000-0000-0000-0000-000000000015', { type: 'key', action: 'down', key: 'a', code: 'KeyA' })).rejects.toThrow('not available');
    expect(debuggerSession.sendCommand).not.toHaveBeenCalled();
  });
});
