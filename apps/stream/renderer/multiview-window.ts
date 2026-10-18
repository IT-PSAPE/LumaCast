import { PROJECTOR_WINDOW_NAMES } from '../shared/projector';
import { computeMultiviewLayout, hitTestMultiview, type MultiviewTile } from './multiview-layout';

export interface MultiviewScene {
  id: string;
  name: string;
  isPreview: boolean;
  isProgram: boolean;
}

export interface MultiviewWindowSource {
  getCanvas(kind: 'preview' | 'program' | 'scene', sceneId?: string): HTMLCanvasElement | null;
  scenes(): MultiviewScene[];
}

export interface MultiviewWindowHandlers {
  onSelectScene(sceneId: string): void;
  onTransitionToScene(sceneId: string): void;
  onClosed(): void;
}

export interface MultiviewWindowOptions {
  width?: number;
  height?: number;
  frameRate?: number;
  /** Scene-tile grid tier (see multiview-layout.ts); defaults to the smallest (8). */
  maxScenes?: 8 | 18 | 24;
}

export interface MultiviewWindowControl {
  close(): void;
  isOpen(): boolean;
}

/** Smallest multiview grid tier that fits every scene, so a small project renders larger thumbnails instead of always reserving a 24-tile grid. */
export function multiviewTileCapacityFor(sceneCount: number): 8 | 18 | 24 {
  if (sceneCount <= 8) return 8;
  if (sceneCount <= 18) return 18;
  return 24;
}

const PREVIEW_BORDER = '#78adfb';
const PROGRAM_BORDER = '#f06467';
const NEUTRAL_BORDER = '#3a4049';
const PLACEHOLDER_FILL = '#1b1d22';
const WATCH_INTERVAL_MS = 500;

