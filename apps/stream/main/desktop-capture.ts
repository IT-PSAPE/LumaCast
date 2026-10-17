import { desktopCapturer, session, type BrowserWindow, type DesktopCapturerSource } from 'electron';
import path from 'node:path';
import type { CaptureKind, DesktopSourceOption } from '../shared/desktop-api';
import { isTrustedRendererUrl, resolveDevServerOrigin } from './navigation-policy';

interface PendingCapture {
  sourceId: string;
  includeSystemAudio: boolean;
  webContentsId: number;
  expiresAt: number;
}

export class DesktopCaptureController {
  private pending: PendingCapture | null = null;
  private pendingWaiter: ((capture: PendingCapture | null) => void) | null = null;
  private readonly listedSources = new Map<string, { kind: CaptureKind; listedAt: number }>();
  private readonly rendererFile: string;
  private readonly devServerOrigin: string | null;

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    this.rendererFile = path.resolve(__dirname, '../renderer/index.html');
    this.devServerOrigin = resolveDevServerOrigin(process.env.ELECTRON_RENDERER_URL);
  }

  async list(kind: CaptureKind): Promise<DesktopSourceOption[]> {
    const sources = await desktopCapturer.getSources({ types: [kind], thumbnailSize: { width: 240, height: 135 }, fetchWindowIcons: true });
    for (const [id, entry] of this.listedSources) if (Date.now() - entry.listedAt > 30_000) this.listedSources.delete(id);
    for (const source of sources) this.listedSources.set(source.id, { kind, listedAt: Date.now() });
    return sources.map((source) => ({
      id: source.id,
      name: source.name || (kind === 'screen' ? 'Display' : 'Window'),
      kind,
      thumbnail: source.thumbnail.toDataURL(),
    }));
  }

  async prepare(webContentsId: number, sourceId: string, includeSystemAudio: boolean): Promise<void> {
    if (typeof sourceId !== 'string' || sourceId.length > 512 || typeof includeSystemAudio !== 'boolean') throw new Error('Invalid capture request.');
    const listed = this.listedSources.get(sourceId);
    if (!listed || Date.now() - listed.listedAt > 30_000) throw new Error('The selected capture source is no longer available.');
    const capture = { sourceId, includeSystemAudio, webContentsId, expiresAt: Date.now() + 15_000 };
    if (this.pendingWaiter) {
      const resolve = this.pendingWaiter;
      this.pendingWaiter = null;
      resolve(capture);
    } else {
      this.pending = capture;
    }
  }

  isCaptureAuthorized(webContentsId: number): boolean {
    return this.pending?.webContentsId === webContentsId && this.pending.expiresAt >= Date.now();
  }

  register(): void {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      void this.grant(request, callback).catch((error) => {
        console.warn('[capture] could not grant desktop capture', error);
        callback({});
      });
    });
  }

  private async grant(
    request: Electron.DisplayMediaRequestHandlerHandlerRequest,
    callback: (streams: Electron.Streams) => void,
  ): Promise<void> {
    const window = this.getWindow();
    const frame = request.frame;
    const trusted = Boolean(window && frame && frame === window.webContents.mainFrame
      && isTrustedRendererUrl(frame.url, { packagedRendererFile: this.rendererFile, devServerOrigin: this.devServerOrigin }));
    if (!trusted || !request.userGesture || !request.videoRequested) {
      callback({});
      return;
    }

    const pending = await this.takePending(window!.webContents.id);
    if (!pending || pending.webContentsId !== window!.webContents.id || pending.expiresAt < Date.now()) {
      callback({});
      return;
    }

    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    const source: DesktopCapturerSource | undefined = sources.find((item) => item.id === pending.sourceId);
    if (!source) {
      callback({});
      return;
    }
    callback({
      video: source,
      ...(process.platform === 'win32' && request.audioRequested && pending.includeSystemAudio ? { audio: 'loopback' as const } : {}),
    });
  }

  private takePending(webContentsId: number): Promise<PendingCapture | null> {
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      return Promise.resolve(pending);
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pendingWaiter !== settle) return;
        this.pendingWaiter = null;
        resolve(null);
      }, 5_000);
      const settle = (capture: PendingCapture | null) => {
        clearTimeout(timeout);
        resolve(capture?.webContentsId === webContentsId ? capture : null);
      };
      this.pendingWaiter = settle;
    });
  }
}
