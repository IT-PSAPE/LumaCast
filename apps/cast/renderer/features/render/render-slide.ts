import type { Id } from '@lumacast/kernel';

// Imperative slide-rasterization API (issue: AI-agent/MCP slide review). A
// single `<SlideRenderHost />` (slide-render-host.tsx) is mounted once in the
// provider tree and registers itself here on mount; every export in this
// module is a thin queueing/composition layer over that registration — none
// of it touches Konva or the DOM directly except the contact-sheet canvas
// composition below, which only draws already-rendered tiles.

export interface RenderSlideOptions {
  /** Output pixel width. @default 1280 */
  width?: number;
  /** Output pixel height. @default derived from the slide's own aspect ratio */
  height?: number;
  format?: 'png' | 'jpeg';
  /** JPEG quality (0-1). Ignored for 'png'. */
  quality?: number;
  /** @default 10000 */
  timeoutMs?: number;
}

export interface RenderedSlide {
  slideId: Id;
  dataUrl: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
}

export interface ContactSheetOptions {
  /** @default 3 */
  columns?: number;
  /** @default 480 */
  thumbnailWidth?: number;
  /** @default 16 */
  gap?: number;
  /** 1-based index drawn under each tile. @default true */
  label?: boolean;
}

export type SlideRenderErrorCode = 'not-found' | 'timeout' | 'not-mounted' | 'capture-failed';

export class SlideRenderError extends Error {
  constructor(public code: SlideRenderErrorCode, message: string) {
    super(message);
    this.name = 'SlideRenderError';
  }
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_FORMAT: NonNullable<RenderSlideOptions['format']> = 'png';
const DEFAULT_CONTACT_COLUMNS = 3;
const DEFAULT_CONTACT_THUMBNAIL_WIDTH = 480;
const DEFAULT_CONTACT_GAP = 16;
const CONTACT_LABEL_HEIGHT = 28;
const CONTACT_LABEL_FONT = '600 14px system-ui, -apple-system, "Segoe UI", sans-serif';

/** A single render request handed to the host, resolved/rejected once it has run through the queue. */
export interface SlideRenderJob {
  slideId: Id;
  width: number;
  height: number | undefined;
  format: 'png' | 'jpeg';
  quality: number | undefined;
  timeoutMs: number;
  resolve(result: RenderedSlide): void;
  reject(error: SlideRenderError): void;
}

/** The host's imperative surface: push a job onto its FIFO queue. */
export interface SlideRenderHostController {
  enqueue(job: SlideRenderJob): void;
}

let hostController: SlideRenderHostController | null = null;

/** Called by `<SlideRenderHost />` on mount; the returned cleanup unregisters it. */
export function registerSlideRenderHost(controller: SlideRenderHostController): () => void {
  hostController = controller;
  return () => {
    if (hostController === controller) hostController = null;
  };
}

export function renderSlideToImage(slideId: Id, options: RenderSlideOptions = {}): Promise<RenderedSlide> {
  const controller = hostController;
  if (!controller) {
    return Promise.reject(new SlideRenderError('not-mounted', 'SlideRenderHost is not mounted; slide rendering is unavailable.'));
  }

  return new Promise<RenderedSlide>((resolve, reject) => {
    controller.enqueue({
      slideId,
      width: options.width ?? DEFAULT_WIDTH,
      height: options.height,
      format: options.format ?? DEFAULT_FORMAT,
      quality: options.quality,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      resolve,
      reject,
    });
  });
}

function resolveThemeColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new SlideRenderError('capture-failed', 'Failed to load a rendered tile while composing the contact sheet.'));
    image.src = src;
  });
}

export async function renderContactSheet(slideIds: Id[], options: ContactSheetOptions = {}): Promise<RenderedSlide & { slideIds: Id[] }> {
  if (slideIds.length === 0) {
    throw new SlideRenderError('not-found', 'renderContactSheet requires at least one slide id.');
  }

  const columns = Math.max(1, Math.floor(options.columns ?? DEFAULT_CONTACT_COLUMNS));
  const thumbnailWidth = options.thumbnailWidth ?? DEFAULT_CONTACT_THUMBNAIL_WIDTH;
  const gap = options.gap ?? DEFAULT_CONTACT_GAP;
  const showLabels = options.label ?? true;

  const tiles = await Promise.all(
    slideIds.map((slideId) => renderSlideToImage(slideId, { width: thumbnailWidth, format: 'png' })),
  );

  const tileHeight = tiles.reduce((max, tile) => Math.max(max, tile.height), 0);
  const labelHeight = showLabels ? CONTACT_LABEL_HEIGHT : 0;
  const cellWidth = thumbnailWidth;
  const cellHeight = tileHeight + labelHeight;
  const rows = Math.ceil(tiles.length / columns);
  const sheetWidth = columns * cellWidth + (columns - 1) * gap;
  const sheetHeight = rows * cellHeight + (rows - 1) * gap;

  const canvas = document.createElement('canvas');
  canvas.width = sheetWidth;
  canvas.height = sheetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new SlideRenderError('capture-failed', 'Canvas 2D context unavailable for contact sheet composition.');
  }

  const backgroundColor = resolveThemeColor('--background-color-secondary', '#f2f2f2');
  const labelColor = resolveThemeColor('--text-color-primary', '#1a1a1a');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, sheetWidth, sheetHeight);

  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index]!;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = column * (cellWidth + gap);
    const cellY = row * (cellHeight + gap);
    const tileX = cellX + (cellWidth - tile.width) / 2;

    const image = await loadImageElement(tile.dataUrl);
    ctx.drawImage(image, tileX, cellY, tile.width, tile.height);

    if (showLabels) {
      ctx.fillStyle = labelColor;
      ctx.font = CONTACT_LABEL_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), cellX + cellWidth / 2, cellY + tileHeight + labelHeight / 2);
    }
  }

  return {
    slideId: slideIds[0]!,
    slideIds,
    dataUrl: canvas.toDataURL('image/png'),
    width: sheetWidth,
    height: sheetHeight,
    format: 'png',
  };
}
