import { desktopCapturer, session, type BrowserWindow, type DesktopCapturerSource } from 'electron';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { CaptureKind, DesktopCaptureTarget, DesktopSourceOption } from '../shared/desktop-api';
import { isValidDesktopCaptureTarget, resolveDesktopCaptureOption } from '../shared/capture-target';
import { isTrustedRendererUrl, resolveDevServerOrigin } from './navigation-policy';

export type DesktopCapturePrepareMode = 'display-media' | 'automatic-restore';

interface PendingCapture {
  sourceId: string;
  includeSystemAudio: boolean;
  webContentsId: number;
  expiresAt: number;
  mode: DesktopCapturePrepareMode;
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
    return this.querySources(kind, { width: 240, height: 135 }, true);
  }

  async resolve(
    kind: CaptureKind,
    captureId?: string,
    target?: DesktopCaptureTarget,
    legacySourceName?: string,
  ): Promise<DesktopSourceOption | null> {
    if (kind !== 'screen' && kind !== 'window') throw new Error('Unsupported capture source type.');
    if (captureId !== undefined && (typeof captureId !== 'string' || captureId.length > 512)) throw new Error('Invalid saved capture ID.');
    if (target !== undefined && (!isValidDesktopCaptureTarget(target) || target.kind !== kind)) throw new Error('Invalid saved capture target.');
    if (legacySourceName !== undefined && (typeof legacySourceName !== 'string' || legacySourceName.length > 120)) throw new Error('Invalid saved capture source name.');
    const options = await this.querySources(kind, { width: 0, height: 0 }, false);
    return resolveDesktopCaptureOption(options, kind, captureId, target, legacySourceName);
  }

  async prepare(
    webContentsId: number,
    sourceId: string,
    includeSystemAudio: boolean,
    mode: DesktopCapturePrepareMode = 'display-media',
  ): Promise<void> {
    if (typeof sourceId !== 'string' || sourceId.length > 512 || typeof includeSystemAudio !== 'boolean'
      || (mode !== 'display-media' && mode !== 'automatic-restore')) throw new Error('Invalid capture request.');
    const listed = this.listedSources.get(sourceId);
    if (!listed || Date.now() - listed.listedAt > 30_000) throw new Error('The selected capture source is no longer available.');
    // Window-only audio is unavailable; a window request must never become a
    // system loopback capture, including requests from legacy picker state.
    const capture = { sourceId, includeSystemAudio: includeSystemAudio && listed.kind === 'screen', webContentsId, expiresAt: Date.now() + 15_000, mode };
    if (this.pendingWaiter) {
      const resolve = this.pendingWaiter;
      this.pendingWaiter = null;
      resolve(capture);
    } else {
      this.pending = capture;
    }
  }

  isCaptureAuthorized(webContentsId: number): boolean {
    return this.pending?.mode === 'display-media'
      && this.pending.webContentsId === webContentsId && this.pending.expiresAt >= Date.now();
  }

  isAutomaticCaptureAuthorized(webContentsId: number): boolean {
    return this.pending?.mode === 'automatic-restore'
      && this.pending.webContentsId === webContentsId && this.pending.expiresAt >= Date.now();
  }

  authorizeEmptyMediaTypesPermissionRequest(webContentsId: number): boolean {
    return this.isCaptureAuthorized(webContentsId) || this.consumeAutomaticCaptureAuthorization(webContentsId);
  }

  consumeAutomaticCaptureAuthorization(webContentsId: number): boolean {
    if (!this.isAutomaticCaptureAuthorized(webContentsId)) return false;
    this.pending = null;
    return true;
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
    if (!pending || pending.mode !== 'display-media' || pending.webContentsId !== window!.webContents.id || pending.expiresAt < Date.now()) {
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

  private async querySources(
    kind: CaptureKind,
    thumbnailSize: Electron.Size,
    includeThumbnails: boolean,
  ): Promise<DesktopSourceOption[]> {
    const sources = await desktopCapturer.getSources({ types: [kind], thumbnailSize, fetchWindowIcons: true });
    const listedAt = Date.now();
    for (const [id, entry] of this.listedSources) {
      if (entry.kind === kind || listedAt - entry.listedAt > 30_000) this.listedSources.delete(id);
    }
    for (const source of sources) this.listedSources.set(source.id, { kind, listedAt });
    return sources.map((source) => {
      const iconHash = appIconHash(source);
      return {
        id: source.id,
        name: source.name || (kind === 'screen' ? 'Display' : 'Window'),
        kind,
        thumbnail: includeThumbnails ? source.thumbnail.toDataURL() : '',
        ...(source.display_id ? { displayId: source.display_id } : {}),
        ...(iconHash ? { appIconHash: iconHash } : {}),
      };
    });
  }
}

function appIconHash(source: DesktopCapturerSource): string | undefined {
  const icon = source.appIcon;
  if (!icon || icon.isEmpty()) return undefined;
  return createHash('sha256').update(icon.toPNG()).digest('hex');
}
