import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemRef, MediaAsset, PlaylistRow, SceneSurface, Slide, SlideElement } from '@lumacast/composition';
import { SceneNodeMedia } from '@lumacast/canvas';
import { SceneSlideBackground } from '@lumacast/canvas';
import { MediaResidencyBoundary } from './media-residency-boundary';

let lastImageProps: Record<string, unknown> | null = null;

vi.mock('react-konva', () => ({
  Group: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  Image: (props: Record<string, unknown>) => {
    lastImageProps = props;
    return null;
  },
  Line: () => null,
  Rect: () => null,
}));

const mockState = vi.hoisted(() => ({
  navigation: {
    currentItemRef: null as ItemRef | null,
    currentPlaylistEntryId: null as string | null,
    currentOutputItemRef: null as ItemRef | null,
    currentOutputPlaylistEntryId: null as string | null,
    currentPlaylistRows: [] as PlaylistRow[],
  },
  slides: {
    currentSlide: null as Slide | null,
    currentSlideIndex: -1,
    liveSlide: null as Slide | null,
    liveSlideIndex: -1,
    liveElements: [] as SlideElement[],
  },
  renderLayer: {
    contentLayerVisible: true,
    mediaLayerAsset: null,
    videoLayerAsset: null,
    activeOverlays: [],
  },
  stagePlayback: {
    currentStageId: null as string | null,
  },
  project: {
    slidesForItemRef: (_ref: ItemRef | null | undefined) => [] as Slide[],
    slideElementsBySlideId: new Map<string, SlideElement[]>(),
    stagesById: new Map(),
    mediaAssets: [] as MediaAsset[],
  },
}));

vi.mock('../../contexts/navigation-context', () => ({
  useNavigation: () => mockState.navigation,
}));

vi.mock('../../contexts/slide-context', () => ({
  useSlides: () => mockState.slides,
}));

vi.mock('../../contexts/playback/playback-context', () => ({
  usePresentationRenderLayer: () => mockState.renderLayer,
  useStagePlayback: () => mockState.stagePlayback,
}));

vi.mock('../../contexts/use-project-content', () => ({
  useProjectContent: () => mockState.project,
}));

