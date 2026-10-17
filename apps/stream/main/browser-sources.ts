import { BrowserWindow, type BrowserWindowConstructorOptions, type WebContents } from 'electron';
import { IPC_CHANNELS } from './ipc-channels';

interface BrowserSourceSession {
  url: string;
  width: number;
  height: number;
  window: BrowserWindow;
  ready: Promise<void>;
  lastFrameAt: number;
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
    const session: BrowserSourceSession = { ...config, window, ready: Promise.resolve(), lastFrameAt: 0 };
    this.sources.set(config.id, session);
    window.webContents.setAudioMuted(true);
    window.webContents.setBackgroundThrottling(false);
    window.webContents.setFrameRate(15);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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

  async getAudioCaptureId(rawId: unknown, requester: WebContents): Promise<string> {
    if (typeof rawId !== 'string' || !/^[0-9a-f-]{16,128}$/i.test(rawId)) throw new Error('Invalid browser source.');
    const source = this.sources.get(rawId);
    if (!source) throw new Error('The browser source is not available.');
    await source.ready;
    if (source.window.isDestroyed() || requester.isDestroyed()) throw new Error('The browser source is not available.');
    const captureId = source.window.webContents.getMediaSourceId(requester);
    this.audioCapturePermissionExpiry.set(requester.id, Date.now() + 10_000);
    return captureId;
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
    this.sources.delete(id);
    if (!session.window.isDestroyed()) session.window.destroy();
  }

  closeAll(): void {
    for (const id of [...this.sources.keys()]) this.close(id);
    this.audioCapturePermissionExpiry.clear();
  }
}
