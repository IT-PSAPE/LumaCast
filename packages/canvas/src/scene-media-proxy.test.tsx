import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderNode, ResolvedMediaState, SceneSurface, SlideBackgroundFit, VisualPayloadState } from '@lumacast/composition';
import { SceneNodeMedia } from './scene-node-media';
import { SceneSlideBackgroundMedia } from './scene-slide-background-media';

let lastImageProps: Record<string, unknown> | null = null;
let lastRectProps: Record<string, unknown> | null = null;

const imageStates = new Map<string, ResolvedMediaState>();
const videoStates = new Map<string, ResolvedMediaState>();

vi.mock('react-konva', () => ({
  Group: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  Image: (props: Record<string, unknown>) => {
    lastImageProps = props;
    return null;
  },
  Line: () => null,
  Rect: (props: Record<string, unknown>) => {
    lastRectProps = props;
    return null;
  },
  Text: () => null,
}));

const useKImageMock = vi.fn((src: string | null) => src ? (imageStates.get(src) ?? { status: 'loading' }) : { status: 'empty' });
const useKVideoMock = vi.fn((src: string | null) => src ? (videoStates.get(src) ?? { status: 'loading' }) : { status: 'empty' });

vi.mock('./use-k-image', () => ({
  useKImage: (src: string | null) => useKImageMock(src),
}));

vi.mock('./use-k-video', () => ({
  useKVideo: (src: string | null) => useKVideoMock(src),
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

function imageNode(src: string, proxyMediaKey: string | null = null): RenderNode {
  return {
    id: 'node-1',
    element: {
      id: 'element-1',
      slideId: 'slide-1',
      type: 'image',
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      payload: { src },
    },
    visual: VISUAL,
    isVideo: false,
    proxyMediaKey,
  };
}

function videoNode(src: string, proxyMediaKey: string | null = null): RenderNode {
  return {
    ...imageNode(src, proxyMediaKey),
    isVideo: true,
    element: {
      ...imageNode(src, proxyMediaKey).element,
      type: 'video',
      payload: { src, autoplay: false, loop: false, muted: true, playbackRate: 1 },
    },
  };
}

function loadedImage(): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1920 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1080 });
  return image;
}

function loadedVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
  return video;
}

describe('scene media proxy rendering', () => {
  afterEach(() => {
    cleanup();
    imageStates.clear();
    videoStates.clear();
    useKImageMock.mockClear();
    useKVideoMock.mockClear();
    lastImageProps = null;
    lastRectProps = null;
  });

  it('renders an image derivative first and swaps to the full image once loaded', () => {
    const proxy = loadedImage();
    const full = loadedImage();
    imageStates.set('asset://full.png', { status: 'loading' });
    imageStates.set('asset://thumb.png', { status: 'loaded', resource: proxy });

    const node = imageNode('asset://full.png', 'asset://thumb.png');
    const view = render(<SceneNodeMedia node={node} surface={'show' satisfies SceneSurface} />);

    expect(lastImageProps?.image).toBe(proxy);

    imageStates.set('asset://full.png', { status: 'loaded', resource: full });
    view.rerender(<SceneNodeMedia node={node} surface={'show' satisfies SceneSurface} />);

    expect(lastImageProps?.image).toBe(full);
  });

  it('renders a video derivative image until the video element is ready', () => {
    const proxy = loadedImage();
    const fullVideo = loadedVideo();
    videoStates.set('asset://clip.mp4', { status: 'loading' });
    imageStates.set('asset://clip-thumb.png', { status: 'loaded', resource: proxy });

    const node = videoNode('asset://clip.mp4', 'asset://clip-thumb.png');
    const view = render(<SceneNodeMedia node={node} surface={'show' satisfies SceneSurface} />);

    expect(lastImageProps?.image).toBe(proxy);

    videoStates.set('asset://clip.mp4', { status: 'loaded', resource: fullVideo });
    view.rerender(<SceneNodeMedia node={node} surface={'show' satisfies SceneSurface} />);

    expect(lastImageProps?.image).toBe(fullVideo);
  });

  it('renders a background derivative first and swaps to the full background image once loaded', () => {
    const proxy = loadedImage();
    const full = loadedImage();
    imageStates.set('asset://background-full.png', { status: 'loading' });
    imageStates.set('asset://background-thumb.png', { status: 'loaded', resource: proxy });

    const view = render(
      <SceneSlideBackgroundMedia
        kind="image"
        src="asset://background-full.png"
        proxySrc="asset://background-thumb.png"
        fit={'cover' satisfies SlideBackgroundFit}
        width={1920}
        height={1080}
        surface={'show' satisfies SceneSurface}
      />,
    );

    expect(lastImageProps?.image).toBe(proxy);

    imageStates.set('asset://background-full.png', { status: 'loaded', resource: full });
    view.rerender(
      <SceneSlideBackgroundMedia
        kind="image"
        src="asset://background-full.png"
        proxySrc="asset://background-thumb.png"
        fit={'cover' satisfies SlideBackgroundFit}
        width={1920}
        height={1080}
        surface={'show' satisfies SceneSurface}
      />,
    );

    expect(lastImageProps?.image).toBe(full);
    expect(lastRectProps).toBeNull();
  });

  it('never requests the full source image or video on list surfaces', () => {
    const proxy = loadedImage();
    imageStates.set('asset://thumb.png', { status: 'loaded', resource: proxy });
    imageStates.set('asset://background-thumb.png', { status: 'loaded', resource: proxy });

    render(<SceneNodeMedia node={imageNode('asset://full-image.png', 'asset://thumb.png')} surface={'list' satisfies SceneSurface} />);
    render(<SceneNodeMedia node={videoNode('asset://clip.mp4', 'asset://thumb.png')} surface={'list' satisfies SceneSurface} />);
    render(
      <SceneSlideBackgroundMedia
        kind="video"
        src="asset://background-full.mp4"
        proxySrc="asset://background-thumb.png"
        ownerId="slide-1"
        fit={'cover' satisfies SlideBackgroundFit}
        width={1920}
        height={1080}
        surface={'list' satisfies SceneSurface}
      />,
    );

    expect(useKImageMock).not.toHaveBeenCalledWith('asset://full-image.png');
    expect(useKVideoMock).not.toHaveBeenCalledWith('asset://clip.mp4');
    expect(useKVideoMock).not.toHaveBeenCalledWith('asset://background-full.mp4');
    expect(useKImageMock).not.toHaveBeenCalledWith('asset://background-full.mp4');
    expect(lastImageProps?.image).toBe(proxy);
  });
});
