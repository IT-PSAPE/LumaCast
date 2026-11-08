import { BrowserWindow, type BrowserWindowConstructorOptions, type WebContents, type WebFrameMain } from 'electron';
import { IPC_CHANNELS } from './ipc-channels';
import type { BrowserSourceActivity, BrowserSourceInput } from '../shared/desktop-api';

interface BrowserSourceSession {
  id: string;
  url: string;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  active: boolean;
  programActive: boolean;
  resetOnEntry: boolean;
  window: BrowserWindow;
  ready: Promise<void>;
  lastFrameAt: number;
  navigationEpoch: number;
  audioCaptureGrant?: BrowserSourceAudioGrant;
}

interface BrowserSourceAudioGrant {
  requester: WebContents;
  requesterFrame: WebFrameMain;
  requesterUrl: string;
  sourceFrame: WebFrameMain;
  sourceUrl: string;
  sourceEpoch: number;
  origin: string;
  expiresAt: number;
  revoke: () => void;
}

const MAX_POINTER_WHEEL_DELTA = 10_000;
const MAX_KEY_LENGTH = 64;
const MAX_KEY_TEXT_LENGTH = 256;
const INPUT_MODIFIER_MASK = 0b1111;
const AUDIO_CAPTURE_GRANT_MS = 10_000;

function nativeMediaOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    // Native frame.origin serializes file as file://; media securityOrigin
    // serializes it as file:///. Do not collapse opaque origins to URL's "null".
    if (url.protocol === 'file:' && !url.hostname) return 'file://';
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch { return null; }
}

function validateInputModifiers(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0 || ((value as number) & ~INPUT_MODIFIER_MASK) !== 0) {
    throw new Error('Invalid browser source input modifiers.');
  }
  return value as number;
}

function validateNormalizedCoordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Invalid browser source input coordinates.');
  }
  return value;
}

function validateInputDelta(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_POINTER_WHEEL_DELTA) {
    throw new Error('Invalid browser source input delta.');
  }
  return value;
}

