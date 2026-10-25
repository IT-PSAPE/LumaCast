import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openMultiviewWindow, type MultiviewWindowControl, type MultiviewWindowSource } from '../../../../apps/stream/renderer/multiview-window';
import { computeMultiviewLayout } from '../../../../apps/stream/renderer/multiview-layout';
import { PROJECTOR_WINDOW_NAMES } from '../../../../apps/stream/shared/projector';

function createPopup() {
  const dom = new JSDOM();
  const popupDocument = dom.window.document;
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'play', { value: vi.fn().mockResolvedValue(undefined), configurable: true });
  let isClosed = false;
  const popup = {
    document: popupDocument,
    focus: vi.fn(),
    close: vi.fn(() => { isClosed = true; dom.window.close(); }),
  };
  Object.defineProperty(popup, 'closed', { get: () => isClosed });
  return {
    window: popup as unknown as Window,
    document: popupDocument,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    forceClose: () => { isClosed = true; dom.window.close(); },
  };
}

function createSource(sceneIds: string[]): MultiviewWindowSource {
  return {
    getCanvas: () => null,
    scenes: () => sceneIds.map((id, index) => ({ id, name: `Scene ${index + 1}`, isPreview: index === 0, isProgram: index === 1 })),
  };
}

function stubRect(video: HTMLVideoElement, width: number, height: number): void {
  video.getBoundingClientRect = () => ({
    width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON() { return {}; },
  });
}

