import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeVideoBank } from '../../../../apps/stream/renderer/canvas-composition';
import { toRuntimeSource } from '../../../../apps/stream/renderer/source-runtime';
import { currentSourceSlideIndex, isSourceSlideAutoAdvancing, navigateSlidePlayback, resetSlidePlaybackStore } from '../../../../apps/stream/renderer/slideshow';
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
  images?: Map<string, HTMLImageElement>;
  slideshowPlaybackSources?: StreamSource[];
  referencedSourceIds?: ReadonlySet<string>;
  runtimes?: Map<string, MediaStream>;
  onSourceStatus?: (sourceId: string, status: { state: string; message?: string }) => void;
}) {
  return {
    sources: [source],
    runtimes: options.runtimes ?? new Map<string, MediaStream>(),
    elements: options.elements,
    mediaElements: options.mediaElements,
    images: options.images ?? new Map<string, HTMLImageElement>(),
    activeSourceIds: options.activeSourceIds ?? new Set<string>(),
    programSourceIds: options.programSourceIds ?? new Set<string>(),
    playbackSourceIds: options.playbackSourceIds ?? new Set<string>(),
    slideshowPlaybackSources: options.slideshowPlaybackSources,
    referencedSourceIds: options.referencedSourceIds ?? new Set([source.id]),
    onMediaElement: options.onMediaElement,
    onMediaPlaybackState: vi.fn(),
    onBrowserElement: vi.fn(),
    onSourceStatus: options.onSourceStatus,
  };
}

