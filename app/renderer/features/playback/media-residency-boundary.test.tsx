import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemRef, MediaAsset, Overlay, PlaylistRow, Slide, SlideElement, Stage } from '@lumacast/composition';
import { MediaResidencyBoundary } from './media-residency-boundary';

const warmImageMock = vi.hoisted(() => vi.fn());
const warmVideoClaimMock = vi.hoisted(() => vi.fn());
const warmVideoSourceMock = vi.hoisted(() => vi.fn());

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
    mediaLayerAsset: null as MediaAsset | null,
    videoLayerAsset: null as MediaAsset | null,
    activeOverlays: [] as Array<{ overlay: Overlay }>,
  },
  stagePlayback: {
    currentStageId: null as string | null,
  },
  project: {
    slidesForItemRef: (_ref: ItemRef | null | undefined) => [] as Slide[],
    slideElementsBySlideId: new Map<string, SlideElement[]>(),
    stagesById: new Map<string, Stage>(),
    mediaAssets: [] as MediaAsset[],
  },
}));

vi.mock('@lumacast/canvas', () => ({
  buildVideoBackgroundClaimKey: (surface: string, ownerId: string) => `${surface}:background:${ownerId}`,
  buildVideoNodeClaimKey: (surface: string, elementId: string) => `${surface}:node:${elementId}`,
  warmImage: warmImageMock,
  warmVideoClaim: warmVideoClaimMock,
  warmVideoSource: warmVideoSourceMock,
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

function imageElement(id: string, src: string): SlideElement {
  return {
    id,
    slideId: 'slide-1',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    payload: { src },
  };
}

function videoElement(id: string, src: string): SlideElement {
  return {
    ...imageElement(id, src),
    type: 'video',
  };
}

function slide(id: string, item: ItemRef, backgroundSrc: string | null, order: number): Slide {
  return {
    id,
    background: backgroundSrc ? { type: 'image', mediaAssetId: backgroundSrc, src: backgroundSrc, fit: 'cover' } : null,
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

function mediaAsset(src: string, type: MediaAsset['type'] = 'image', thumbnailSrc: string | null = `${src}.thumb`): MediaAsset {
  return {
    id: src,
    name: src,
    type,
    src,
    width: 100,
    height: 100,
    duration: null,
    codec: null,
    thumbnailSrc,
    order: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

describe('MediaResidencyBoundary', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function installWarmImageHandleMocks(defaultStatus: 'loading' | 'loaded' = 'loaded') {
    const releases = new Map<string, ReturnType<typeof vi.fn>[]>();
    const setOptions = new Map<string, ReturnType<typeof vi.fn>[]>();
    const listeners = new Map<string, (() => void)[]>();
    const statuses = new Map<string, 'loading' | 'loaded' | 'broken' | 'evicted'>();

    vi.mocked(warmImageMock).mockImplementation((src: string) => {
      const release = vi.fn();
      const nextSetOptions = vi.fn();
      const existingReleases = releases.get(src) ?? [];
      existingReleases.push(release);
      releases.set(src, existingReleases);
      const existingSetOptions = setOptions.get(src) ?? [];
      existingSetOptions.push(nextSetOptions);
      setOptions.set(src, existingSetOptions);
      statuses.set(src, defaultStatus);
      return {
        entry: { src },
        getStatus: () => statuses.get(src) ?? defaultStatus,
        subscribe: (listener: () => void) => {
          const next = listeners.get(src) ?? [];
          next.push(listener);
          listeners.set(src, next);
          return () => {
            listeners.set(src, (listeners.get(src) ?? []).filter((candidate) => candidate !== listener));
          };
        },
        setOptions: nextSetOptions,
        release,
      };
    });

    return {
      releases,
      setOptions,
      emitStatus(src: string, status: 'loading' | 'loaded' | 'broken' | 'evicted') {
        statuses.set(src, status);
        for (const listener of listeners.get(src) ?? []) {
          listener();
        }
      },
      emitEvicted(src: string) {
        statuses.set(src, 'evicted');
        for (const listener of listeners.get(src) ?? []) {
          listener();
        }
      },
    };
  }

  it('warms only image sources and replaces abandoned warms when the plan changes', () => {
    const currentItem = { type: 'presentation', id: 'presentation-1' } satisfies ItemRef;
    const nextItem = { type: 'presentation', id: 'presentation-2' } satisfies ItemRef;
    const slide1 = slide('slide-1', currentItem, 'asset://live-bg.png', 0);
    const slide2 = slide('slide-2', currentItem, null, 1);
    const slide3 = slide('slide-3', currentItem, null, 2);
    const slide4 = slide('slide-4', nextItem, null, 0);
    const stage: Stage = {
      id: 'stage-1',
      slideId: 'stage-slide',
      name: 'Stage',
      width: 1920,
      height: 1080,
      background: null,
      elements: [imageElement('stage-image', 'asset://stage-image.png')],
      order: 0,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    };

    const slidesByItem = new Map<string, Slide[]>([
      ['presentation:presentation-1', [slide1, slide2, slide3]],
      ['presentation:presentation-2', [slide4]],
    ]);

    mockState.navigation.currentItemRef = currentItem;
    mockState.navigation.currentPlaylistEntryId = 'row-1';
    mockState.navigation.currentOutputItemRef = currentItem;
    mockState.navigation.currentOutputPlaylistEntryId = 'row-1';
    mockState.navigation.currentPlaylistRows = [
      itemRow('row-1', currentItem, 0),
      itemRow('row-2', nextItem, 1),
    ];
    mockState.slides.currentSlide = slide1;
    mockState.slides.currentSlideIndex = 0;
    mockState.slides.liveSlide = slide1;
    mockState.slides.liveSlideIndex = 0;
    mockState.slides.liveElements = [imageElement('live-image', 'asset://live-image.png'), videoElement('live-video', 'asset://live-video.mp4')];
    mockState.renderLayer.contentLayerVisible = true;
    mockState.renderLayer.mediaLayerAsset = null;
    mockState.renderLayer.videoLayerAsset = null;
    mockState.renderLayer.activeOverlays = [];
    mockState.stagePlayback.currentStageId = 'stage-1';
    mockState.project.slidesForItemRef = (ref) => {
      if (!ref) return [];
      return slidesByItem.get(`${ref.type}:${ref.id}`) ?? [];
    };
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', slide1 ? [imageElement('live-image', 'asset://live-image.png'), videoElement('live-video', 'asset://live-video.mp4')] : []],
      ['slide-2', [
        imageElement('next-image', 'asset://next-image.png'),
        videoElement('next-video', 'asset://next-video.mp4'),
      ]],
      ['slide-3', [imageElement('second-image', 'asset://second-image.png')]],
      ['slide-4', [imageElement('cross-image', 'asset://cross-image.png')]],
    ]);
    mockState.project.stagesById = new Map([[stage.id, stage]]);
    mockState.project.mediaAssets = [
      mediaAsset('asset://live-bg.png'),
      mediaAsset('asset://live-image.png'),
      mediaAsset('asset://live-video.mp4', 'video'),
      mediaAsset('asset://next-image.png'),
      mediaAsset('asset://next-video.mp4', 'video'),
      mediaAsset('asset://second-image.png'),
      mediaAsset('asset://cross-image.png'),
      mediaAsset('asset://stage-image.png'),
    ];

    const handles = installWarmImageHandleMocks('loading');
    vi.mocked(warmVideoClaimMock).mockImplementation((claimKey: string, src: string) => ({
      claimKey,
      mediaKey: src,
      release: vi.fn(),
    }));
    vi.mocked(warmVideoSourceMock).mockImplementation((src: string) => ({
      mediaKey: src,
      release: vi.fn(),
    }));

    const view = render(
      <MediaResidencyBoundary>
        <div data-testid="child" />
      </MediaResidencyBoundary>,
    );

    expect(warmImageMock).toHaveBeenCalledTimes(3);
    expect(warmImageMock).toHaveBeenCalledWith('asset://cross-image.png', expect.objectContaining({ tier: 'T1', graceMs: 3000 }));
    expect(warmImageMock).toHaveBeenCalledWith('asset://next-image.png', expect.objectContaining({ tier: 'T1', graceMs: 3000 }));
    expect(warmImageMock).toHaveBeenCalledWith('asset://stage-image.png', expect.objectContaining({ tier: 'T1', graceMs: 3000 }));
    expect(warmImageMock).not.toHaveBeenCalledWith('asset://second-image.png', expect.anything());
    expect(warmImageMock).not.toHaveBeenCalledWith('asset://live-image.png', expect.anything());
    expect(warmImageMock).not.toHaveBeenCalledWith('asset://live-video.mp4', expect.anything());
    expect(warmVideoClaimMock).toHaveBeenCalledWith('show:node:next-video', 'asset://next-video.mp4');
    expect(warmVideoSourceMock).toHaveBeenCalledWith('asset://next-video.mp4');

    mockState.slides.currentSlide = slide3;
    mockState.slides.currentSlideIndex = 2;
    mockState.stagePlayback.currentStageId = null;
    view.rerender(
      <MediaResidencyBoundary>
        <div data-testid="child" />
      </MediaResidencyBoundary>,
    );

    expect(handles.releases.get('asset://stage-image.png')?.[0]).toHaveBeenCalledTimes(1);
    expect(warmImageMock).toHaveBeenCalledWith('asset://second-image.png', expect.objectContaining({ tier: 'T1', graceMs: 3000 }));

    view.unmount();

    expect(handles.releases.get('asset://cross-image.png')?.at(-1)).toHaveBeenCalledTimes(1);
    expect(handles.releases.get('asset://next-image.png')?.at(-1)).toHaveBeenCalledTimes(1);
    expect(handles.releases.get('asset://second-image.png')?.at(-1)).toHaveBeenCalledTimes(1);
  });

  it('warms the selected slide from a different item as T1 before take', () => {
    const liveItem = { type: 'presentation', id: 'presentation-live' } satisfies ItemRef;
    const selectedItem = { type: 'presentation', id: 'presentation-selected' } satisfies ItemRef;
    const liveSlide = slide('live-slide', liveItem, null, 0);
    const selectedSlide = slide('selected-slide', selectedItem, null, 0);

    mockState.navigation.currentItemRef = selectedItem;
    mockState.navigation.currentPlaylistEntryId = 'row-selected';
    mockState.navigation.currentOutputItemRef = liveItem;
    mockState.navigation.currentOutputPlaylistEntryId = 'row-live';
    mockState.navigation.currentPlaylistRows = [
      itemRow('row-live', liveItem, 0),
      itemRow('row-selected', selectedItem, 1),
    ];
    mockState.slides.currentSlide = selectedSlide;
    mockState.slides.currentSlideIndex = 0;
    mockState.slides.liveSlide = liveSlide;
    mockState.slides.liveSlideIndex = 0;
    mockState.slides.liveElements = [];
    mockState.renderLayer.contentLayerVisible = true;
    mockState.renderLayer.mediaLayerAsset = null;
    mockState.renderLayer.videoLayerAsset = null;
    mockState.renderLayer.activeOverlays = [];
    mockState.stagePlayback.currentStageId = null;
    mockState.project.slidesForItemRef = (ref) => {
      if (!ref) return [];
      if (ref.id === liveItem.id) return [liveSlide];
      if (ref.id === selectedItem.id) return [selectedSlide];
      return [];
    };
    mockState.project.slideElementsBySlideId = new Map([
      ['live-slide', []],
      ['selected-slide', [imageElement('selected-image', 'asset://selected-image.png')]],
    ]);
    mockState.project.stagesById = new Map();
    mockState.project.mediaAssets = [mediaAsset('asset://selected-image.png')];

    installWarmImageHandleMocks();
    vi.mocked(warmVideoClaimMock).mockImplementation((claimKey: string, src: string) => ({
      claimKey,
      mediaKey: src,
      release: vi.fn(),
    }));
    vi.mocked(warmVideoSourceMock).mockImplementation((src: string) => ({
      mediaKey: src,
      release: vi.fn(),
    }));

    render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    expect(warmImageMock).toHaveBeenCalledWith('asset://selected-image.png', expect.objectContaining({ tier: 'T1', graceMs: 3000 }));
  });

  it('promotes an existing warm in place and reacquires it after invalidation while the plan stays unchanged', () => {
    vi.useFakeTimers();
    const currentItem = { type: 'presentation', id: 'presentation-1' } satisfies ItemRef;
    const slide1 = slide('slide-1', currentItem, null, 0);
    const slide2 = slide('slide-2', currentItem, null, 1);
    const slide3 = slide('slide-3', currentItem, null, 2);

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
    mockState.renderLayer.contentLayerVisible = true;
    mockState.renderLayer.mediaLayerAsset = null;
    mockState.renderLayer.videoLayerAsset = null;
    mockState.renderLayer.activeOverlays = [];
    mockState.stagePlayback.currentStageId = null;
    mockState.project.slidesForItemRef = () => [slide1, slide2, slide3];
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', []],
      ['slide-3', [imageElement('promoted-image', 'asset://promoted-image.png')]],
    ]);
    mockState.project.stagesById = new Map();
    mockState.project.mediaAssets = [mediaAsset('asset://promoted-image.png')];

    const handles = installWarmImageHandleMocks('loading');
    vi.mocked(warmVideoClaimMock).mockImplementation((claimKey: string, src: string) => ({
      claimKey,
      mediaKey: src,
      release: vi.fn(),
    }));
    vi.mocked(warmVideoSourceMock).mockImplementation((src: string) => ({
      mediaKey: src,
      release: vi.fn(),
    }));

    const view = render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    expect(warmImageMock).toHaveBeenCalledWith('asset://promoted-image.png', expect.objectContaining({ tier: 'T2' }));
    expect(handles.setOptions.get('asset://promoted-image.png')?.[0]).not.toHaveBeenCalled();

    mockState.slides.currentSlide = slide2;
    mockState.slides.currentSlideIndex = 1;
    mockState.slides.liveSlide = slide2;
    mockState.slides.liveSlideIndex = 1;
    view.rerender(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    expect(handles.setOptions.get('asset://promoted-image.png')?.[0]).toHaveBeenCalledWith(expect.objectContaining({ tier: 'T1', graceMs: 3000 }));
    expect(handles.releases.get('asset://promoted-image.png')?.[0]).not.toHaveBeenCalled();

    act(() => {
      handles.emitEvicted('asset://promoted-image.png');
    });

    expect(warmImageMock).toHaveBeenCalledTimes(2);
    expect(warmImageMock).toHaveBeenLastCalledWith('asset://promoted-image.png', expect.objectContaining({ tier: 'T1', graceMs: 3000 }));
  });

  it('prioritizes the program show surface when the predictable claim budget is capped at two', () => {
    const currentItem = { type: 'presentation', id: 'presentation-1' } satisfies ItemRef;
    const slide1 = slide('slide-1', currentItem, null, 0);
    const slide2 = slide('slide-2', currentItem, null, 1);
    const stage: Stage = {
      id: 'stage-1',
      slideId: 'stage-slide',
      name: 'Stage',
      width: 1920,
      height: 1080,
      background: null,
      elements: [videoElement('stage-video', 'asset://stage-video.mp4')],
      order: 0,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    };

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
    mockState.renderLayer.contentLayerVisible = true;
    mockState.renderLayer.mediaLayerAsset = null;
    mockState.renderLayer.videoLayerAsset = null;
    mockState.renderLayer.activeOverlays = [];
    mockState.stagePlayback.currentStageId = 'stage-1';
    mockState.project.slidesForItemRef = () => [slide1, slide2];
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', [
        videoElement('next-video-a', 'asset://next-video-a.mp4'),
        videoElement('next-video-b', 'asset://next-video-b.mp4'),
      ]],
    ]);
    mockState.project.stagesById = new Map([[stage.id, stage]]);
    mockState.project.mediaAssets = [
      mediaAsset('asset://next-video-a.mp4', 'video'),
      mediaAsset('asset://next-video-b.mp4', 'video'),
      mediaAsset('asset://stage-video.mp4', 'video'),
    ];

    installWarmImageHandleMocks();
    vi.mocked(warmVideoClaimMock).mockImplementation((claimKey: string, src: string) => ({
      claimKey,
      mediaKey: src,
      release: vi.fn(),
    }));
    vi.mocked(warmVideoSourceMock).mockImplementation((src: string) => ({
      mediaKey: src,
      release: vi.fn(),
    }));

    render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    expect(warmVideoClaimMock).toHaveBeenCalledTimes(2);
    expect(warmVideoClaimMock).toHaveBeenCalledWith('show:node:next-video-a', 'asset://next-video-a.mp4');
    expect(warmVideoClaimMock).toHaveBeenCalledWith('ndi-show:node:next-video-a', 'asset://next-video-a.mp4');
  });

  it('warms the live transport video through the shared-layer pool', () => {
    const currentItem = { type: 'presentation', id: 'presentation-1' } satisfies ItemRef;
    const slide1 = slide('slide-1', currentItem, null, 0);

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
    mockState.renderLayer.contentLayerVisible = true;
    mockState.renderLayer.mediaLayerAsset = null;
    mockState.renderLayer.videoLayerAsset = mediaAsset('asset://transport.mp4', 'video');
    mockState.renderLayer.activeOverlays = [];
    mockState.stagePlayback.currentStageId = null;
    mockState.project.slidesForItemRef = () => [slide1];
    mockState.project.slideElementsBySlideId = new Map([['slide-1', []]]);
    mockState.project.stagesById = new Map();
    mockState.project.mediaAssets = [mediaAsset('asset://transport.mp4', 'video')];

    installWarmImageHandleMocks();
    vi.mocked(warmVideoClaimMock).mockImplementation((claimKey: string, src: string) => ({
      claimKey,
      mediaKey: src,
      release: vi.fn(),
    }));
    vi.mocked(warmVideoSourceMock).mockImplementation((src: string) => ({
      mediaKey: src,
      release: vi.fn(),
    }));

    render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    expect(warmVideoSourceMock).toHaveBeenCalledWith('asset://transport.mp4');
  });

  it('admits the next queued image once an earlier speculative warm finishes loading', () => {
    const liveItem = { type: 'presentation', id: 'presentation-live' } satisfies ItemRef;
    const nextItem = { type: 'presentation', id: 'presentation-next' } satisfies ItemRef;
    const selectedItem = { type: 'presentation', id: 'presentation-selected' } satisfies ItemRef;
    const slide1 = slide('slide-1', liveItem, null, 0);
    const slide2 = slide('slide-2', liveItem, null, 1);
    const slide3 = slide('slide-3', liveItem, null, 2);
    const slide4 = slide('slide-4', nextItem, null, 0);
    const selectedSlide = slide('selected-slide', selectedItem, null, 0);
    const stage: Stage = {
      id: 'stage-1',
      slideId: 'stage-slide',
      name: 'Stage',
      width: 1920,
      height: 1080,
      background: null,
      elements: [imageElement('stage-image', 'asset://next-4.png')],
      order: 0,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    };

    mockState.navigation.currentItemRef = selectedItem;
    mockState.navigation.currentPlaylistEntryId = 'row-selected';
    mockState.navigation.currentOutputItemRef = liveItem;
    mockState.navigation.currentOutputPlaylistEntryId = 'row-1';
    mockState.navigation.currentPlaylistRows = [
      itemRow('row-1', liveItem, 0),
      itemRow('row-2', nextItem, 1),
      itemRow('row-selected', selectedItem, 2),
    ];
    mockState.slides.currentSlide = slide1;
    mockState.slides.currentSlideIndex = 0;
    mockState.slides.liveSlide = slide1;
    mockState.slides.liveSlideIndex = 0;
    mockState.slides.liveElements = [];
    mockState.renderLayer.contentLayerVisible = true;
    mockState.renderLayer.mediaLayerAsset = null;
    mockState.renderLayer.videoLayerAsset = null;
    mockState.renderLayer.activeOverlays = [];
    mockState.stagePlayback.currentStageId = 'stage-1';
    mockState.project.slidesForItemRef = (ref) => {
      if (!ref) return [];
      if (ref.id === liveItem.id) return [slide1, slide2, slide3];
      if (ref.id === nextItem.id) return [slide4];
      if (ref.id === selectedItem.id) return [selectedSlide];
      return [];
    };
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', [imageElement('next-1', 'asset://next-1.png')]],
      ['slide-3', [imageElement('next-2', 'asset://next-2.png')]],
      ['slide-4', [imageElement('next-3', 'asset://next-3.png')]],
      ['selected-slide', [imageElement('selected-image', 'asset://selected-image.png')]],
    ]);
    mockState.project.stagesById = new Map([[stage.id, stage]]);
    mockState.project.mediaAssets = [
      mediaAsset('asset://next-1.png'),
      mediaAsset('asset://next-2.png'),
      mediaAsset('asset://next-3.png'),
      mediaAsset('asset://selected-image.png'),
      mediaAsset('asset://next-4.png'),
    ];

    const handles = installWarmImageHandleMocks('loading');
    vi.mocked(warmVideoClaimMock).mockImplementation((claimKey: string, src: string) => ({
      claimKey,
      mediaKey: src,
      release: vi.fn(),
    }));
    vi.mocked(warmVideoSourceMock).mockImplementation((src: string) => ({
      mediaKey: src,
      release: vi.fn(),
    }));

    render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    const initialMediaKeys = vi.mocked(warmImageMock).mock.calls.map(([mediaKey]) => mediaKey);
    expect(warmImageMock).toHaveBeenCalledTimes(3);

    act(() => {
      handles.emitStatus('asset://next-1.png', 'loaded');
    });

    expect(warmImageMock).toHaveBeenCalledTimes(4);
    const queuedMediaKey = vi.mocked(warmImageMock).mock.calls.at(-1)?.[0];
    expect(initialMediaKeys).not.toContain(queuedMediaKey);
  });

  it('admits cold work immediately when earlier speculative handles are already loaded hits', () => {
    const liveItem = { type: 'presentation', id: 'presentation-live' } satisfies ItemRef;
    const nextItem = { type: 'presentation', id: 'presentation-next' } satisfies ItemRef;
    const selectedItem = { type: 'presentation', id: 'presentation-selected' } satisfies ItemRef;
    const slide1 = slide('slide-1', liveItem, null, 0);
    const slide2 = slide('slide-2', liveItem, null, 1);
    const slide3 = slide('slide-3', liveItem, null, 2);
    const slide4 = slide('slide-4', nextItem, null, 0);
    const selectedSlide = slide('selected-slide', selectedItem, null, 0);
    const stage: Stage = {
      id: 'stage-1',
      slideId: 'stage-slide',
      name: 'Stage',
      width: 1920,
      height: 1080,
      background: null,
      elements: [imageElement('stage-image', 'asset://image-4.png')],
      order: 0,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    };

    mockState.navigation.currentItemRef = selectedItem;
    mockState.navigation.currentPlaylistEntryId = 'row-selected';
    mockState.navigation.currentOutputItemRef = liveItem;
    mockState.navigation.currentOutputPlaylistEntryId = 'row-1';
    mockState.navigation.currentPlaylistRows = [
      itemRow('row-1', liveItem, 0),
      itemRow('row-2', nextItem, 1),
      itemRow('row-selected', selectedItem, 2),
    ];
    mockState.slides.currentSlide = slide1;
    mockState.slides.currentSlideIndex = 0;
    mockState.slides.liveSlide = slide1;
    mockState.slides.liveSlideIndex = 0;
    mockState.slides.liveElements = [];
    mockState.renderLayer.contentLayerVisible = true;
    mockState.renderLayer.mediaLayerAsset = null;
    mockState.renderLayer.videoLayerAsset = null;
    mockState.renderLayer.activeOverlays = [];
    mockState.stagePlayback.currentStageId = 'stage-1';
    mockState.project.slidesForItemRef = (ref) => {
      if (!ref) return [];
      if (ref.id === liveItem.id) return [slide1, slide2, slide3];
      if (ref.id === nextItem.id) return [slide4];
      if (ref.id === selectedItem.id) return [selectedSlide];
      return [];
    };
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', [imageElement('image-1', 'asset://image-1.png')]],
      ['slide-3', [imageElement('image-2', 'asset://image-2.png')]],
      ['slide-4', [imageElement('image-3', 'asset://image-3.png')]],
      ['selected-slide', [imageElement('selected-image', 'asset://selected-image.png')]],
    ]);
    mockState.project.stagesById = new Map([[stage.id, stage]]);
    mockState.project.mediaAssets = [
      mediaAsset('asset://image-1.png'),
      mediaAsset('asset://image-2.png'),
      mediaAsset('asset://image-3.png'),
      mediaAsset('asset://selected-image.png'),
      mediaAsset('asset://image-4.png'),
    ];

    installWarmImageHandleMocks('loaded');
    vi.mocked(warmVideoClaimMock).mockImplementation((claimKey: string, src: string) => ({
      claimKey,
      mediaKey: src,
      release: vi.fn(),
    }));
    vi.mocked(warmVideoSourceMock).mockImplementation((src: string) => ({
      mediaKey: src,
      release: vi.fn(),
    }));

    render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    expect(warmImageMock).toHaveBeenCalledTimes(5);
    expect(warmImageMock).toHaveBeenCalledWith('asset://image-4.png', expect.objectContaining({ tier: 'T1' }));
  });

  it('stops retrying a repeatedly evicted image until the plan changes', () => {
    vi.useFakeTimers();
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
    mockState.renderLayer.contentLayerVisible = true;
    mockState.renderLayer.mediaLayerAsset = null;
    mockState.renderLayer.videoLayerAsset = null;
    mockState.renderLayer.activeOverlays = [];
    mockState.stagePlayback.currentStageId = null;
    mockState.project.slidesForItemRef = () => [slide1, slide2];
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', [imageElement('retry-image', 'asset://retry-image.png')]],
    ]);
    mockState.project.stagesById = new Map();
    mockState.project.mediaAssets = [mediaAsset('asset://retry-image.png')];

    const handles = installWarmImageHandleMocks('loading');
    vi.mocked(warmVideoClaimMock).mockImplementation((claimKey: string, src: string) => ({
      claimKey,
      mediaKey: src,
      release: vi.fn(),
    }));
    vi.mocked(warmVideoSourceMock).mockImplementation((src: string) => ({
      mediaKey: src,
      release: vi.fn(),
    }));

    const view = render(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    for (const delay of [250, 500, 1000, 2000]) {
      act(() => {
        handles.emitEvicted('asset://retry-image.png');
      });
      act(() => {
        vi.advanceTimersByTime(delay);
      });
    }

    expect(warmImageMock).toHaveBeenCalledTimes(4);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(warmImageMock).toHaveBeenCalledTimes(4);

    mockState.slides.currentSlide = slide2;
    mockState.slides.currentSlideIndex = 1;
    mockState.slides.liveSlide = slide2;
    mockState.slides.liveSlideIndex = 1;
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', []],
    ]);
    view.rerender(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    mockState.slides.currentSlide = slide1;
    mockState.slides.currentSlideIndex = 0;
    mockState.slides.liveSlide = slide1;
    mockState.slides.liveSlideIndex = 0;
    mockState.project.slideElementsBySlideId = new Map([
      ['slide-1', []],
      ['slide-2', [imageElement('retry-image', 'asset://retry-image.png')]],
    ]);
    view.rerender(
      <MediaResidencyBoundary>
        <div />
      </MediaResidencyBoundary>,
    );

    expect(warmImageMock).toHaveBeenCalledTimes(5);
  });
});
