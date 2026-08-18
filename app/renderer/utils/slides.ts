import type { MediaAsset, OverlayAnimation, Slide, SlideElement } from '@lumacast/composition';
import type { SlideBrowserMode, PlaylistBrowserMode, SlideVisualState } from '../types/ui';
import { LAYER_ORDER } from '../types/ui';
export { clamp } from './math';

export const CANVAS_VIEW_LABELS: Record<SlideBrowserMode, string> = {
  grid: 'Grid',
  list: 'List',
};

export const PLAYLIST_DISPLAY_MODE_LABELS: Record<PlaylistBrowserMode, string> = {
  current: 'Current',
  tabs: 'Tabs',
  continuous: 'Continuous',
};

export function sortSlides(slides: Slide[]): Slide[] {
  return slides.slice().sort((a, b) => a.order - b.order);
}

export function sortElements(elements: SlideElement[]): SlideElement[] {
  return elements.slice().sort((a, b) => {
    const layerDiff = LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer];
    if (layerDiff !== 0) return layerDiff;
    return a.zIndex - b.zIndex;
  });
}

export function compactText(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}\u2026`;
}

export interface SlideTextDetails {
  textElement: SlideElement | null;
  text: string;
  primaryLine: string;
  secondaryLine: string;
}

export function slideTextDetails(elements: SlideElement[]): SlideTextDetails {
  const textElement = elements.find((el) => el.type === 'text' && 'text' in el.payload) ?? null;
  if (!textElement || !('text' in textElement.payload)) {
    return { textElement: null, text: '', primaryLine: 'No text content', secondaryLine: '' };
  }

  const raw = String(textElement.payload.text ?? '');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const primaryLine = lines[0] ?? 'No text content';
  const secondaryLine = lines.slice(1).join(' ');
  return { textElement, text: raw, primaryLine, secondaryLine };
}

export function slideTextPreview(elements: SlideElement[]): string {
  const details = slideTextDetails(elements);
  if (!details.text) return details.primaryLine;
  return compactText(details.text, 72);
}

export function getSlideVisualState(index: number, liveSlideIndex: number, currentSlideIndex: number, elements: SlideElement[]): SlideVisualState {
  if (index === liveSlideIndex) return 'live';
  if (index === currentSlideIndex) return 'selected';
  if (elements.length === 0) return 'warning';
  return 'queued';
}

export function replacePrimaryLine(text: string, nextPrimary: string): string {
  const trimmedPrimary = nextPrimary.trim();
  if (!trimmedPrimary) return text;

  const lines = text.split('\n');
  if (lines.length === 0) return trimmedPrimary;
  if (lines.length === 1) return trimmedPrimary;
  return [trimmedPrimary, ...lines.slice(1)].join('\n');
}

export function typeFromFile(file: File): MediaAsset['type'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'video';
}

export function fileSrc(file: File): string {
  const fileWithPath = file as File & { path?: string };
  if (!fileWithPath.path) return '';
  return castMediaSrc(fileWithPath.path);
}

/**
 * Builds the *import capability* form of a media source: the encoded path of a
 * file the user just selected in a dialog or dropped on the window, addressed
 * to main so it can be persisted.
 *
 * This is not a renderable URL (issue #159). The `cast-media:` protocol handler
 * only serves opaque managed media ids minted by main, so fetching this string
 * is denied; the renderable source for a persisted asset is the `src` main
 * returns on the asset itself. Pass the result of this function to an IPC
 * mutation and render what comes back.
 *
 * The scheme prefix is overridable via `window.__castMediaBase`, a global the
 * browser-preview shim (tool/browser-preview/shim.ts) sets before this module
 * evaluates. The Electron app never sets that global, so `CAST_MEDIA_BASE`
 * resolves to the literal `cast-media://` prefix and this function's behavior
 * there is byte-identical to before.
 */
const CAST_MEDIA_BASE: string =
  (globalThis as { __castMediaBase?: string }).__castMediaBase ?? 'cast-media://';

export function castMediaSrc(filePath: string): string {
  return `${CAST_MEDIA_BASE}${encodeURIComponent(filePath)}`;
}

export function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}


interface OverlayDefaultOptions {
  animationKind?: OverlayAnimation['kind'];
  durationMs?: number;
  autoClearDurationMs?: number | null;
}

export function getOverlayDefaults(options: OverlayDefaultOptions = {}) {
  return {
    name: 'New Overlay',
    elements: [],
    animation: {
      kind: options.animationKind ?? 'dissolve',
      durationMs: options.durationMs ?? 400,
      autoClearDurationMs: options.autoClearDurationMs ?? null,
    },
  };
}