// Narrow cast at the fake boundary: the window only issues drawing calls and sets style
// properties, so a Proxy that swallows every method call is a faithful stand-in.
const drawingSink = new Proxy({}, { get: (_target, property) => (property === 'canvas' ? undefined : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;

describe('Stream multiview window', () => {
  let frames: FrameRequestCallback[];
  let controls: MultiviewWindowControl[];
  let capturedStream: MediaStream;
  let capturedTrackStop: ReturnType<typeof vi.fn>;
  let captureStreamSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    frames = [];
    controls = [];
    capturedTrackStop = vi.fn();
    const track = { stop: capturedTrackStop } as unknown as MediaStreamTrack;
    capturedStream = { getTracks: () => [track] } as unknown as MediaStream;
    captureStreamSpy = vi.fn(() => capturedStream);
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { value: captureStreamSpy, configurable: true });
    // jsdom has no canvas backend, so getContext('2d') returns null and the window skips
    // drawFrame (and with it the layout used for hit-testing). Provide a drawing-call sink.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => drawingSink);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    controls.forEach((control) => control.close());
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'captureStream');
  });

  function runFrame() {
    const callback = frames.shift();
    callback?.(performance.now());
  }

  function open(source: MultiviewWindowSource, options?: { width?: number; height?: number; frameRate?: number }) {
    const popup = createPopup();
    vi.spyOn(window, 'open').mockReturnValue(popup.window);
    const onSelectScene = vi.fn();
    const onTransitionToScene = vi.fn();
    const onClosed = vi.fn();
    const control = openMultiviewWindow(source, { onSelectScene, onTransitionToScene, onClosed }, options);
    controls.push(control);
    return { control, popup, onSelectScene, onTransitionToScene, onClosed };
  }

  it('opens an about:blank popup named for multiview and wires a video feed from the composite canvas', () => {
    const { popup } = open(createSource(['scene-1', 'scene-2']));
    runFrame();

    expect(window.open).toHaveBeenCalledWith('about:blank', PROJECTOR_WINDOW_NAMES.multiview, 'popup,width=1280,height=720');
    expect(captureStreamSpy).toHaveBeenCalledWith(30);
    expect(popup.document.title).toBe('LumaStream Multiview');

    const video = popup.document.querySelector<HTMLVideoElement>('[data-multiview-feed]');
    expect(video?.srcObject).toBe(capturedStream);
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.getAttribute('style')).toMatch(/object-fit\s*:\s*contain/);
  });

  it('honors custom width, height and frame rate options', () => {
    open(createSource([]), { width: 1920, height: 1080, frameRate: 60 });
    runFrame();
    expect(captureStreamSpy).toHaveBeenCalledWith(60);
  });

  it('selects a scene on click and transitions to it on double click, using the layout module to locate the tile', () => {
    const sceneIds = ['scene-1', 'scene-2', 'scene-3'];
    const { popup, onSelectScene, onTransitionToScene } = open(createSource(sceneIds));
    runFrame();

    const video = popup.document.querySelector<HTMLVideoElement>('[data-multiview-feed]')!;
    stubRect(video, 1280, 720);

    const tiles = computeMultiviewLayout(1280, 720, sceneIds);
    const sceneTile = tiles.find((tile) => tile.kind === 'scene' && tile.sceneId === 'scene-2')!;
    const clientX = sceneTile.x + Math.floor(sceneTile.width / 2);
    const clientY = sceneTile.y + Math.floor(sceneTile.height / 2);

    video.dispatchEvent(new popup.MouseEvent('click', { clientX, clientY, bubbles: true }));
    expect(onSelectScene).toHaveBeenCalledWith('scene-2');
    expect(onTransitionToScene).not.toHaveBeenCalled();

    video.dispatchEvent(new popup.MouseEvent('dblclick', { clientX, clientY, bubbles: true }));
    expect(onTransitionToScene).toHaveBeenCalledWith('scene-2');
  });

  it('ignores clicks on the Preview and Program panes', () => {
    const { popup, onSelectScene, onTransitionToScene } = open(createSource(['scene-1']));
    runFrame();

    const video = popup.document.querySelector<HTMLVideoElement>('[data-multiview-feed]')!;
    stubRect(video, 1280, 720);

    const tiles = computeMultiviewLayout(1280, 720, ['scene-1']);
    const previewTile = tiles.find((tile) => tile.kind === 'preview')!;
    const clientX = previewTile.x + Math.floor(previewTile.width / 2);
    const clientY = previewTile.y + Math.floor(previewTile.height / 2);

    video.dispatchEvent(new popup.MouseEvent('click', { clientX, clientY, bubbles: true }));
    video.dispatchEvent(new popup.MouseEvent('dblclick', { clientX, clientY, bubbles: true }));
    expect(onSelectScene).not.toHaveBeenCalled();
    expect(onTransitionToScene).not.toHaveBeenCalled();
  });

  it('ignores a click that falls in the gutter between tiles', () => {
    const { popup, onSelectScene } = open(createSource(['scene-1', 'scene-2']));
    runFrame();

    const video = popup.document.querySelector<HTMLVideoElement>('[data-multiview-feed]')!;
    stubRect(video, 1280, 720);

    const tiles = computeMultiviewLayout(1280, 720, ['scene-1', 'scene-2']);
    const preview = tiles.find((tile) => tile.kind === 'preview')!;
    const program = tiles.find((tile) => tile.kind === 'program')!;
    const gutterX = Math.floor((preview.x + preview.width + program.x) / 2);

    video.dispatchEvent(new popup.MouseEvent('click', { clientX: gutterX, clientY: preview.y + 1, bubbles: true }));
    expect(onSelectScene).not.toHaveBeenCalled();
  });

  it('closes on Escape and calls onClosed exactly once', () => {
    const { popup, onClosed, control } = open(createSource(['scene-1']));
    runFrame();

    popup.document.dispatchEvent(new popup.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect((popup.window as unknown as { closed: boolean }).closed).toBe(true);
    expect(onClosed).toHaveBeenCalledOnce();
    expect(control.isOpen()).toBe(false);

    // A second Escape (or any other trigger) must not notify again.
    popup.document.dispatchEvent(new popup.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('stops the feed and notifies onClosed once when the user closes the popup directly', async () => {
    vi.useFakeTimers();
    const { popup, onClosed } = open(createSource(['scene-1']));
    runFrame();

    popup.forceClose();
    await vi.advanceTimersByTimeAsync(500);

    expect(capturedTrackStop).toHaveBeenCalledOnce();
    expect(onClosed).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('close() tears down tracks and the popup without notifying onClosed', () => {
    const { popup, control, onClosed } = open(createSource(['scene-1']));
    runFrame();

    control.close();

    expect((popup.window as unknown as { closed: boolean }).closed).toBe(true);
    expect(capturedTrackStop).toHaveBeenCalledOnce();
    expect(onClosed).not.toHaveBeenCalled();
    expect(control.isOpen()).toBe(false);

    // Idempotent: closing again does nothing further.
    control.close();
    expect(capturedTrackStop).toHaveBeenCalledOnce();
  });

  it('throws a clear error when the popup is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => openMultiviewWindow(createSource([]), { onSelectScene: vi.fn(), onTransitionToScene: vi.fn(), onClosed: vi.fn() }))
      .toThrow(/multiview window could not be opened/i);
  });
});
