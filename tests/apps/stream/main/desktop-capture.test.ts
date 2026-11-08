import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { session, type DesktopCapturerSource } from 'electron';

const electronModule = vi.hoisted(() => ({
  desktopCapturer: { getSources: vi.fn() },
  session: { defaultSession: { setDisplayMediaRequestHandler: vi.fn() } },
}));
vi.mock('electron', () => electronModule);
vi.mock('../../../../apps/stream/node_modules/electron/index.js', () => electronModule);

import { desktopCapturer } from 'electron';
import { DesktopCaptureController } from '../../../../apps/stream/main/desktop-capture';

const originalPlatform = process.platform;

function source(id: string, name: string, overrides: Partial<DesktopCapturerSource> = {}): DesktopCapturerSource {
  return {
    id,
    name,
    thumbnail: { toDataURL: () => 'data:image/png;base64,thumb' } as never,
    display_id: '',
    appIcon: { isEmpty: () => false, toPNG: () => Buffer.from('editor-icon') } as never,
    ...overrides,
  } as DesktopCapturerSource;
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.mocked(desktopCapturer.getSources).mockReset();
  vi.mocked(session.defaultSession.setDisplayMediaRequestHandler).mockReset();
});

describe('DesktopCaptureController source resolution', () => {
  it.each([
    ['window', 'window:42:0', false],
    ['screen', 'screen:1:0', true],
  ] as const)('keeps Windows system loopback scoped to display capture (%s)', async (kind, sourceId, includesAudio) => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const option = source(sourceId, 'Capture target');
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([option]);
    const mainFrame = { url: pathToFileURL(path.resolve(process.cwd(), 'apps/stream/renderer/index.html')).href };
    const window = { webContents: { id: 7, mainFrame } } as never;
    const controller = new DesktopCaptureController(() => window);
    await controller.list(kind);
    await controller.prepare(7, option.id, true);
    controller.register();
    const handler = vi.mocked(session.defaultSession.setDisplayMediaRequestHandler).mock.calls[0]![0];
    const request = { frame: mainFrame, userGesture: true, videoRequested: true, audioRequested: true } as Electron.DisplayMediaRequestHandlerHandlerRequest;
    const granted = await new Promise<Electron.Streams | null>((resolve) => handler!(request, resolve));

    expect(granted?.video).toBe(option);
    expect(granted?.audio).toBe(includesAudio ? 'loopback' : undefined);
  });

  it('returns the display identity and app icon hash needed for safe later matching', async () => {
    const windowSource = source('window:42:0', 'Editor', { display_id: '' });
    const displaySource = source('screen:1:0', 'Display 1', { display_id: 'monitor-primary', appIcon: null as never });
    vi.mocked(desktopCapturer.getSources)
      .mockResolvedValueOnce([windowSource])
      .mockResolvedValueOnce([displaySource]);
    const controller = new DesktopCaptureController(() => null);

    const windows = await controller.list('window');
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['window'], thumbnailSize: { width: 240, height: 135 }, fetchWindowIcons: true,
    });
    expect(windows).toEqual([{
      id: 'window:42:0',
      name: 'Editor',
      kind: 'window',
      thumbnail: 'data:image/png;base64,thumb',
      appIconHash: createHash('sha256').update('editor-icon').digest('hex'),
    }]);

    const displays = await controller.list('screen');
    expect(displays).toEqual([{
      id: 'screen:1:0',
      name: 'Display 1',
      kind: 'screen',
      thumbnail: 'data:image/png;base64,thumb',
      displayId: 'monitor-primary',
    }]);
  });

  it('resolves against a fresh enumeration and authorizes only the fresh ID', async () => {
    const oldSource = source('window:42:0', 'Untitled - Editor');
    const newSource = source('window:42:1', 'Edited - Editor');
    vi.mocked(desktopCapturer.getSources)
      .mockResolvedValueOnce([oldSource])
      .mockResolvedValueOnce([newSource]);
    const controller = new DesktopCaptureController(() => null);
    const oldOption = (await controller.list('window'))[0]!;

    const rebound = await controller.resolve('window', oldOption.id, {
      kind: 'window', name: oldOption.name, appIconHash: oldOption.appIconHash,
    });
    expect(desktopCapturer.getSources).toHaveBeenLastCalledWith({
      types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true,
    });
    expect(rebound).toMatchObject({ id: newSource.id, name: newSource.name, kind: 'window' });

    await controller.prepare(7, newSource.id, false, 'automatic-restore');
    expect(controller.isAutomaticCaptureAuthorized(7)).toBe(true);
    expect(controller.consumeAutomaticCaptureAuthorization(7)).toBe(true);
    expect(controller.consumeAutomaticCaptureAuthorization(7)).toBe(false);
    await expect(controller.prepare(7, oldSource.id, false, 'automatic-restore')).rejects.toThrow(/no longer available/);
  });

  it('refuses ambiguous window matches and invalid target metadata', async () => {
    const first = source('window:42:0', 'Editor', { appIcon: { isEmpty: () => false, toPNG: () => Buffer.from('same-icon') } as never });
    const second = source('window:43:0', 'Editor', { appIcon: { isEmpty: () => false, toPNG: () => Buffer.from('same-icon') } as never });
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([first, second]);
    const controller = new DesktopCaptureController(() => null);
    const appIconHash = createHash('sha256').update('same-icon').digest('hex');

    await expect(controller.resolve('window', undefined, { kind: 'window', name: 'Editor', appIconHash })).resolves.toBeNull();
    await expect(controller.resolve('screen', undefined, { kind: 'window', name: 'Editor' })).rejects.toThrow(/Invalid saved capture target/);
  });

  it('keeps manual display-media authorization separate from one-shot automatic authorization', async () => {
    const option = source('window:42:0', 'Editor');
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([option]);
    const controller = new DesktopCaptureController(() => null);
    await controller.list('window');

    await controller.prepare(7, option.id, true);
    expect(controller.isCaptureAuthorized(7)).toBe(true);
    expect(controller.isAutomaticCaptureAuthorized(7)).toBe(false);
    expect(controller.authorizeEmptyMediaTypesPermissionRequest(8)).toBe(false);
    expect(controller.authorizeEmptyMediaTypesPermissionRequest(7)).toBe(true);
    expect(controller.isCaptureAuthorized(7)).toBe(true);
    expect(controller.consumeAutomaticCaptureAuthorization(7)).toBe(false);

    await controller.prepare(7, option.id, true, 'automatic-restore');
    expect(controller.isCaptureAuthorized(7)).toBe(false);
    expect(controller.isAutomaticCaptureAuthorized(7)).toBe(true);
    expect(controller.authorizeEmptyMediaTypesPermissionRequest(8)).toBe(false);
    expect(controller.authorizeEmptyMediaTypesPermissionRequest(7)).toBe(true);
    expect(controller.consumeAutomaticCaptureAuthorization(8)).toBe(false);
    expect(controller.isAutomaticCaptureAuthorized(7)).toBe(false);
  });

  it('retains the scoped manual preflight token until a user-gesture display request consumes it', async () => {
    const option = source('window:42:0', 'Editor');
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([option]);
    const mainFrame = {
      url: pathToFileURL(path.resolve(process.cwd(), 'apps/stream/renderer/index.html')).href,
    };
    const window = { webContents: { id: 7, mainFrame } } as never;
    const controller = new DesktopCaptureController(() => window);
    await controller.list('window');
    await controller.prepare(7, option.id, false);
    expect(controller.authorizeEmptyMediaTypesPermissionRequest(7)).toBe(true);
    expect(controller.isCaptureAuthorized(7)).toBe(true);

    controller.register();
    const requestHandler = vi.mocked(session.defaultSession.setDisplayMediaRequestHandler).mock.calls[0]?.[0];
    expect(requestHandler).toBeDefined();
    const request = {
      frame: mainFrame,
      userGesture: false,
      videoRequested: true,
      audioRequested: false,
    } as unknown as Electron.DisplayMediaRequestHandlerHandlerRequest;
    const denied = await new Promise<Electron.Streams | null>((resolve) => requestHandler!(request, resolve));
    expect(denied).toEqual({});
    expect(controller.isCaptureAuthorized(7)).toBe(true);

    const granted = await new Promise<Electron.Streams | null>((resolve) => requestHandler!({ ...request, userGesture: true }, resolve));
    expect(granted?.video).toBe(option);
    expect(controller.isCaptureAuthorized(7)).toBe(false);
    expect(desktopCapturer.getSources).toHaveBeenLastCalledWith({
      types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 },
    });
  });
});