function itemRow(id: string, itemRef: ItemRef, order: number): PlaylistRow {
  return {
    id,
    playlistId: 'playlist-1',
    kind: 'item',
    reference: { type: itemRef.type, itemId: itemRef.id },
    presentationId: itemRef.type === 'presentation' ? itemRef.id : null,
    lyricId: itemRef.type === 'lyric' ? itemRef.id : null,
    talkId: itemRef.type === 'talk' ? itemRef.id : null,
    order,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function slide(id: string, item: ItemRef, backgroundSrc: string | null, order: number): Slide {
  return {
    id,
    background: backgroundSrc ? { type: 'video', mediaAssetId: backgroundSrc, src: backgroundSrc, fit: 'cover' } : null,
    backgroundSource: 'local',
    presentationId: item.type === 'presentation' ? item.id : null,
    lyricId: item.type === 'lyric' ? item.id : null,
    talkId: item.type === 'talk' ? item.id : null,
    presentationThemeId: null,
    lyricThemeId: null,
    talkThemeId: null,
    overlayThemeId: null,
    overlayId: null,
    stageId: null,
    kind: item.type,
    width: 1920,
    height: 1080,
    notes: '',
    order,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function videoElement(id: string, src: string): SlideElement {
  return {
    id,
    slideId: 'slide-2',
    type: 'video',
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
    payload: { src, autoplay: false, loop: false, muted: true, playbackRate: 1 },
  };
}

function mediaAsset(src: string) {
  return {
    id: src,
    name: src,
    type: 'video' as const,
    src,
    width: 1920,
    height: 1080,
    duration: null,
    codec: null,
    thumbnailSrc: `${src}.thumb`,
    order: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

describe('MediaResidencyBoundary video claim integration', () => {
  const originalLoad = HTMLMediaElement.prototype.load;
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;
  const pausedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused');
  const readyStateDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
  const endedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'ended');
  const videoWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth');
  const videoHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight');

  beforeEach(() => {
    lastImageProps = null;
    HTMLMediaElement.prototype.load = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn(async function play(this: HTMLMediaElement) {
      this.dataset.paused = '0';
    }) as typeof HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.pause = vi.fn(function pause(this: HTMLMediaElement) {
      this.dataset.paused = '1';
    }) as typeof HTMLMediaElement.prototype.pause;
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() {
        return this.dataset.paused !== '0';
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        return HTMLMediaElement.HAVE_CURRENT_DATA;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'ended', {
      configurable: true,
      get() {
        return false;
      },
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get() {
        return 1920;
      },
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get() {
        return 1080;
      },
    });
  });

  afterEach(() => {
    cleanup();
    HTMLMediaElement.prototype.load = originalLoad;
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLMediaElement.prototype.pause = originalPause;
    if (pausedDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'paused', pausedDescriptor);
    if (readyStateDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', readyStateDescriptor);
    if (endedDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'ended', endedDescriptor);
    if (videoWidthDescriptor) Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', videoWidthDescriptor);
    if (videoHeightDescriptor) Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', videoHeightDescriptor);
  });

  it('adopts a boundary-created next-slide node claim through the concrete consumer key', () => {
    const currentItem = { type: 'presentation', id: 'presentation-1' } satisfies ItemRef;
    const slide1 = slide('slide-1', currentItem, null, 0);
    const slide2 = slide('slide-2', currentItem, null, 1);

    mockState.navigation.currentItemRef = currentItem;
    mockState.navigation.currentPlaylistEntryId = 'row-1';
    mockState.navigation.currentOutputItemRef = currentItem;
    mockState.navigation.currentOutputPlaylistEntryId = 'row-1';
    mockState.navigation.currentPlaylistRows = [itemRow('row-1', currentItem, 0)];
    mockState.slides.currentSlide = slide1;
    mockState.slides.currentSlideIndex = 0;
    mockState.slides.liveSlide = slide1;
    mockState.slides.liveSlideIndex = 0;
    mockState.slides.liveElements = [];
    mockState.project.slidesForItemRef = () => [slide1, slide2];
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', [videoElement('next-video', 'asset://next-video.mp4')]],
    ]);
    mockState.project.mediaAssets = [mediaAsset('asset://next-video.mp4')];

    const view = render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    view.rerender(
      <MediaResidencyBoundary>
        <SceneNodeMedia
          node={{
            id: 'node-1',
            element: {
              ...videoElement('next-video', 'asset://next-video.mp4'),
              slideId: 'slide-2',
            },
            visual: {
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
            },
            isVideo: true,
            proxyMediaKey: null,
          }}
          surface={'show' satisfies SceneSurface}
        />
      </MediaResidencyBoundary>,
    );

    expect(lastImageProps?.image).toBeInstanceOf(HTMLVideoElement);
  });

  it('adopts a boundary-created next-slide background claim through the concrete consumer key', () => {
    const currentItem = { type: 'presentation', id: 'presentation-1' } satisfies ItemRef;
    const slide1 = slide('slide-1', currentItem, null, 0);
    const slide2 = slide('slide-2', currentItem, 'asset://next-background.mp4', 1);

    mockState.navigation.currentItemRef = currentItem;
    mockState.navigation.currentPlaylistEntryId = 'row-1';
    mockState.navigation.currentOutputItemRef = currentItem;
    mockState.navigation.currentOutputPlaylistEntryId = 'row-1';
    mockState.navigation.currentPlaylistRows = [itemRow('row-1', currentItem, 0)];
    mockState.slides.currentSlide = slide1;
    mockState.slides.currentSlideIndex = 0;
    mockState.slides.liveSlide = slide1;
    mockState.slides.liveSlideIndex = 0;
    mockState.slides.liveElements = [];
    mockState.project.slidesForItemRef = () => [slide1, slide2];
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', []],
    ]);
    mockState.project.mediaAssets = [mediaAsset('asset://next-background.mp4')];

    const view = render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    view.rerender(
      <MediaResidencyBoundary>
        <SceneSlideBackground
          background={{ type: 'video', src: 'asset://next-background.mp4', fit: 'cover', mediaAssetId: 'asset://next-background.mp4' }}
          ownerId="slide-2"
          width={1920}
          height={1080}
          surface={'show' satisfies SceneSurface}
        />
      </MediaResidencyBoundary>,
    );

    expect(lastImageProps?.image).toBeInstanceOf(HTMLVideoElement);
  });
});