function validateInputString(value: unknown, maximumLength: number, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximumLength || (!allowEmpty && value.length === 0)
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid browser source ${label}.`);
  }
  return value;
}

function assertInputProperties(input: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Invalid browser source input.');
}

function validateBrowserSourceInput(rawInput: unknown): BrowserSourceInput {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Invalid browser source input.');
  }
  const input = rawInput as Record<string, unknown>;
  const modifiers = validateInputModifiers(input.modifiers);
  if (input.type === 'pointer') {
    assertInputProperties(input, ['type', 'action', 'x', 'y', 'button', 'buttons', 'clickCount', 'modifiers']);
    if (input.action !== 'move' && input.action !== 'down' && input.action !== 'up') {
      throw new Error('Invalid browser source pointer action.');
    }
    if (input.button !== undefined && input.button !== 'left' && input.button !== 'middle' && input.button !== 'right') {
      throw new Error('Invalid browser source pointer button.');
    }
    if (input.buttons !== undefined && (!Number.isInteger(input.buttons) || (input.buttons as number) < 0 || (input.buttons as number) > 31)) {
      throw new Error('Invalid browser source pointer buttons.');
    }
    if (input.clickCount !== undefined && (!Number.isInteger(input.clickCount) || (input.clickCount as number) < 0 || (input.clickCount as number) > 3)) {
      throw new Error('Invalid browser source pointer click count.');
    }
    return {
      type: 'pointer',
      action: input.action,
      x: validateNormalizedCoordinate(input.x),
      y: validateNormalizedCoordinate(input.y),
      ...(input.button === undefined ? {} : { button: input.button }),
      ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
      ...(input.clickCount === undefined ? {} : { clickCount: input.clickCount }),
      modifiers,
    } as BrowserSourceInput;
  }
  if (input.type === 'wheel') {
    assertInputProperties(input, ['type', 'x', 'y', 'deltaX', 'deltaY', 'modifiers']);
    return {
      type: 'wheel',
      x: validateNormalizedCoordinate(input.x),
      y: validateNormalizedCoordinate(input.y),
      deltaX: validateInputDelta(input.deltaX),
      deltaY: validateInputDelta(input.deltaY),
      modifiers,
    };
  }
  if (input.type === 'key') {
    assertInputProperties(input, ['type', 'action', 'key', 'code', 'text', 'modifiers']);
    if (input.action !== 'down' && input.action !== 'up') throw new Error('Invalid browser source key action.');
    const key = validateInputString(input.key, MAX_KEY_LENGTH, 'key');
    const code = validateInputString(input.code, MAX_KEY_LENGTH, 'key code', true);
    const text = input.text === undefined ? undefined : validateInputString(input.text, MAX_KEY_TEXT_LENGTH, 'key text', true);
    return {
      type: 'key',
      action: input.action,
      key,
      code,
      ...(text === undefined ? {} : { text }),
      modifiers,
    };
  }
  throw new Error('Invalid browser source input type.');
}

function validateBrowserSourceActivity(rawActivity: unknown): BrowserSourceActivity {
  if (!rawActivity || typeof rawActivity !== 'object' || Array.isArray(rawActivity)) {
    throw new Error('Invalid browser source activity.');
  }
  const activity = rawActivity as Record<string, unknown>;
  const activityKeys = Object.keys(activity).sort();
  if (activityKeys.length !== 3 || activityKeys[0] !== 'active' || activityKeys[1] !== 'programActive' || activityKeys[2] !== 'resetOnEntry'
    || typeof activity.active !== 'boolean' || typeof activity.programActive !== 'boolean' || typeof activity.resetOnEntry !== 'boolean') {
    throw new Error('Invalid browser source activity.');
  }
  return {
    active: activity.active,
    programActive: activity.programActive,
    resetOnEntry: activity.resetOnEntry,
  };
}

function validateBrowserSource(id: unknown, rawUrl: unknown, width: unknown, height: unknown): { id: string; url: string; width: number; height: number } {
  if (typeof id !== 'string' || !/^[0-9a-f-]{16,128}$/i.test(id)) throw new Error('Invalid browser source.');
  if (!Number.isInteger(width) || (width as number) < 320 || (width as number) > 16384
    || !Number.isInteger(height) || (height as number) < 180 || (height as number) > 16384) {
    throw new Error('Browser source dimensions are outside the supported range.');
  }
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048 || /[\u0000-\u001f\u007f]/.test(rawUrl)) throw new Error('Enter a valid browser source URL.');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('Enter a valid browser source URL.'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
    throw new Error('Browser sources support HTTP and HTTPS URLs.');
  }
  return { id, url: url.toString(), width: width as number, height: height as number };
}

export class BrowserSourceManager {
  private readonly sources = new Map<string, BrowserSourceSession>();
  private readonly audioCapturePermissionExpiry = new Map<number, number>();

  constructor(
    private readonly getContents: () => WebContents | null,
    private readonly createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow = (options) => new BrowserWindow(options),
  ) {}

  async create(rawId: unknown, rawUrl: unknown, rawWidth: unknown, rawHeight: unknown): Promise<void> {
    const config = validateBrowserSource(rawId, rawUrl, rawWidth, rawHeight);
    const existing = this.sources.get(config.id);
    if (existing && existing.url === config.url && existing.width === config.width && existing.height === config.height) {
      await existing.ready;
      return;
    }
    this.close(config.id);

    const scale = Math.min(1, 1920 / config.width, 1080 / config.height);
    const viewportWidth = Math.max(1, Math.round(config.width * scale));
    const viewportHeight = Math.max(1, Math.round(config.height * scale));
    const window = this.createWindow({
      show: false,
      width: viewportWidth,
      height: viewportHeight,
      useContentSize: true,
      backgroundColor: '#00000000',
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        partition: 'persist:stream-browser-sources',
      },
    });
    // Tab capture is attributed to its target source frame, but retains the
    // native requester origin. Only the minted, one-shot bridge grant may pass.
    // Keep this shared partition policy installed when individual sources close.
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(this.authorizeAudioCapture(contents, permission, details));
    });
    window.webContents.session.setPermissionCheckHandler(() => false);
    const session: BrowserSourceSession = {
      ...config,
      viewportWidth,
      viewportHeight,
      active: true,
      programActive: false,
      resetOnEntry: false,
      window,
      ready: Promise.resolve(),
      lastFrameAt: 0,
      navigationEpoch: 0,
    };
    this.sources.set(config.id, session);
    window.webContents.setAudioMuted(true);
    window.webContents.setBackgroundThrottling(false);
    window.webContents.setFrameRate(15);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('did-start-navigation', (event) => {
      if (!event.isMainFrame) return;
      session.navigationEpoch += 1;
      session.audioCaptureGrant?.revoke();
    });
    window.webContents.on('destroyed', () => session.audioCaptureGrant?.revoke());
    const allowedUrl = (value: string) => {
      try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; }
      catch { return false; }
    };
    window.webContents.on('will-navigate', (event, url) => { if (!allowedUrl(url)) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, url) => { if (!allowedUrl(url)) event.preventDefault(); });
    window.webContents.on('paint', (_event, _dirtyRect, image) => {
      const now = Date.now();
      if (now - session.lastFrameAt < 60 || image.isEmpty() || this.sources.get(config.id) !== session) return;
      session.lastFrameAt = now;
      try {
        const frame = Uint8Array.from(image.toJPEG(72)).buffer;
        const contents = this.getContents();
        if (contents && !contents.isDestroyed()) contents.send(IPC_CHANNELS.browserSourceFrame, config.id, frame);
      } catch { /* A frame may disappear while its offscreen page is closing. */ }
    });
    session.ready = window.loadURL(config.url).then(() => undefined).catch(() => {
      if (this.sources.get(config.id) !== session) return;
      this.close(config.id);
      throw new Error('The browser source could not load.');
    });
    await session.ready;
  }

  async sendInput(rawId: unknown, rawInput: unknown): Promise<void> {
    if (typeof rawId !== 'string' || !/^[0-9a-f-]{16,128}$/i.test(rawId)) throw new Error('Invalid browser source.');
    const source = this.sources.get(rawId);
    if (!source) throw new Error('The browser source is not available.');
    const input = validateBrowserSourceInput(rawInput);
    return this.enqueue(source, async () => {
      const debuggerSession = source.window.webContents.debugger;
      try {
        if (!debuggerSession.isAttached()) debuggerSession.attach('1.3');
      } catch {
        if (!debuggerSession.isAttached()) throw new Error('The browser source could not receive input.');
      }

      if (input.type === 'pointer') {
        await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
          type: input.action === 'down' ? 'mousePressed' : input.action === 'up' ? 'mouseReleased' : 'mouseMoved',
          x: Math.round(input.x * (source.viewportWidth - 1)),
          y: Math.round(input.y * (source.viewportHeight - 1)),
          button: input.action === 'move' ? 'none' : input.button ?? 'left',
          ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
          ...(input.clickCount === undefined ? {} : { clickCount: input.clickCount }),
          modifiers: input.modifiers ?? 0,
        });
        return;
      }
      if (input.type === 'wheel') {
        await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: Math.round(input.x * (source.viewportWidth - 1)),
          y: Math.round(input.y * (source.viewportHeight - 1)),
          deltaX: input.deltaX,
          deltaY: input.deltaY,
          modifiers: input.modifiers ?? 0,
        });
        return;
      }
      await debuggerSession.sendCommand('Input.dispatchKeyEvent', {
        type: input.action === 'down' ? 'keyDown' : 'keyUp',
        key: input.key,
        code: input.code,
      ...(input.action === 'down' && input.text ? { text: input.text } : {}),
        modifiers: input.modifiers ?? 0,
      });
    });
  }

  async reset(rawId: unknown): Promise<void> {
    if (typeof rawId !== 'string' || !/^[0-9a-f-]{16,128}$/i.test(rawId)) throw new Error('Invalid browser source.');
    const source = this.sources.get(rawId);
    if (!source) throw new Error('The browser source is not available.');
    return this.enqueue(source, async () => {
      try {
        await source.window.loadURL(source.url);
      } catch {
        throw new Error('The browser source could not be reset.');
      }
    });
  }

  async setActivity(rawId: unknown, rawActivity: unknown): Promise<void> {
    if (typeof rawId !== 'string' || !/^[0-9a-f-]{16,128}$/i.test(rawId)) throw new Error('Invalid browser source.');
    const source = this.sources.get(rawId);
    if (!source) throw new Error('The browser source is not available.');
    const activity = validateBrowserSourceActivity(rawActivity);
    return this.enqueue(source, async () => {
      const enteringProgram = !source.programActive && activity.programActive;
      const shouldReset = enteringProgram && activity.resetOnEntry;
      source.active = activity.active;
      source.programActive = activity.programActive;
      source.resetOnEntry = activity.resetOnEntry;
      source.window.webContents.setBackgroundThrottling(!source.active);
      source.window.webContents.setFrameRate(source.active ? 15 : 1);
      if (shouldReset) {
        try {
          await source.window.loadURL(source.url);
        } catch {
          throw new Error('The browser source could not be reset.');
        }
      }
    });
  }

  private enqueue(source: BrowserSourceSession, operation: () => Promise<void> | void): Promise<void> {
    const assertAvailable = () => {
      if (this.sources.get(source.id) !== source || source.window.isDestroyed() || source.window.webContents.isDestroyed()) {
        throw new Error('The browser source is not available.');
      }
    };
    const run = () => {
      assertAvailable();
      return operation();
    };
    const result = source.ready.then(run, run);
    source.ready = result.then(() => undefined, () => undefined);
    return result;
  }

  async getAudioCaptureId(rawId: unknown, requester: WebContents): Promise<string> {
    if (typeof rawId !== 'string' || !/^[0-9a-f-]{16,128}$/i.test(rawId)) throw new Error('Invalid browser source.');
    const source = this.sources.get(rawId);
    if (!source || requester !== this.getContents() || requester.isDestroyed()) throw new Error('The browser source is not available.');
    const requesterFrame = requester.mainFrame;
    const requesterUrl = requesterFrame.url;
    const origin = nativeMediaOrigin(requesterFrame.origin);
    const sourceEpoch = source.navigationEpoch;
    let revoked = false;
    let retained = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const revoke = () => {
      revoked = true;
      if (timer !== undefined) clearTimeout(timer);
      requester.removeListener('did-start-navigation', navigated);
      requester.removeListener('destroyed', revoke);
      if (source.audioCaptureGrant?.revoke === revoke) source.audioCaptureGrant = undefined;
    };
    const navigated = (event: { isMainFrame: boolean }) => { if (event.isMainFrame) revoke(); };
    requester.on('did-start-navigation', navigated);
    requester.once('destroyed', revoke);
    try {
      await source.ready;
      if (revoked || this.sources.get(rawId) !== source || source.navigationEpoch !== sourceEpoch
        || source.window.isDestroyed() || source.window.webContents.isDestroyed() || requester.isDestroyed() || requester !== this.getContents()
        || requester.mainFrame !== requesterFrame || requesterFrame.url !== requesterUrl
        || origin === null || nativeMediaOrigin(requesterFrame.origin) !== origin) {
        throw new Error('The browser source is not available.');
      }
      const sourceFrame = source.window.webContents.mainFrame;
      const sourceOrigin = nativeMediaOrigin(sourceFrame.origin);
      // Same-origin development pages cannot prove requester provenance here.
      if (sourceOrigin === null || sourceOrigin === origin) throw new Error('Browser source audio is unavailable for this origin.');
      const captureId = source.window.webContents.getMediaSourceId(requester);
      source.audioCaptureGrant?.revoke();
      const expiresAt = Date.now() + AUDIO_CAPTURE_GRANT_MS;
      source.audioCaptureGrant = { requester, requesterFrame, requesterUrl, sourceFrame, sourceUrl: sourceFrame.url, sourceEpoch, origin, expiresAt, revoke };
      timer = setTimeout(revoke, AUDIO_CAPTURE_GRANT_MS);
      this.audioCapturePermissionExpiry.set(requester.id, expiresAt);
      retained = true;
      return captureId;
    } finally {
      if (!retained) revoke();
    }
  }

  private authorizeAudioCapture(contents: WebContents, permission: string, details: {
    isMainFrame: boolean; requestingUrl: string; mediaTypes?: string[]; securityOrigin?: string;
  }): boolean {
    const source = [...this.sources.values()].find((value) => !value.window.isDestroyed() && value.window.webContents === contents);
    const grant = source?.audioCaptureGrant;
    if (!source || !grant) return false;
    if (grant.expiresAt <= Date.now() || source.window.isDestroyed() || contents.isDestroyed()
      || source.navigationEpoch !== grant.sourceEpoch || contents.mainFrame !== grant.sourceFrame || contents.mainFrame.url !== grant.sourceUrl
      || grant.requester !== this.getContents() || grant.requester.isDestroyed()
      || grant.requester.mainFrame !== grant.requesterFrame || grant.requesterFrame.url !== grant.requesterUrl
      || nativeMediaOrigin(grant.requesterFrame.origin) !== grant.origin) {
      grant.revoke();
      return false;
    }
    const sourceOrigin = nativeMediaOrigin(contents.mainFrame.origin);
    if (permission !== 'media' || !details.isMainFrame || details.requestingUrl !== grant.sourceUrl
      || !Array.isArray(details.mediaTypes) || details.mediaTypes.length !== 0
      || nativeMediaOrigin(details.securityOrigin) !== grant.origin
      || sourceOrigin === null || sourceOrigin === grant.origin) return false;
    grant.revoke();
    return true;
  }

  isAudioCaptureAuthorized(webContentsId: number): boolean {
    const expiresAt = this.audioCapturePermissionExpiry.get(webContentsId);
    if (expiresAt === undefined) return false;
    if (expiresAt < Date.now()) {
      this.audioCapturePermissionExpiry.delete(webContentsId);
      return false;
    }
    return true;
  }

  close(id: string): void {
    const session = this.sources.get(id);
    if (!session) return;
    session.audioCaptureGrant?.revoke();
    this.sources.delete(id);
    if (!session.window.isDestroyed()) session.window.destroy();
  }

  closeAll(): void {
    for (const id of [...this.sources.keys()]) this.close(id);
    this.audioCapturePermissionExpiry.clear();
  }
}
