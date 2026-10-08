import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { NdiGpuSceneSnapshot } from '@lumacast/protocol';
import { NdiGpuView, synchronizeLayerVideo } from '../../../../../apps/cast/renderer/output/ndi-gpu-view';

const mocks = vi.hoisted(() => ({
  video: null as HTMLVideoElement | null,
  listener: null as (() => void) | null,
  draw: vi.fn(),
}));
vi.mock('@lumacast/canvas', () => ({
  BindingProvider: ({ children }: { children: React.ReactNode }) => children,
  SceneOutputStage: (props: { width: number; height: number; redrawVersion?: number; onDraw(): void }) => {
    mocks.draw(props);
    return <div data-testid="stage" data-width={props.width} data-redraw={props.redrawVersion} />;
  },
  retainVideoSource: () => ({ release: vi.fn() }),
  getLayerVideoElement: () => mocks.video,
  subscribeToVideoPool: (listener: () => void) => { mocks.listener = listener; return () => { mocks.listener = null; }; },
}));

const scene = { width: 1920, height: 1080, slide: { id: 'slide' }, nodes: [] } as unknown as NdiGpuSceneSnapshot['scene'];
const binding = { currentSlideText: null, nextSlideText: null, slideNotes: null, timerReadings: {} };
function snapshot(revisionId: string, playing = false, time = 7): NdiGpuSceneSnapshot {
  return { name: 'audience', revisionId, scene, binding,
    layerVideo: { src: '/clip.mp4', currentTime: time, playing, loop: true, playbackRate: 1.25, observedAtMs: Date.now() } };
}
function videoElement(readyState: number): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'readyState', { configurable: true, value: readyState });
  Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn();
  return video;
}
let emit: (snapshot: NdiGpuSceneSnapshot) => void;
const ready = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); mocks.video = null; mocks.listener = null;
  Object.defineProperty(window, 'ndiGpuApi', { configurable: true, value: {
    onScene(callback: typeof emit) { emit = callback; return vi.fn(); }, ready,
  } });
});
afterEach(cleanup);

describe('NDI GPU output view', () => {
  it('keeps scene identity for video-only updates and applies the latest paused seek after video load', () => {
    const view = render(<NdiGpuView />);
    expect(ready).toHaveBeenCalledWith();
    act(() => emit(snapshot('revision:1', false, 4)));
    const firstScene = mocks.draw.mock.lastCall?.[0].scene;
    act(() => emit(snapshot('revision:1', false, 7)));
    expect(mocks.draw.mock.lastCall?.[0].scene).toBe(firstScene);
    const video = videoElement(HTMLMediaElement.HAVE_CURRENT_DATA);
    mocks.video = video;
    act(() => mocks.listener?.());
    expect(video.currentTime).toBe(7);
    expect(video.play).not.toHaveBeenCalled();
    act(() => video.dispatchEvent(new Event('seeked')));
    expect(Number(view.getByTestId('stage').getAttribute('data-redraw'))).toBeGreaterThan(0);
  });

  it('updates stage dimensions when the offscreen content size changes', () => {
    const view = render(<NdiGpuView />);
    act(() => emit({ ...snapshot('revision:2'), layerVideo: null }));
    const original = Number(view.getByTestId('stage').getAttribute('data-width'));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: original + 5 });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(view.getByTestId('stage').getAttribute('data-width')).toBe(String(original + 5));
  });
});

describe('synchronizeLayerVideo', () => {
  it('waits for metadata and then seeks and plays without restarting an already playing video', () => {
    const video = videoElement(HTMLMediaElement.HAVE_NOTHING);
    const state = snapshot('revision:3', true, 3).layerVideo!;
    expect(synchronizeLayerVideo(video, state, state.observedAtMs + 1000)).toBe(false);
    expect(video.play).not.toHaveBeenCalled();
    Object.defineProperty(video, 'readyState', { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA });
    expect(synchronizeLayerVideo(video, state, state.observedAtMs + 1000)).toBe(true);
    expect(video.currentTime).toBeCloseTo(4.25);
    expect(video.play).toHaveBeenCalledTimes(1);
  });
});