describe('RuntimeVideoBank media ownership', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetSlidePlaybackStore();
  });

  it('clears image event handlers before releasing a hidden image source', async () => {
    class ControllableImage {
      dataset: Record<string, string> = {};
      complete = false;
      naturalWidth = 0;
      crossOrigin: string | null = null;
      onload: ((event: Event) => unknown) | null = null;
      onerror: ((event: Event) => unknown) | null = null;
      private currentSrc = '';

      get src() { return this.currentSrc; }
      set src(value: string) {
        this.currentSrc = value;
        if (!value) {
          this.onload?.(new Event('load'));
          this.onerror?.(new Event('error'));
        }
      }
    }
    vi.stubGlobal('Image', ControllableImage as unknown as typeof Image);

    const source = toRuntimeSource({
      id: 'still',
      name: 'still',
      kind: 'image',
      visible: true,
      muted: false,
      volume: 1,
      assetId: 'image-asset',
      assetExtension: 'png',
      transform: { x: 0, y: 0, width: 100, height: 100 },
    });
    const images = new Map<string, HTMLImageElement>();
    const onSourceStatus = vi.fn();
    const view = render(<RuntimeVideoBank {...bankProps(source, {
      elements: new Map(),
      mediaElements: new Map(),
      images,
      onMediaElement: vi.fn(() => Promise.resolve()),
      onSourceStatus,
    })} />);
    await flushEffects();

    expect(images.has(source.id)).toBe(true);
    expect(onSourceStatus.mock.calls).toEqual([[source.id, { state: 'starting' }]]);
    const image = images.get(source.id)! as unknown as ControllableImage;
    view.rerender(<RuntimeVideoBank {...bankProps(source, {
      elements: new Map(),
      mediaElements: new Map(),
      images,
      onMediaElement: vi.fn(() => Promise.resolve()),
      onSourceStatus,
    })} sources={[]} />);
    await flushEffects();

    expect(images.has(source.id)).toBe(false);
    expect(image.src).toBe('');
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    expect(onSourceStatus.mock.calls).toEqual([[source.id, { state: 'starting' }]]);
  });

  it('connects once per media resource while Program playback and source settings change', async () => {
    const runtime = toRuntimeSource(mediaSource());
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const previewRoute = vi.fn((_source: ReturnType<typeof toRuntimeSource>, _element: HTMLMediaElement, _programActive: boolean) => Promise.resolve());
    const updatedRoute = vi.fn((_source: ReturnType<typeof toRuntimeSource>, _element: HTMLMediaElement, _programActive: boolean) => Promise.resolve());
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
    expect(video.currentTime).toBe(18);

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

  it.each(['video', 'audio'] as const)('resumes %s media from its paused position by default', async (mediaKind) => {
    const runtime = toRuntimeSource({ ...mediaSource(`${mediaKind}-resume`), mediaKind });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const props = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
    });
    const view = render(<RuntimeVideoBank {...props} />);
    await flushEffects();

    const element = mediaElements.get(runtime.id)!;
    expect(element).toBeTruthy();
    const programIds = new Set([runtime.id]);
    view.rerender(<RuntimeVideoBank {...bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: programIds,
      programSourceIds: programIds,
      playbackSourceIds: programIds,
    })} />);
    await flushEffects();
    Object.defineProperty(element, 'currentTime', { configurable: true, writable: true, value: 18 });

    const updatedConfig = { ...runtime, muted: true, volume: 0.4 };
    view.rerender(<RuntimeVideoBank {...bankProps(updatedConfig, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: programIds,
      programSourceIds: programIds,
      playbackSourceIds: programIds,
    })} />);
    await flushEffects();
    expect(element.currentTime).toBe(18);
    expect(play).toHaveBeenCalledOnce();

    view.rerender(<RuntimeVideoBank {...bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
    })} />);
    await flushEffects();
    expect(pause).toHaveBeenCalled();
    expect(element.currentTime).toBe(18);

    view.rerender(<RuntimeVideoBank {...bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: programIds,
      programSourceIds: programIds,
      playbackSourceIds: programIds,
    })} />);
    await flushEffects();

    expect(element.currentTime).toBe(18);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it.each(['video', 'audio'] as const)('restores %s media position after all visible aliases are removed', async (mediaKind) => {
    const runtime = toRuntimeSource({ ...mediaSource(`${mediaKind}-hidden`), mediaKind });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const ids = new Set([runtime.id]);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const props = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: ids,
      playbackSourceIds: ids,
      referencedSourceIds: ids,
    });
    const view = render(<RuntimeVideoBank {...props} />);
    await flushEffects();

    const firstElement = mediaElements.get(runtime.id)!;
    expect(play).toHaveBeenCalledOnce();
    Object.defineProperty(firstElement, 'paused', { configurable: true, value: false });
    Object.defineProperty(firstElement, 'currentTime', { configurable: true, writable: true, value: 18 });

    view.rerender(<RuntimeVideoBank {...props} sources={[]} activeSourceIds={new Set()} programSourceIds={new Set()} playbackSourceIds={new Set()} />);
    await flushEffects();
    expect(mediaElements.has(runtime.id)).toBe(false);
    expect(elements.has(runtime.id)).toBe(false);

    view.rerender(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const resumedElement = mediaElements.get(runtime.id)!;
    expect(resumedElement).toBeTruthy();
    expect(resumedElement).not.toBe(firstElement);
    expect(play).toHaveBeenCalledOnce();

    let resumedTime = 0;
    Object.defineProperty(resumedElement, 'currentTime', {
      configurable: true,
      get: () => resumedTime,
      set: (value: number) => { resumedTime = value; },
    });
    Object.defineProperty(resumedElement, 'duration', { configurable: true, value: 60 });
    resumedElement.dispatchEvent(new Event('loadedmetadata'));
    await flushEffects();

    expect(resumedElement.currentTime).toBe(18);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it.each(['video', 'audio'] as const)('clears cached %s playback state when the bank remounts', async (mediaKind) => {
    const runtime = toRuntimeSource({ ...mediaSource(`${mediaKind}-bank-remount`), mediaKind });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const ids = new Set([runtime.id]);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const props = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: ids,
      playbackSourceIds: ids,
    });
    const firstBank = render(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const first = mediaElements.get(runtime.id)!;
    Object.defineProperty(first, 'currentTime', { configurable: true, writable: true, value: 19 });
    Object.defineProperty(first, 'paused', { configurable: true, value: true });
    Object.defineProperty(first, 'ended', { configurable: true, value: true });
    firstBank.unmount();

    render(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const remounted = mediaElements.get(runtime.id)!;

    expect(remounted).not.toBe(first);
    expect(remounted.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it.each(['video', 'audio'] as const)('keeps manually paused %s media paused after hidden eviction', async (mediaKind) => {
    const runtime = toRuntimeSource({ ...mediaSource(`${mediaKind}-manual-pause`), mediaKind });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const ids = new Set([runtime.id]);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const props = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: ids,
      playbackSourceIds: ids,
      referencedSourceIds: ids,
    });
    const view = render(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const first = mediaElements.get(runtime.id)!;
    expect(play).toHaveBeenCalledOnce();
    Object.defineProperty(first, 'paused', { configurable: true, value: true });
    Object.defineProperty(first, 'currentTime', { configurable: true, writable: true, value: 17 });
    first.dispatchEvent(new Event('pause'));

    const previewOnly = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: new Set(),
      playbackSourceIds: new Set(),
      referencedSourceIds: ids,
    });
    view.rerender(<RuntimeVideoBank {...previewOnly} />);
    await flushEffects();
    view.rerender(<RuntimeVideoBank {...props} />);
    await flushEffects();
    expect(play).toHaveBeenCalledOnce();

    view.rerender(<RuntimeVideoBank {...props} sources={[]} />);
    await flushEffects();
    view.rerender(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const resumed = mediaElements.get(runtime.id)!;
    let resumedTime = 0;
    Object.defineProperty(resumed, 'paused', { configurable: true, writable: true, value: true });
    Object.defineProperty(resumed, 'currentTime', {
      configurable: true,
      get: () => resumedTime,
      set: (value: number) => { resumedTime = value; },
    });
    Object.defineProperty(resumed, 'duration', { configurable: true, value: 60 });
    resumed.dispatchEvent(new Event('loadedmetadata'));
    await flushEffects();

    expect(resumed.currentTime).toBe(17);
    expect(play).toHaveBeenCalledOnce();

    // Operator playback clears the restored pause state; later Program entry resumes normally.
    Object.defineProperty(resumed, 'paused', { configurable: true, writable: true, value: false });
    resumed.dispatchEvent(new Event('play'));
    view.rerender(<RuntimeVideoBank {...previewOnly} />);
    await flushEffects();
    Object.defineProperty(resumed, 'paused', { configurable: true, writable: true, value: true });
    view.rerender(<RuntimeVideoBank {...props} />);
    await flushEffects();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it.each(['video', 'audio'] as const)('keeps a restored paused %s state through another hide before Program activation', async (mediaKind) => {
    const runtime = toRuntimeSource({ ...mediaSource(`${mediaKind}-paused-preview`), mediaKind });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const ids = new Set([runtime.id]);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const props = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: ids,
      playbackSourceIds: ids,
      referencedSourceIds: ids,
    });
    const previewOnly = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: new Set(),
      playbackSourceIds: new Set(),
      referencedSourceIds: ids,
    });
    const view = render(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const first = mediaElements.get(runtime.id)!;
    expect(play).toHaveBeenCalledOnce();
    Object.defineProperty(first, 'paused', { configurable: true, value: true });
    Object.defineProperty(first, 'currentTime', { configurable: true, writable: true, value: 17 });
    first.dispatchEvent(new Event('pause'));

    view.rerender(<RuntimeVideoBank {...props} sources={[]} />);
    await flushEffects();
    view.rerender(<RuntimeVideoBank {...previewOnly} />);
    await flushEffects();
    const previewElement = mediaElements.get(runtime.id)!;
    let previewTime = 0;
    Object.defineProperty(previewElement, 'paused', { configurable: true, value: true });
    Object.defineProperty(previewElement, 'currentTime', {
      configurable: true,
      get: () => previewTime,
      set: (value: number) => { previewTime = value; },
    });
    Object.defineProperty(previewElement, 'duration', { configurable: true, value: 60 });
    previewElement.dispatchEvent(new Event('loadedmetadata'));
    await flushEffects();
    expect(previewElement.currentTime).toBe(17);
    expect(play).toHaveBeenCalledOnce();

    view.rerender(<RuntimeVideoBank {...previewOnly} sources={[]} />);
    await flushEffects();
    view.rerender(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const programElement = mediaElements.get(runtime.id)!;
    let programTime = 0;
    Object.defineProperty(programElement, 'paused', { configurable: true, value: true });
    Object.defineProperty(programElement, 'currentTime', {
      configurable: true,
      get: () => programTime,
      set: (value: number) => { programTime = value; },
    });
    Object.defineProperty(programElement, 'duration', { configurable: true, value: 60 });
    programElement.dispatchEvent(new Event('loadedmetadata'));
    await flushEffects();

    expect(programElement.currentTime).toBe(17);
    expect(play).toHaveBeenCalledOnce();
  });

  it.each(['video', 'audio'] as const)('keeps ended %s media at its playhead without restarting after hidden eviction', async (mediaKind) => {
    const runtime = toRuntimeSource({ ...mediaSource(`${mediaKind}-ended-hidden`), mediaKind });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const ids = new Set([runtime.id]);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const props = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: ids,
      playbackSourceIds: ids,
      referencedSourceIds: ids,
    });
    const previewOnly = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: new Set(),
      playbackSourceIds: new Set(),
      referencedSourceIds: ids,
    });
    const view = render(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const first = mediaElements.get(runtime.id)!;
    expect(play).toHaveBeenCalledOnce();
    Object.defineProperty(first, 'paused', { configurable: true, value: true });
    Object.defineProperty(first, 'ended', { configurable: true, value: true });
    Object.defineProperty(first, 'currentTime', { configurable: true, writable: true, value: 60 });

    view.rerender(<RuntimeVideoBank {...props} sources={[]} />);
    await flushEffects();
    view.rerender(<RuntimeVideoBank {...previewOnly} />);
    await flushEffects();
    const resumed = mediaElements.get(runtime.id)!;
    let resumedTime = 0;
    Object.defineProperty(resumed, 'currentTime', {
      configurable: true,
      get: () => resumedTime,
      set: (value: number) => { resumedTime = value; },
    });
    Object.defineProperty(resumed, 'duration', { configurable: true, value: 60 });
    resumed.dispatchEvent(new Event('loadedmetadata'));
    await flushEffects();

    expect(resumed.currentTime).toBe(60);
    expect(resumed.dataset.runtimeMediaEnded).toBe('true');
    expect(play).toHaveBeenCalledOnce();

    // A seek generated while restoring the saved duration is still the ended frame.
    resumed.dispatchEvent(new Event('seeking'));
    expect(resumed.dataset.runtimeMediaEnded).toBe('true');
    resumed.dispatchEvent(new Event('seeked'));
    expect(resumed.dataset.runtimeMediaEnded).toBe('true');

    // A second hide/show retains the logical ended state after the new element is mounted.
    view.rerender(<RuntimeVideoBank {...props} sources={[]} />);
    await flushEffects();
    view.rerender(<RuntimeVideoBank {...props} />);
    await flushEffects();
    const restoredAgain = mediaElements.get(runtime.id)!;
    let restoredAgainTime = 0;
    Object.defineProperty(restoredAgain, 'currentTime', {
      configurable: true,
      get: () => restoredAgainTime,
      set: (value: number) => { restoredAgainTime = value; },
    });
    Object.defineProperty(restoredAgain, 'duration', { configurable: true, value: 60 });
    restoredAgain.dispatchEvent(new Event('loadedmetadata'));
    await flushEffects();
    expect(restoredAgain.currentTime).toBe(60);
    expect(restoredAgain.dataset.runtimeMediaEnded).toBe('true');
    expect(play).toHaveBeenCalledOnce();

    // The second restoration seek keeps the ended frame; a later operator seek and play supersede it.
    restoredAgain.dispatchEvent(new Event('seeking'));
    expect(restoredAgain.dataset.runtimeMediaEnded).toBe('true');
    restoredAgain.dispatchEvent(new Event('seeked'));
    expect(restoredAgain.dataset.runtimeMediaEnded).toBe('true');
    Object.defineProperty(restoredAgain, 'ended', { configurable: true, value: false });
    restoredAgain.dispatchEvent(new Event('seeking'));
    expect(restoredAgain.dataset.runtimeMediaEnded).toBeUndefined();
    Object.defineProperty(restoredAgain, 'paused', { configurable: true, value: false });
    restoredAgain.dispatchEvent(new Event('play'));
    view.rerender(<RuntimeVideoBank {...previewOnly} />);
    await flushEffects();
    Object.defineProperty(restoredAgain, 'paused', { configurable: true, value: true });
    view.rerender(<RuntimeVideoBank {...props} />);
    await flushEffects();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it.each(['video', 'audio'] as const)('discards cached %s position after its last graph reference is deleted', async (mediaKind) => {
    const runtime = toRuntimeSource({ ...mediaSource(`${mediaKind}-deleted`), mediaKind });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const ids = new Set([runtime.id]);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const baseProps = bankProps(runtime, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids,
      programSourceIds: ids,
      playbackSourceIds: ids,
      referencedSourceIds: ids,
    });
    const view = render(<RuntimeVideoBank {...baseProps} />);
    await flushEffects();
    const firstElement = mediaElements.get(runtime.id)!;
    Object.defineProperty(firstElement, 'currentTime', { configurable: true, writable: true, value: 24 });

    view.rerender(<RuntimeVideoBank {...baseProps} sources={[]} />);
    await flushEffects();
    // The source remains in the project graph briefly while every alias is hidden.
    expect(mediaElements.has(runtime.id)).toBe(false);

    view.rerender(<RuntimeVideoBank {...{ ...baseProps, referencedSourceIds: new Set<string>() }} sources={[]} />);
    await flushEffects();
    // Removing the final graph reference drops the cache entry.
    view.rerender(<RuntimeVideoBank {...baseProps} />);
    await flushEffects();

    const restored = mediaElements.get(runtime.id)!;
    expect(restored).not.toBe(firstElement);
    expect(restored.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it.each(['video', 'audio'] as const)('resets %s media only after a real Program re-entry when enabled', async (mediaKind) => {
    const program = toRuntimeSource({ ...mediaSource(`${mediaKind}-program`, 'shared-asset'), mediaKind, restartPlaybackWhenActive: true });
    const outgoing = toRuntimeSource({ ...mediaSource(`${mediaKind}-outgoing`, 'shared-asset'), mediaKind, restartPlaybackWhenActive: true });
    expect(program.id).toBe(outgoing.id);
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const onMediaElement = vi.fn(() => Promise.resolve());
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const programCopy = { ...program, volume: 0.8 };
    const outgoingCopy = { ...outgoing, volume: 0.3 };
    const programIds = new Set([program.id]);
    const common = {
      runtimes: new Map<string, MediaStream>(),
      elements,
      mediaElements,
      images: new Map<string, HTMLImageElement>(),
      activeSourceIds: programIds,
      programSourceIds: programIds,
      playbackSourceIds: programIds,
      referencedSourceIds: programIds,
      onMediaElement,
      onMediaPlaybackState: vi.fn(),
      onBrowserElement: vi.fn(),
    };
    const view = render(<RuntimeVideoBank {...common} sources={[outgoingCopy, programCopy]} />);
    await flushEffects();

    const element = mediaElements.get(program.id)!;
    expect(element).toBeTruthy();
    expect(mediaElements.size).toBe(1);
    expect(onMediaElement).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(element.currentTime).toBe(0);
    Object.defineProperty(element, 'currentTime', { configurable: true, writable: true, value: 14 });
    Object.defineProperty(element, 'paused', { configurable: true, value: true });
    Object.defineProperty(element, 'ended', { configurable: true, value: true });

    // The outgoing resource leaves, while the same canonical runtime remains in Program.
    view.rerender(<RuntimeVideoBank {...common} sources={[programCopy]} />);
    await flushEffects();
    expect(mediaElements.get(program.id)).toBe(element);
    expect(element.currentTime).toBe(14);
    expect(play).toHaveBeenCalledOnce();

    // All aliases hide, but the lightweight cache cannot override explicit reset-on-entry.
    view.rerender(<RuntimeVideoBank {...{
      ...common,
      activeSourceIds: new Set<string>(),
      playbackSourceIds: new Set<string>(),
      programSourceIds: new Set<string>(),
    }} sources={[]} />);
    await flushEffects();
    expect(mediaElements.has(program.id)).toBe(false);
    view.rerender(<RuntimeVideoBank {...common} sources={[programCopy]} />);
    await flushEffects();

    const reenteredElement = mediaElements.get(program.id)!;
    expect(reenteredElement).not.toBe(element);
    expect(reenteredElement.currentTime).toBe(0);
    expect(reenteredElement.dataset.runtimeMediaEnded).toBeUndefined();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('keeps Preview and Program variants separate when one logical source changes asset', async () => {
    const preview = toRuntimeSource(mediaSource('shared-origin', 'preview-asset'));
    const program = toRuntimeSource(mediaSource('shared-origin', 'program-asset'));
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const onMediaElement = vi.fn((_source: ReturnType<typeof toRuntimeSource>, _element: HTMLMediaElement, _programActive: boolean) => Promise.resolve());
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

  it('reports inactive captures as ready and active captures without a stream as starting', async () => {
    const runtime = toRuntimeSource({ ...mediaSource('camera-restoring'), kind: 'camera' });
    const elements = new Map<string, HTMLVideoElement>();
    const mediaElements = new Map<string, HTMLMediaElement>();
    const onSourceStatus = vi.fn();
    const common = {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      onSourceStatus,
    };
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const view = render(<RuntimeVideoBank {...bankProps(runtime, common)} />);
    await flushEffects();

    expect(onSourceStatus).toHaveBeenLastCalledWith(runtime.id, { state: 'ready' });

    const activeIds = new Set([runtime.id]);
    view.rerender(<RuntimeVideoBank {...bankProps(runtime, { ...common, activeSourceIds: activeIds })} />);
    await flushEffects();

    expect(onSourceStatus).toHaveBeenLastCalledWith(runtime.id, { state: 'starting' });
  });

  it('reports an active capture stream with an ended video track as unavailable', async () => {
    const runtime = toRuntimeSource({ ...mediaSource('camera-ended'), kind: 'camera' });
    const endedTrack = {
      readyState: 'ended',
      muted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = { getVideoTracks: () => [endedTrack] } as unknown as MediaStream;
    const activeIds = new Set([runtime.id]);
    const onSourceStatus = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    render(<RuntimeVideoBank {...bankProps(runtime, {
      elements: new Map(),
      mediaElements: new Map(),
      runtimes: new Map([[runtime.id, stream]]),
      activeSourceIds: activeIds,
      onMediaElement: vi.fn(() => Promise.resolve()),
      onSourceStatus,
    })} />);
    await flushEffects();

    expect(onSourceStatus).toHaveBeenLastCalledWith(runtime.id, { state: 'unavailable', message: 'No live video signal is available.' });
  });

  it('starts slideshow time only in Program and preserves the shared slide cursor while inactive', () => {
    const source = toRuntimeSource({
      ...mediaSource('slideshow-origin'),
      kind: 'slideshow',
      slideshowAutoAdvance: true,
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

    expect(currentSourceSlideIndex(source)).toBe(0);

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
    expect(currentSourceSlideIndex(source)).toBe(0);
    now.mockReturnValue(7_600);
    expect(currentSourceSlideIndex(source)).toBe(2);

    view.rerender(<RuntimeVideoBank {...bankProps(source, { elements, mediaElements, onMediaElement: vi.fn(() => Promise.resolve()) })} sources={[]} />);
    now.mockReturnValue(10_000);
    expect(currentSourceSlideIndex(source)).toBe(2);

    view.rerender(<RuntimeVideoBank {...bankProps(source, {
      elements,
      mediaElements,
      onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: programIds,
      programSourceIds: programIds,
      playbackSourceIds: programIds,
    })} />);
    expect(currentSourceSlideIndex(source)).toBe(2);
    now.mockReturnValue(10_500);
    expect(currentSourceSlideIndex(source)).toBe(2);
    view.unmount();
  });

  it('does not start a Program slideshow clock when automatic playback is absent', () => {
    const source = toRuntimeSource({
      ...mediaSource('default-manual-slideshow'),
      kind: 'slideshow',
      slideshowImages: ['one', 'two'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId })),
      slideshowIntervalSeconds: 1,
    });
    const programIds = new Set([source.id]);
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const view = render(<RuntimeVideoBank {...bankProps(source, {
      elements: new Map(),
      mediaElements: new Map(),
      onMediaElement: vi.fn(() => Promise.resolve()),
      playbackSourceIds: programIds,
      slideshowPlaybackSources: [source],
    })} />);

    now.mockReturnValue(20_000);
    expect(isSourceSlideAutoAdvancing(source)).toBe(false);
    expect(currentSourceSlideIndex(source)).toBe(0);
    view.unmount();
  });

  it('shares one slide cursor across Preview, Program, and outgoing copies of the same resource', () => {
    const slideImages = ['a', 'b', 'c'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId }));
    const preview = toRuntimeSource({
      ...mediaSource('preview-slideshow'), kind: 'slideshow', slideIndex: 2, slideshowAutoAdvance: false,
      slideshowIntervalSeconds: 2, slideshowImages: slideImages,
    });
    const outgoing = toRuntimeSource({
      ...mediaSource('outgoing-slideshow'), kind: 'slideshow', slideIndex: 0, slideshowAutoAdvance: true,
      slideshowIntervalSeconds: 1, slideshowImages: slideImages,
    });
    const program = toRuntimeSource({
      ...mediaSource('program-slideshow'), kind: 'slideshow', slideIndex: 1, slideshowAutoAdvance: true,
      slideshowIntervalSeconds: 1, slideshowImages: slideImages,
    });
    expect(preview.id).toBe(outgoing.id);
    expect(outgoing.id).toBe(program.id);
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const images = new Map<string, HTMLImageElement>();
    const runtimeIds = new Set([program.id]);
    const common = {
      runtimes: new Map<string, MediaStream>(),
      elements: new Map<string, HTMLVideoElement>(),
      mediaElements: new Map<string, HTMLMediaElement>(),
      images,
      activeSourceIds: runtimeIds,
      programSourceIds: runtimeIds,
      playbackSourceIds: runtimeIds,
      referencedSourceIds: runtimeIds,
      slideshowPlaybackSources: [outgoing, program],
      onMediaElement: vi.fn(() => Promise.resolve()),
      onMediaPlaybackState: vi.fn(),
      onBrowserElement: vi.fn(),
    };
    const view = render(<RuntimeVideoBank {...common} sources={[preview, outgoing, program]} />);
    const stagedImages = [...images.values()];
    expect(stagedImages).toHaveLength(3);
    expect(currentSourceSlideIndex(preview)).toBe(1);
    expect(currentSourceSlideIndex(outgoing)).toBe(1);
    expect(currentSourceSlideIndex(program)).toBe(1);

    now.mockReturnValue(2_500);
    expect(currentSourceSlideIndex(preview)).toBe(2);
    expect(currentSourceSlideIndex(outgoing)).toBe(2);

    // Navigation from Preview updates the same live cursor and pauses autoplay.
    navigateSlidePlayback(preview, 'previous', 2_500);
    expect(currentSourceSlideIndex(preview)).toBe(1);
    expect(currentSourceSlideIndex(outgoing)).toBe(1);
    expect(currentSourceSlideIndex(program)).toBe(1);
    expect(isSourceSlideAutoAdvancing(program)).toBe(false);

    // Transition completion removes outgoing ownership, while Program keeps the same active session.
    const programOnly = { ...common, slideshowPlaybackSources: [program] };
    view.rerender(<RuntimeVideoBank {...programOnly} sources={[program]} />);
    now.mockReturnValue(5_000);
    expect(currentSourceSlideIndex(program)).toBe(1);
    expect([...images.values()]).toEqual(stagedImages);

    // Once every alias is hidden, image elements are released while the graph reference preserves the cursor.
    view.rerender(<RuntimeVideoBank {...{
      ...programOnly,
      activeSourceIds: new Set<string>(),
      programSourceIds: new Set<string>(),
      playbackSourceIds: new Set<string>(),
      slideshowPlaybackSources: [],
    }} sources={[]} />);
    expect(images.size).toBe(0);
    now.mockReturnValue(7_000);
    expect(currentSourceSlideIndex(program)).toBe(1);

    // Returning releases new image elements but resumes the same runtime cursor.
    view.rerender(<RuntimeVideoBank {...programOnly} sources={[preview, program]} />);
    expect(currentSourceSlideIndex(preview)).toBe(1);
    expect(images.size).toBe(3);
    expect([...images.values()]).not.toEqual(stagedImages);
    view.unmount();
  });

  it('resets a slideshow cursor on re-entry only when explicitly enabled', () => {
    const source = toRuntimeSource({
      ...mediaSource('reset-slideshow'), kind: 'slideshow', slideIndex: 2, restartPlaybackWhenActive: true,
      slideshowImages: ['a', 'b', 'c'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId })),
    });
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const ids = new Set([source.id]);
    const common = {
      elements: new Map<string, HTMLVideoElement>(),
      mediaElements: new Map<string, HTMLMediaElement>(),
      onMediaElement: vi.fn(() => Promise.resolve()),
    };
    const view = render(<RuntimeVideoBank {...bankProps(source, {
      ...common,
      programSourceIds: ids,
      playbackSourceIds: ids,
      slideshowPlaybackSources: [source],
    })} />);
    expect(currentSourceSlideIndex(source)).toBe(0);

    navigateSlidePlayback(source, 'next', 1_100);
    expect(currentSourceSlideIndex(source)).toBe(1);
    view.rerender(<RuntimeVideoBank {...bankProps(source, { ...common, referencedSourceIds: ids })} sources={[]} />);
    now.mockReturnValue(2_000);
    expect(currentSourceSlideIndex(source)).toBe(1);

    view.rerender(<RuntimeVideoBank {...bankProps(source, {
      ...common,
      programSourceIds: ids,
      playbackSourceIds: ids,
      slideshowPlaybackSources: [source],
    })} />);
    expect(currentSourceSlideIndex(source)).toBe(0);
    view.unmount();
  });

  it('stages presentation pages without starting automatic playback', () => {
    const source = toRuntimeSource({
      ...mediaSource('presentation'), kind: 'presentation', slideIndex: 1,
      presentationSlides: ['page-a', 'page-b'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId })),
    });
    const images = new Map<string, HTMLImageElement>();
    const ids = new Set([source.id]);
    render(<RuntimeVideoBank {...bankProps(source, {
      images, elements: new Map(), mediaElements: new Map(), onMediaElement: vi.fn(() => Promise.resolve()),
      activeSourceIds: ids, playbackSourceIds: ids, programSourceIds: ids,
    })} />);
    expect([...images.keys()]).toEqual([`${source.id}:page-a`, `${source.id}:page-b`]);
    expect(currentSourceSlideIndex(source, 100_000)).toBe(1);
  });
});
