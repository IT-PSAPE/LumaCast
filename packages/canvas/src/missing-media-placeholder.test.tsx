import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderNode, ResolvedMediaState, SceneSurface, SlideBackgroundFit, VisualPayloadState } from '@lumacast/composition';
import { SceneNodeMedia } from './scene-node-media';
import { SceneSlideBackgroundMedia } from './scene-slide-background-media';

const rects: Record<string, unknown>[] = [];
const lines: Record<string, unknown>[] = [];
const texts: Record<string, unknown>[] = [];
const images: Record<string, unknown>[] = [];

const imageStates = new Map<string, ResolvedMediaState>();
const videoStates = new Map<string, ResolvedMediaState>();

vi.mock('react-konva', () => ({
  Group: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  Image: (props: Record<string, unknown>) => {
    images.push(props);
    return null;
  },
  Line: (props: Record<string, unknown>) => {
    lines.push(props);
    return null;
  },
  Rect: (props: Record<string, unknown>) => {
    rects.push(props);
    return null;
  },
  Text: (props: Record<string, unknown>) => {
    texts.push(props);
    return null;
  },
}));

vi.mock('./use-k-image', () => ({
  useKImage: (src: string | null) => (src ? imageStates.get(src) ?? { status: 'loading' } : { status: 'empty' }),
}));

vi.mock('./use-k-video', () => ({
  useKVideo: (src: string | null) => (src ? videoStates.get(src) ?? { status: 'loading' } : { status: 'empty' }),
}));

const VISUAL: VisualPayloadState = {
  visible: true,
  locked: false,
  flipX: false,
  flipY: false,
  fillEnabled: false,
  fillColor: 'transparent',
  strokeEnabled: false,
  strokeColor: '#000000',
  strokeWidth: 0,
  strokePosition: 'inside',
  borderRadius: 0,
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

function imageNode(src: string, width = 960, height = 540, proxyMediaKey: string | null = null): RenderNode {
  return {
    id: 'node-1',
    element: {
      id: 'element-1',
      slideId: 'slide-1',
      type: 'image',
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      payload: { src },
    },
    visual: VISUAL,
    isVideo: false,
    proxyMediaKey,
  };
}

function loadedImage(): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1920 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1080 });
  return image;
}

/** The placeholder's field fill: the first opaque, fully painted rect. */
function fieldFill(): string | null {
  const field = rects.find((props) => typeof props.fill === 'string' && props.fill !== '#2b303900' && props.fill !== '#00000000');
  return typeof field?.fill === 'string' ? field.fill : null;
}

function isRed(hex: string | null): boolean {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  // Red-dominant and not a neutral gray: the whole point of the state is that
  // it reads as a fault at a glance.
  return red > green && red > blue && red - Math.max(green, blue) >= 12;
}

function labelText(): string | null {
  const label = texts.find((props) => typeof props.text === 'string');
  return typeof label?.text === 'string' ? label.text : null;
}

function renderNodeAt(surface: SceneSurface, width = 960, height = 540) {
  return render(<SceneNodeMedia node={imageNode('asset://gone.png', width, height)} surface={surface} />);
}

describe('missing-media placeholder', () => {
  beforeEach(() => {
    imageStates.set('asset://gone.png', { status: 'broken' });
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  afterEach(() => {
    cleanup();
    imageStates.clear();
    videoStates.clear();
    rects.length = 0;
    lines.length = 0;
    texts.length = 0;
    images.length = 0;
    document.documentElement.removeAttribute('data-theme');
  });

  it('paints a red field with a warning glyph and label for a broken element source in the editor', () => {
    renderNodeAt('deck-editor');

    expect(isRed(fieldFill())).toBe(true);
    expect(labelText()).toBe('MISSING MEDIA');
    // Triangle outline, exclamation stem, exclamation dot, plus hatching.
    expect(lines.filter((props) => props.closed === true)).toHaveLength(1);
    expect(lines.length).toBeGreaterThan(3);
  });

  it('reports a broken source on the operator monitor but never on a live output surface', () => {
    renderNodeAt('monitor');
    expect(isRed(fieldFill())).toBe(true);

    for (const surface of ['show', 'stage', 'ndi-show', 'ndi-stage'] satisfies SceneSurface[]) {
      cleanup();
      rects.length = 0;
      texts.length = 0;
      renderNodeAt(surface);
      expect(fieldFill(), `surface ${surface} must stay empty`).toBeNull();
      expect(labelText(), `surface ${surface} must stay empty`).toBeNull();
      expect(rects.some((props) => props.fill === '#2b303900')).toBe(true);
    }
  });

  it('adapts to the active theme and repaints when the theme changes', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    renderNodeAt('deck-editor');
    const light = fieldFill();

    expect(isRed(light)).toBe(true);

    rects.length = 0;
    // MutationObserver delivers on a microtask, so the flush has to be awaited.
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    const dark = fieldFill();

    expect(isRed(dark)).toBe(true);
    expect(dark).not.toBe(light);
  });

  it('drops the label, then the glyph, as the element gets smaller', () => {
    renderNodeAt('deck-editor', 180, 120);
    expect(labelText()).toBeNull();
    expect(lines.some((props) => props.closed === true)).toBe(true);

    cleanup();
    rects.length = 0;
    lines.length = 0;
    renderNodeAt('deck-editor', 36, 24);
    expect(labelText()).toBeNull();
    expect(lines.some((props) => props.closed === true)).toBe(false);
    expect(isRed(fieldFill())).toBe(true);
  });

  it('prefers a loaded derivative over the missing-media state', () => {
    const proxy = loadedImage();
    imageStates.set('asset://thumb.png', { status: 'loaded', resource: proxy });

    render(
      <SceneNodeMedia
        node={imageNode('asset://gone.png', 960, 540, 'asset://thumb.png')}
        surface={'deck-editor' satisfies SceneSurface}
      />,
    );

    expect(images.at(-1)?.image).toBe(proxy);
    expect(fieldFill()).toBeNull();
  });

  it('reports a broken slide background instead of painting nothing', () => {
    render(
      <SceneSlideBackgroundMedia
        kind="image"
        src="asset://gone.png"
        fit={'cover' satisfies SlideBackgroundFit}
        width={1920}
        height={1080}
        surface={'deck-editor' satisfies SceneSurface}
      />,
    );

    expect(isRed(fieldFill())).toBe(true);
    expect(labelText()).toBe('MISSING MEDIA');
  });

  it('leaves a broken slide background empty on a live output surface', () => {
    render(
      <SceneSlideBackgroundMedia
        kind="image"
        src="asset://gone.png"
        fit={'cover' satisfies SlideBackgroundFit}
        width={1920}
        height={1080}
        surface={'show' satisfies SceneSurface}
      />,
    );

    expect(fieldFill()).toBeNull();
    expect(rects.some((props) => props.fill === '#00000000')).toBe(true);
  });

  it('reports a broken derivative on list thumbnails, which never decode the full source', () => {
    imageStates.set('asset://thumb.png', { status: 'broken' });

    render(
      <SceneNodeMedia
        node={imageNode('asset://gone.png', 480, 270, 'asset://thumb.png')}
        surface={'list' satisfies SceneSurface}
      />,
    );

    expect(isRed(fieldFill())).toBe(true);
  });
});
