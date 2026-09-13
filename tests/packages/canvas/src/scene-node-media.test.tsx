import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderNode, ResolvedMediaState, SlideElementType, VisualPayloadState } from '@lumacast/composition';
import { SceneNodeMedia } from '../../../../packages/canvas/src/scene-node-media';

interface RecordedGroupProps {
  clipFunc?: (ctx: unknown) => void;
  children?: unknown;
}

const rects: Record<string, unknown>[] = [];
const images: Record<string, unknown>[] = [];
const groups: RecordedGroupProps[] = [];

const imageStates = new Map<string, ResolvedMediaState>();
const videoStates = new Map<string, ResolvedMediaState>();

vi.mock('react-konva', () => ({
  Group: (props: RecordedGroupProps) => {
    groups.push(props);
    return <>{props.children ?? null}</>;
  },
  Image: (props: Record<string, unknown>) => {
    images.push(props);
    return null;
  },
  Rect: (props: Record<string, unknown>) => {
    rects.push(props);
    return null;
  },
}));

vi.mock('../../../../packages/canvas/src/use-k-image', () => ({
  useKImage: (src: string | null) => (src ? imageStates.get(src) ?? { status: 'loading' } : { status: 'empty' }),
}));

vi.mock('../../../../packages/canvas/src/use-k-video', () => ({
  useKVideo: (src: string | null) => (src ? videoStates.get(src) ?? { status: 'loading' } : { status: 'empty' }),
}));

const DEFAULT_VISUAL: VisualPayloadState = {
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

function mediaNode(
  type: Extract<SlideElementType, 'image' | 'video'>,
  payload: Record<string, unknown>,
  options: { width?: number; height?: number; visual?: Partial<VisualPayloadState> } = {},
): RenderNode {
  return {
    id: 'node-1',
    element: {
      id: 'element-1',
      slideId: 'slide-1',
      type,
      x: 0,
      y: 0,
      width: options.width ?? 200,
      height: options.height ?? 100,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
      payload: type === 'video' ? { autoplay: false, loop: false, ...payload } : payload,
    },
    visual: { ...DEFAULT_VISUAL, ...options.visual },
    isVideo: type === 'video',
    proxyMediaKey: null,
  } as unknown as RenderNode;
}

function loadedImage(width: number, height: number): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
  return image;
}

function lastImageProps(): Record<string, unknown> {
  return images.at(-1)!;
}

describe('SceneNodeMedia fit', () => {
  beforeEach(() => {
    imageStates.set('asset://square.png', { status: 'loaded', resource: loadedImage(1000, 1000) });
  });

  afterEach(() => {
    cleanup();
    imageStates.clear();
    videoStates.clear();
    rects.length = 0;
    images.length = 0;
    groups.length = 0;
  });

  it('defaults an image with no fit to cover, cropping the source', () => {
    render(<SceneNodeMedia node={mediaNode('image', { src: 'asset://square.png' })} surface="deck-editor" />);
    const draw = lastImageProps();
    expect(draw).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    // 1000x1000 into 200x100 (2:1) under cover crops the vertical axis.
    expect(draw.crop).toMatchObject({ x: 0, y: 250, width: 1000, height: 500 });
  });

  it('honors an explicit contain fit, letterboxing instead of cropping', () => {
    render(
      <SceneNodeMedia
        node={mediaNode('image', { src: 'asset://square.png', fit: 'contain' })}
        surface="deck-editor"
      />,
    );
    const draw = lastImageProps();
    expect(draw).toMatchObject({ x: 50, y: 0, width: 100, height: 100 });
    expect(draw.crop).toBeUndefined();
  });

  it('honors an explicit fill fit, stretching to the full box', () => {
    render(
      <SceneNodeMedia node={mediaNode('image', { src: 'asset://square.png', fit: 'fill' })} surface="deck-editor" />,
    );
    const draw = lastImageProps();
    expect(draw).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect(draw.crop).toBeUndefined();
  });

  it('defaults a video with no fit to contain', () => {
    videoStates.set('asset://clip.mp4', { status: 'loaded', resource: makeVideo(1000, 1000) });
    render(
      <SceneNodeMedia node={mediaNode('video', { src: 'asset://clip.mp4' })} surface="deck-editor" />,
    );
    const draw = lastImageProps();
    expect(draw).toMatchObject({ x: 50, y: 0, width: 100, height: 100 });
  });

  it('honors an explicit cover fit on a video', () => {
    videoStates.set('asset://clip.mp4', { status: 'loaded', resource: makeVideo(1000, 1000) });
    render(
      <SceneNodeMedia node={mediaNode('video', { src: 'asset://clip.mp4', fit: 'cover' })} surface="deck-editor" />,
    );
    const draw = lastImageProps();
    expect(draw).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect(draw.crop).toMatchObject({ x: 0, y: 250, width: 1000, height: 500 });
  });
});

