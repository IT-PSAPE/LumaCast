import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeVideoBank } from '../../../../apps/stream/renderer/canvas-composition';
import { toRuntimeSource } from '../../../../apps/stream/renderer/source-runtime';
import { currentSlideshowElapsedMs, currentSlideshowSlideIndex, forgetSlideshow } from '../../../../apps/stream/renderer/slideshow';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';

function mediaSource(id = 'clip', assetId = 'asset-a'): StreamSource {
  return {
    id,
    name: id,
    kind: 'media',
    mediaKind: 'video',
    assetId,
    assetExtension: 'mp4',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
  };
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function bankProps(source: ReturnType<typeof toRuntimeSource>, options: {
  programSourceIds?: Set<string>;
  playbackSourceIds?: Set<string>;
  activeSourceIds?: Set<string>;
  onMediaElement: (source: ReturnType<typeof toRuntimeSource>, element: HTMLMediaElement, programActive: boolean) => Promise<void>;
  elements: Map<string, HTMLVideoElement>;
  mediaElements: Map<string, HTMLMediaElement>;
}) {
  return {
    sources: [source],
    runtimes: new Map<string, MediaStream>(),
    elements: options.elements,
    mediaElements: options.mediaElements,
    images: new Map<string, HTMLImageElement>(),
    activeSourceIds: options.activeSourceIds ?? new Set<string>(),
    programSourceIds: options.programSourceIds ?? new Set<string>(),
    playbackSourceIds: options.playbackSourceIds ?? new Set<string>(),
    onMediaElement: options.onMediaElement,
    onMediaPlaybackState: vi.fn(),
    onBrowserElement: vi.fn(),
  };
}

describe('RuntimeVideoBank media ownership', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('connects once per media resource while Program playback and source settings change', async () => {
    const runtime = toRuntimeSource(mediaSource());
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const previewRoute = vi.fn(() => Promise.resolve());
    const updatedRoute = vi.fn(() => Promise.resolve());
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const props = bankProps(runtime, { elements, mediaElements, onMediaElement: previewRoute });
    const view = render(<RuntimeVideoBank {...props} />);
    await flushEffects();

    const video = mediaElements.get(runtime.id) as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(previewRoute).toHaveBeenCalledOnce();
    expect(previewRoute.mock.calls[0]![2]).toBe(false);
    expect(play).not.toHaveBeenCalled();
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 18 });

    view.rerender(<RuntimeVideoBank {...bankProps(runtime, { elements, mediaElements, onMediaElement: updatedRoute })} />);
    await flushEffects();
    expect(updatedRoute).not.toHaveBeenCalled();
    expect(previewRoute).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(18);

    const programIds = new Set([runtime.id]);
    view.rerender(<RuntimeVideoBank {...bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: updatedRoute,
      activeSourceIds: programIds,
      programSourceIds: programIds,
      playbackSourceIds: programIds,
    })} />);
    await flushEffects();

    expect(updatedRoute).not.toHaveBeenCalled();
    expect(previewRoute).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);

    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 29 });
    const updatedConfig = { ...runtime, volume: 0.4 };
    view.rerender(<RuntimeVideoBank {...bankProps(updatedConfig, {
      elements,
      mediaElements,
      onMediaElement: previewRoute,
      activeSourceIds: programIds,
      programSourceIds: programIds,
      playbackSourceIds: programIds,
    })} />);
    await flushEffects();

    expect(previewRoute).toHaveBeenCalledOnce();
    expect(updatedRoute).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(29);
    expect(play).toHaveBeenCalledOnce();

    view.unmount();
    expect(elements.has(runtime.id)).toBe(false);
    expect(mediaElements.has(runtime.id)).toBe(false);
  });

  it('keeps Preview and Program variants separate when one logical source changes asset', async () => {
    const preview = toRuntimeSource(mediaSource('shared-origin', 'preview-asset'));
    const program = toRuntimeSource(mediaSource('shared-origin', 'program-asset'));
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const onMediaElement = vi.fn(() => Promise.resolve());
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);

    render(<RuntimeVideoBank
      sources={[preview, program]}
      runtimes={new Map()}
      elements={elements}
      mediaElements={mediaElements}
      images={new Map()}
      activeSourceIds={new Set([preview.id, program.id])}
      programSourceIds={new Set([program.id])}
      playbackSourceIds={new Set([program.id])}
      onMediaElement={onMediaElement}
      onMediaPlaybackState={vi.fn()}
      onBrowserElement={vi.fn()}
    />);
    await flushEffects();

    expect(preview.id).not.toBe(program.id);
    expect(mediaElements.size).toBe(2);
    expect(onMediaElement.mock.calls.map((call) => [call[0].id, call[2]])).toEqual([
      [preview.id, false],
      [program.id, true],
    ]);
    expect(play).toHaveBeenCalledOnce();
  });

  it('marks media sources without assets unavailable and never connects or plays them', async () => {
    const videoSource = toRuntimeSource({ ...mediaSource('missing-video'), assetId: undefined });
    const audioSource = toRuntimeSource({ ...mediaSource('missing-audio'), mediaKind: 'audio', assetId: undefined });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const onMediaElement = vi.fn(() => Promise.resolve());
    const onSourceStatus = vi.fn();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const programAndPlaybackIds = new Set([videoSource.id, audioSource.id]);

    render(<RuntimeVideoBank
      sources={[videoSource, audioSource]}
      runtimes={new Map()}
      elements={elements}
      mediaElements={mediaElements}
      images={new Map()}
      activeSourceIds={programAndPlaybackIds}
      programSourceIds={programAndPlaybackIds}
      playbackSourceIds={programAndPlaybackIds}
      onMediaElement={onMediaElement}
      onMediaPlaybackState={vi.fn()}
      onBrowserElement={vi.fn()}
      onSourceStatus={onSourceStatus}
    />);
    await flushEffects();

    expect(mediaElements.size).toBe(2);
    expect(onMediaElement).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(onSourceStatus.mock.calls).toEqual([
      [videoSource.id, { state: 'unavailable', message: 'No media asset is configured.' }],
      [audioSource.id, { state: 'unavailable', message: 'No media asset is configured.' }],
    ]);
  });

  it('starts slideshow time only in Program and preserves its elapsed time while paused', () => {
    const source = toRuntimeSource({
      ...mediaSource('slideshow-origin'),
      kind: 'slideshow',
      slideshowImages: [
        { assetId: 'slide-a', assetExtension: 'png', name: 'Slide A' },
        { assetId: 'slide-b', assetExtension: 'png', name: 'Slide B' },
        { assetId: 'slide-c', assetExtension: 'png', name: 'Slide C' },
      ],
      slideshowIntervalSeconds: 1,
    });
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const props = bankProps(source, { elements, mediaElements, onMediaElement: vi.fn(() => Promise.resolve()) });
    const view = render(<RuntimeVideoBank {...props} />);

    expect(currentSlideshowElapsedMs(source.id, 5_000)).toBe(0);
    expect(currentSlideshowSlideIndex(source.id, 3, 1, true, 5_000)).toBe(0);

    now.mockReturnValue(5_000);
    const programIds = new Set([source.id]);
    view.rerender(<RuntimeVideoBank {...bankProps(source, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: programIds,
      programSourceIds: programIds,
      playbackSourceIds: programIds,
    })} />);
    now.mockReturnValue(7_600);
    expect(currentSlideshowElapsedMs(source.id)).toBe(2_600);
    expect(currentSlideshowSlideIndex(source.id, 3, 1, true)).toBe(2);

    view.rerender(<RuntimeVideoBank {...bankProps(source, { elements, mediaElements, onMediaElement: vi.fn(() => Promise.resolve()) })} />);
    now.mockReturnValue(10_000);
    expect(currentSlideshowElapsedMs(source.id)).toBe(2_600);
    view.unmount();
    forgetSlideshow(source.id);
  });
});