export function openMultiviewWindow(
  source: MultiviewWindowSource,
  handlers: MultiviewWindowHandlers,
  options?: MultiviewWindowOptions,
): MultiviewWindowControl {
  const width = options?.width ?? 1280;
  const height = options?.height ?? 720;
  const frameRate = options?.frameRate ?? 30;
  const maxScenes = options?.maxScenes ?? 8;

  const openedPopup = window.open('about:blank', PROJECTOR_WINDOW_NAMES.multiview, 'popup,width=1280,height=720');
  if (!openedPopup) throw new Error('The multiview window could not be opened.');
  // Re-bound to a non-nullable const: `function`-declared helpers below are
  // hoisted, so TypeScript cannot carry the null-check narrowing above into
  // their bodies even though `popup` itself never changes.
  const popup: Window = openedPopup;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  let closed = false;
  let animationFrameId: number | null = null;
  let watcherId: number | null = null;
  let stream: MediaStream | null = null;
  let latestTiles: MultiviewTile[] = [];

  function stopFeed(): void {
    if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    if (watcherId !== null) window.clearInterval(watcherId);
    animationFrameId = null;
    watcherId = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  }

  function finishClose(notify: boolean): void {
    if (closed) return;
    closed = true;
    stopFeed();
    if (!popup.closed) {
      try { popup.close(); } catch { /* The popup may have closed between the check and close. */ }
    }
    if (notify) handlers.onClosed();
  }

  function mapClientPointToCanvas(video: HTMLVideoElement, clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = video.getBoundingClientRect();
    const videoWidth = video.videoWidth || canvas.width;
    const videoHeight = video.videoHeight || canvas.height;
    if (!rect.width || !rect.height || !videoWidth || !videoHeight) return null;
    const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
    const displayWidth = videoWidth * scale;
    const displayHeight = videoHeight * scale;
    const offsetX = (rect.width - displayWidth) / 2;
    const offsetY = (rect.height - displayHeight) / 2;
    const px = clientX - rect.left - offsetX;
    const py = clientY - rect.top - offsetY;
    if (px < 0 || py < 0 || px > displayWidth || py > displayHeight) return null;
    return { x: px / scale, y: py / scale };
  }

  function handlePointer(event: MouseEvent, transition: boolean): void {
    const video = event.currentTarget as HTMLVideoElement;
    const point = mapClientPointToCanvas(video, event.clientX, event.clientY);
    if (!point) return;
    const tile = hitTestMultiview(latestTiles, point.x, point.y);
    if (!tile || tile.kind !== 'scene' || !tile.sceneId) return;
    if (transition) handlers.onTransitionToScene(tile.sceneId);
    else handlers.onSelectScene(tile.sceneId);
  }

  let popupDocument: Document;
  try {
    popupDocument = popup.document;
    popupDocument.title = 'LumaStream Multiview';
    popupDocument.documentElement.setAttribute('style', 'width:100%;height:100%;overflow:hidden;background:#000');
    popupDocument.body.setAttribute('style', 'width:100%;height:100%;margin:0;overflow:hidden;background:#000');
    const video = popupDocument.createElement('video');
    video.dataset.multiviewFeed = 'true';
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('style', 'display:block;width:100%;height:100%;background:#000;object-fit:contain');
    video.addEventListener('click', (event) => handlePointer(event, false));
    video.addEventListener('dblclick', (event) => handlePointer(event, true));
    popupDocument.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finishClose(true);
    });
    popupDocument.body.replaceChildren(video);
  } catch {
    finishClose(false);
    throw new Error('The multiview window could not be initialized.');
  }

  try { popup.focus(); } catch { /* Focus can be denied while the popup is closing. */ }

  try { stream = canvas.captureStream(frameRate); }
  catch {
    finishClose(false);
    throw new Error('The multiview output could not be shared with the window.');
  }

  function drawTile(ctx: CanvasRenderingContext2D, tile: MultiviewTile, scenesById: Map<string, MultiviewScene>): void {
    const sourceCanvas = tile.kind === 'scene' ? source.getCanvas('scene', tile.sceneId) : source.getCanvas(tile.kind);
    ctx.save();
    // Always paint a dark fill first, so a missing/letterboxed canvas reads as
    // an empty tile rather than falling through to the window's black backdrop.
    ctx.fillStyle = PLACEHOLDER_FILL;
    ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
    if (sourceCanvas && sourceCanvas.width > 0 && sourceCanvas.height > 0) {
      ctx.drawImage(sourceCanvas, tile.x, tile.y, tile.width, tile.height);
    }

    const scene = tile.kind === 'scene' && tile.sceneId ? scenesById.get(tile.sceneId) : undefined;
    // Every tile gets a neutral outline so inactive scene tiles are still
    // legible against the black backdrop; preview/program tiles (and the
    // scene currently live in them) override it with their accent color.
    let border = NEUTRAL_BORDER;
    let borderWidth = 1;
    let caption: string | null = null;
    if (tile.kind === 'preview') { border = PREVIEW_BORDER; borderWidth = 2; caption = 'PREVIEW'; }
    else if (tile.kind === 'program') { border = PROGRAM_BORDER; borderWidth = 2; caption = 'PROGRAM'; }
    else if (scene?.isProgram) { border = PROGRAM_BORDER; borderWidth = 2; caption = 'PROGRAM'; }
    else if (scene?.isPreview) { border = PREVIEW_BORDER; borderWidth = 2; caption = 'PREVIEW'; }

    if (tile.width > 4 && tile.height > 4) {
      ctx.strokeStyle = border;
      ctx.lineWidth = borderWidth;
      const inset = borderWidth / 2;
      ctx.strokeRect(tile.x + inset, tile.y + inset, tile.width - borderWidth, tile.height - borderWidth);
    }

    ctx.font = '12px system-ui, -apple-system, sans-serif';
    if (caption) {
      ctx.fillStyle = border;
      ctx.textBaseline = 'top';
      ctx.fillText(caption, tile.x + 6, tile.y + 4);
    }
    if (scene) {
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'bottom';
      ctx.fillText(scene.name, tile.x + 6, tile.y + tile.height - 4);
    }
    ctx.restore();
  }

  function drawFrame(): void {
    if (!context) return;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scenes = source.scenes();
    const scenesById = new Map(scenes.map((scene) => [scene.id, scene] as const));
    latestTiles = computeMultiviewLayout(canvas.width, canvas.height, scenes.map((scene) => scene.id), { maxScenes });
    for (const tile of latestTiles) drawTile(context, tile, scenesById);
  }

  function tick(): void {
    if (closed) return;
    if (popup.closed) { finishClose(true); return; }
    drawFrame();
    try {
      const video = popup.document.querySelector<HTMLVideoElement>('[data-multiview-feed]');
      if (video && video.srcObject !== stream) {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      }
    } catch { /* The popup may be closing. */ }
    animationFrameId = window.requestAnimationFrame(tick);
  }

  animationFrameId = window.requestAnimationFrame(tick);
  watcherId = window.setInterval(() => {
    if (closed) return;
    if (popup.closed) finishClose(true);
  }, WATCH_INTERVAL_MS);

  return {
    close: () => finishClose(false),
    isOpen: () => !closed && !popup.closed,
  };
}