describe('SceneNodeMedia visual payload', () => {
  beforeEach(() => {
    imageStates.set('asset://square.png', { status: 'loaded', resource: loadedImage(1000, 1000) });
  });

  afterEach(() => {
    cleanup();
    imageStates.clear();
    videoStates.clear();
    rects.length = 0;
    images.length = 0;
    groups.length = 0;
  });

  it('paints a fill rect behind the media, visible in a contain fit letterbox', () => {
    render(
      <SceneNodeMedia
        node={mediaNode('image', { src: 'asset://square.png', fit: 'contain' }, {
          visual: { fillEnabled: true, fillColor: '#ff00aa' },
        })}
        surface="deck-editor"
      />,
    );
    // The fill rect is the full element bounds, independent of the smaller
    // letterboxed draw rect the media itself occupies.
    const fillRect = rects.find((props) => props.fill === '#ff00aa');
    expect(fillRect).toMatchObject({ x: 0, y: 0, width: 200, height: 100, fill: '#ff00aa' });
  });

  it('keeps the fill fully transparent (but still painted) when fillEnabled is false', () => {
    render(<SceneNodeMedia node={mediaNode('image', { src: 'asset://square.png' })} surface="deck-editor" />);
    expect(rects[0]).toMatchObject({ fill: '#2b303900', width: 200, height: 100 });
  });

  it('applies shadow props to the background rect, not the media', () => {
    render(
      <SceneNodeMedia
        node={mediaNode('image', { src: 'asset://square.png' }, {
          visual: { shadowEnabled: true, shadowColor: '#00000099', shadowBlur: 12, shadowOffsetX: 2, shadowOffsetY: 6 },
        })}
        surface="deck-editor"
      />,
    );
    expect(rects[0]).toMatchObject({
      shadowEnabled: true,
      shadowColor: '#00000099',
      shadowBlur: 12,
      shadowOffsetX: 2,
      shadowOffsetY: 6,
    });
    // The media Image node carries no shadow props of its own.
    expect(lastImageProps().shadowEnabled).toBeUndefined();
  });

  it('draws a stroke rect on top of the media when strokeEnabled', () => {
    render(
      <SceneNodeMedia
        node={mediaNode('image', { src: 'asset://square.png' }, {
          visual: { strokeEnabled: true, strokeColor: '#123456', strokeWidth: 4 },
        })}
        surface="deck-editor"
      />,
    );
    const strokeRect = rects.find((props) => props.stroke === '#123456');
    expect(strokeRect).toMatchObject({ stroke: '#123456', strokeWidth: 4, listening: false });
  });

  it('omits the stroke rect when strokeEnabled is false', () => {
    render(<SceneNodeMedia node={mediaNode('image', { src: 'asset://square.png' })} surface="deck-editor" />);
    expect(rects.some((props) => typeof props.stroke === 'string')).toBe(false);
  });

  it('builds a rounded-rect clip for the media group when borderRadius is set', () => {
    render(
      <SceneNodeMedia
        node={mediaNode('image', { src: 'asset://square.png' }, { visual: { borderRadius: 16 } })}
        surface="deck-editor"
      />,
    );
    expect(groups).toHaveLength(1);
    expect(typeof groups[0].clipFunc).toBe('function');

    const calls: string[] = [];
    const fakeCtx = {
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      arcTo: () => calls.push('arcTo'),
      closePath: () => calls.push('closePath'),
    };
    groups[0].clipFunc!(fakeCtx);
    expect(calls[0]).toBe('beginPath');
    expect(calls.at(-1)).toBe('closePath');
    expect(calls.filter((call) => call === 'arcTo')).toHaveLength(4);

    // Both the fill and stroke rects also carry the same corner radius.
    expect(rects[0].cornerRadius).toBe(16);
  });

  it('leaves the media group unclipped when borderRadius is zero', () => {
    render(<SceneNodeMedia node={mediaNode('image', { src: 'asset://square.png' })} surface="deck-editor" />);
    expect(groups[0].clipFunc).toBeUndefined();
  });
});

function makeVideo(width: number, height: number): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: height });
  return video;
}
