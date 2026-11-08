// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserWindow, MediaAccessPermissionRequest, Session, WebContents } from 'electron';

import { BrowserSourceManager } from '../../../../apps/stream/main/browser-sources';

function permissionSession() {
  return {
    setPermissionRequestHandler: vi.fn<Session['setPermissionRequestHandler']>(),
    setPermissionCheckHandler: vi.fn<Session['setPermissionCheckHandler']>(),
  };
}

function createRequester(origin = 'file://', url = 'file:///app/renderer/index.html') {
  return Object.assign(new EventEmitter(), {
    id: 7, isDestroyed: vi.fn(() => false), mainFrame: { origin, url },
  }) as unknown as WebContents;
}

function requestPermission(window: BrowserWindow, details: Partial<MediaAccessPermissionRequest> = {}, permission: 'media' | 'notifications' = 'media') {
  const permissions = window.webContents.session as unknown as ReturnType<typeof permissionSession>;
  const request = permissions.setPermissionRequestHandler.mock.calls.at(-1)![0]!;
  const callback = vi.fn();
  request(window.webContents, permission, callback, {
    isMainFrame: true, requestingUrl: window.webContents.mainFrame.url,
    mediaTypes: [], securityOrigin: 'file:///', ...details,
  });
  expect(callback).toHaveBeenCalledOnce();
  return callback.mock.calls[0][0];
}

