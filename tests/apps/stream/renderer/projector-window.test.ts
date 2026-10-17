import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { closeProjectorWindow, createProjectorWindowSession, openCanvasProjector, type ProjectorWindowSession } from '../../../../apps/stream/renderer/projector-window';
import type { ProjectorKind } from '../../../../apps/stream/shared/projector';

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
  return { popup: popup as unknown as Window, popupDocument, close: () => { isClosed = true; dom.window.close(); } };
}

function createCanvas(trackStop = vi.fn()) {
  const canvas = document.createElement('canvas');
  const track = { stop: trackStop } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(canvas, 'captureStream', { value: vi.fn(() => stream) });
  return { canvas, stream, track };
}

describe('Stream projector windows', () => {
  let frames: FrameRequestCallback[];
  let sessions: ProjectorWindowSession[];

  function createSession() {
    const session = createProjectorWindowSession();
    sessions.push(session);
    return session;
  }

  beforeEach(() => {
    frames = [];
    sessions = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    sessions.forEach(closeProjectorWindow);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function runFrame() {
    const callback = frames.shift();
    callback?.(performance.now());
  }

  it.each([
    ['preview', 'lumastream-preview-projector'],
    ['program', 'lumastream-program-projector'],
  ] as Array<[ProjectorKind, string]>)('attaches the %s canvas to its own projector window', (kind, name) => {
    const { popup, popupDocument } = createPopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { canvas, stream } = createCanvas();
    const session = createSession();
    const onError = vi.fn();

    expect(openCanvasProjector(kind, canvas, 30, session, onError)).toBe(true);
    runFrame();

    const video = popupDocument.querySelector<HTMLVideoElement>(`video[data-projector-feed="${kind}"]`);
    expect(window.open).toHaveBeenCalledWith('about:blank', name, 'popup,width=1280,height=720');
    expect(video?.srcObject).toBe(stream);
    expect(video?.muted).toBe(true);
    expect(video?.autoplay).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.getAttribute('style')).toMatch(/object-fit\s*:\s*contain/);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps Program running when Preview opens and closes only Preview when its mode ends', () => {
    const programPopup = createPopup();
    const previewPopup = createPopup();
    vi.spyOn(window, 'open').mockReturnValueOnce(programPopup.popup).mockReturnValueOnce(previewPopup.popup);
    const program = createSession();
    const preview = createSession();
    const programCanvas = createCanvas();
    const previewCanvas = createCanvas();

    openCanvasProjector('program', programCanvas.canvas, 30, program, vi.fn());
    openCanvasProjector('preview', previewCanvas.canvas, 30, preview, vi.fn());
    closeProjectorWindow(preview);

    expect(program.stream).toBe(programCanvas.stream);
    expect(programCanvas.track.stop).not.toHaveBeenCalled();
    expect(previewCanvas.track.stop).toHaveBeenCalledOnce();
    expect(programPopup.popup.closed).toBe(false);
    expect(previewPopup.popup.closed).toBe(true);
  });

  it('closes the popup and leaves no stream when canvas capture fails', () => {
    const { popup } = createPopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'captureStream', { value: vi.fn(() => { throw new Error('capture failed'); }) });
    const session = createSession();
    const onError = vi.fn();

    expect(openCanvasProjector('preview', canvas, 30, session, onError)).toBe(false);
    expect(onError).toHaveBeenCalledWith('The preview output could not be shared with the projector.');
    expect(popup.closed).toBe(true);
    expect(session.stream).toBeNull();
    expect(session.popup).toBeNull();
  });

  it('stops the feed when the user closes the projector window', async () => {
    vi.useFakeTimers();
    const { popup, close } = createPopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { canvas, track } = createCanvas();
    const session = createSession();
    openCanvasProjector('program', canvas, 30, session, vi.fn());
    close();

    await vi.advanceTimersByTimeAsync(500);

    expect(track.stop).toHaveBeenCalledOnce();
    expect(session.popup).toBeNull();
    expect(session.stream).toBeNull();
  });

  it('releases the prior feed when reopening the same projector', () => {
    const { popup } = createPopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const session = createSession();
    const first = createCanvas();
    const second = createCanvas();

    openCanvasProjector('program', first.canvas, 30, session, vi.fn());
    openCanvasProjector('program', second.canvas, 30, session, vi.fn());

    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(second.track.stop).not.toHaveBeenCalled();
    expect(session.stream).toBe(second.stream);
    expect(popup.closed).toBe(false);
  });
});