describe('LumaStream browser source audio capture', () => {
  const createWindow = () => {
    const contents = Object.assign(new EventEmitter(), {
      id: 13, session: permissionSession(), mainFrame: { url: '', origin: 'null' },
      setAudioMuted: vi.fn(), setBackgroundThrottling: vi.fn(), setFrameRate: vi.fn(),
      setWindowOpenHandler: vi.fn(), getMediaSourceId: vi.fn(() => 'web-contents-media-stream://browser-source'),
      isDestroyed: vi.fn(() => false),
    });
    const window = {
      webContents: contents,
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async (url: string) => {
        contents.emit('did-start-navigation', { isMainFrame: true });
        contents.mainFrame.url = url;
        contents.mainFrame.origin = new URL(url).origin;
      }),
      destroy: vi.fn(),
    };
    return window as unknown as BrowserWindow;
  };

  const managers: BrowserSourceManager[] = [];
  const createManager = (getContents: () => WebContents | null, makeWindow: () => BrowserWindow) => {
    const manager = new BrowserSourceManager(getContents, makeWindow);
    managers.push(manager);
    return manager;
  };
  afterEach(() => {
    for (const manager of managers.splice(0)) manager.closeAll();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mints an audio capture id for the trusted requester and grants only a short permission window', async () => {
    const requester = createRequester();
    const window = createWindow();
    const makeWindow = vi.fn(() => window);
    const manager = createManager(() => requester, makeWindow);
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
        partition: 'persist:stream-browser-sources',
      }),
    }));
    await expect(manager.getAudioCaptureId(sourceId, requester)).resolves.toBe('web-contents-media-stream://browser-source');
    const browserContents = window.webContents as unknown as { getMediaSourceId: ReturnType<typeof vi.fn> };
    expect(browserContents.getMediaSourceId).toHaveBeenCalledWith(requester);
    expect(manager.isAudioCaptureAuthorized(requester.id)).toBe(true);
    expect(manager.isAudioCaptureAuthorized(requester.id + 1)).toBe(false);
  });

  it('denies remote-page permissions before navigation, including child and worker checks', async () => {
    const window = createWindow();
    const permissions = window.webContents.session as unknown as ReturnType<typeof permissionSession>;
    const manager = new BrowserSourceManager(() => null, () => window);
    await manager.create('00000000-0000-0000-0000-000000000004', 'https://example.test', 1280, 720);
    expect(permissions.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(permissions.setPermissionCheckHandler).toHaveBeenCalledOnce();
    const firstNavigation = vi.mocked(window.loadURL).mock.invocationCallOrder[0];
    expect(permissions.setPermissionRequestHandler.mock.invocationCallOrder[0]).toBeLessThan(firstNavigation);
    expect(permissions.setPermissionCheckHandler.mock.invocationCallOrder[0]).toBeLessThan(firstNavigation);
    const request = permissions.setPermissionRequestHandler.mock.calls[0][0]!;
    const check = permissions.setPermissionCheckHandler.mock.calls[0][0]!;
    const names = ['media', 'display-capture', 'notifications', 'geolocation', 'clipboard-read', 'speaker-selection', 'local-network', 'unknown'] as const;
    for (const permission of names) {
      for (const isMainFrame of [true, false]) {
        const details = { isMainFrame, requestingUrl: 'https://example.test/frame' };
        const callback = vi.fn();
        request(window.webContents, permission, callback, details);
        expect(callback).toHaveBeenCalledExactlyOnceWith(false);
        expect(check(window.webContents, permission, 'https://example.test', details)).toBe(false);
      }
      expect(check(null, permission, '', { isMainFrame: false })).toBe(false);
    }
  });

  it('keeps the shared session policy through reuse, resets and source teardown', async () => {
    const window = createWindow();
    const permissions = window.webContents.session as unknown as ReturnType<typeof permissionSession>;
    const makeWindow = vi.fn(() => window);
    const manager = new BrowserSourceManager(() => null, makeWindow);
    const id = '00000000-0000-0000-0000-000000000005';
    await manager.create(id, 'https://example.test', 1280, 720);
    await manager.create(id, 'https://example.test', 1280, 720);
    await manager.reset(id);
    manager.close(id);
    manager.closeAll();

    expect(makeWindow).toHaveBeenCalledOnce();
    expect(window.loadURL).toHaveBeenCalledTimes(2);
    expect(permissions.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(permissions.setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(permissions.setPermissionRequestHandler).not.toHaveBeenCalledWith(null);
    expect(permissions.setPermissionCheckHandler).not.toHaveBeenCalledWith(null);
  });

  it.each([
    ['file://', 'file:///app/renderer/index.html', 'file:///'],
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173/index.html', 'http://127.0.0.1:5173/'],
  ])('allows one native tab request from the current %s requester while checks remain denied', async (origin, url, securityOrigin) => {
    const requester = createRequester(origin, url);
    const window = createWindow();
    const manager = createManager(() => requester, () => window);
    const id = '00000000-0000-0000-0000-000000000006';
    await manager.create(id, 'https://example.com', 1280, 720);
    expect(requestPermission(window, { securityOrigin })).toBe(false);
    await manager.getAudioCaptureId(id, requester);
    expect(requester.listenerCount('did-start-navigation')).toBe(1);
    const permissions = window.webContents.session as unknown as ReturnType<typeof permissionSession>;
    const check = permissions.setPermissionCheckHandler.mock.calls[0][0]!;
    expect(check(window.webContents, 'media', origin, { mediaType: 'audio', isMainFrame: true })).toBe(false);
    expect(check(null, 'notifications', origin, { isMainFrame: false })).toBe(false);
    expect(requestPermission(window, { securityOrigin })).toBe(true);
    expect(requestPermission(window, { securityOrigin })).toBe(false);
    expect(requester.listenerCount('did-start-navigation')).toBe(0);
    expect(requester.listenerCount('destroyed')).toBe(0);
  });

  it('denies physical, source-origin, child, missing and opaque requests without consuming the trusted grant', async () => {
    const requester = createRequester();
    const window = createWindow();
    const manager = createManager(() => requester, () => window);
    const id = '00000000-0000-0000-0000-000000000007';
    await manager.create(id, 'https://example.com', 1280, 720);
    await manager.getAudioCaptureId(id, requester);
    const rejected: Partial<MediaAccessPermissionRequest>[] = [
      { mediaTypes: undefined }, { mediaTypes: ['audio'] }, { mediaTypes: ['video'] }, { mediaTypes: ['audio', 'video'] },
      { securityOrigin: 'https://example.com' }, { securityOrigin: undefined }, { securityOrigin: 'null' },
      { securityOrigin: 'file:///other' }, { securityOrigin: 'file://other/' }, { securityOrigin: 'data:text/plain,test' },
      { securityOrigin: 'http://user:pass@example.com' }, { isMainFrame: false }, { requestingUrl: 'https://example.com/old' },
    ];
    for (const details of rejected) expect(requestPermission(window, details)).toBe(false);
    expect(requestPermission(window, {}, 'notifications')).toBe(false);
    expect(requestPermission(window)).toBe(true);
  });

  it.each(['expiry', 'source navigation', 'requester navigation', 'requester replacement', 'source close', 'source replacement', 'requester frame replacement', 'source frame replacement'] as const)(
    'revokes the pending tab grant on %s and cleans requester listeners', async (reason) => {
      vi.useFakeTimers();
      const requester = createRequester();
      let current: WebContents | null = requester;
      const window = createWindow();
      const replacement = createWindow();
      const makeWindow = vi.fn().mockReturnValueOnce(window).mockReturnValue(replacement);
      const manager = createManager(() => current, makeWindow);
      const id = '00000000-0000-0000-0000-000000000008';
      await manager.create(id, 'https://example.com', 1280, 720);
      await manager.getAudioCaptureId(id, requester);
      if (reason === 'expiry') await vi.advanceTimersByTimeAsync(10_000);
      else if (reason === 'source navigation') window.webContents.emit('did-start-navigation', { isMainFrame: true });
      else if (reason === 'requester navigation') requester.emit('did-start-navigation', { isMainFrame: true });
      else if (reason === 'requester replacement') current = createRequester();
      else if (reason === 'source close') manager.close(id);
      else if (reason === 'source replacement') await manager.create(id, 'https://example.com/new', 1280, 720);
      else if (reason === 'requester frame replacement') Object.defineProperty(requester, 'mainFrame', { value: { ...requester.mainFrame } });
      else Object.defineProperty(window.webContents, 'mainFrame', { value: { ...window.webContents.mainFrame } });
      expect(requestPermission(window)).toBe(false);
      expect(requester.listenerCount('did-start-navigation')).toBe(0);
      expect(requester.listenerCount('destroyed')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not let subframe navigation cancel the trusted main-frame grant', async () => {
    const requester = createRequester();
    const window = createWindow();
    const manager = createManager(() => requester, () => window);
    const id = '00000000-0000-0000-0000-000000000009';
    await manager.create(id, 'https://example.com', 1280, 720);
    await manager.getAudioCaptureId(id, requester);
    requester.emit('did-start-navigation', { isMainFrame: false });
    window.webContents.emit('did-start-navigation', { isMainFrame: false });
    expect(requestPermission(window)).toBe(true);
  });

  it.each(['requester navigation', 'requester replacement', 'source replacement'] as const)('rechecks ownership after waiting for a source on %s', async (change) => {
    const requester = createRequester();
    let current: WebContents = requester;
    const window = createWindow();
    let finishLoading!: () => void;
    vi.mocked(window.loadURL).mockReturnValueOnce(new Promise<void>((resolve) => { finishLoading = resolve; }));
    const makeWindow = vi.fn().mockReturnValueOnce(window).mockReturnValue(createWindow());
    const manager = createManager(() => current, makeWindow);
    const id = '00000000-0000-0000-0000-000000000010';
    const creating = manager.create(id, 'https://example.com', 1280, 720);
    const capture = manager.getAudioCaptureId(id, requester).catch((error: Error) => error);
    if (change === 'requester navigation') requester.emit('did-start-navigation', { isMainFrame: true });
    else if (change === 'requester replacement') current = createRequester();
    else await manager.create(id, 'https://example.com/new', 1280, 720);
    finishLoading();
    await creating;
    expect(await capture).toBeInstanceOf(Error);
    expect(window.webContents.getMediaSourceId).not.toHaveBeenCalled();
    expect(requester.listenerCount('did-start-navigation')).toBe(0);
  });

  it.each([
    ['https://example.com', 'https://example.com/app'],
    ['null', 'data:text/html,opaque'],
  ])('refuses audio minting for a same or opaque requester origin %s', async (origin, url) => {
    const requester = createRequester(origin, url);
    const window = createWindow();
    const manager = createManager(() => requester, () => window);
    const id = '00000000-0000-0000-0000-000000000020';
    await manager.create(id, 'https://example.com', 1280, 720);
    await expect(manager.getAudioCaptureId(id, requester)).rejects.toThrow();
    expect(window.webContents.getMediaSourceId).not.toHaveBeenCalled();
    expect(requestPermission(window, { securityOrigin: origin })).toBe(false);
    expect(requester.listenerCount('did-start-navigation')).toBe(0);
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
        session: permissionSession(),
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
