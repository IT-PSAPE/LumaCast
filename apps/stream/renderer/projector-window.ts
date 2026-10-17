import { PROJECTOR_WINDOW_NAMES, type ProjectorKind } from '../shared/projector';

export interface ProjectorWindowSession {
  popup: Window | null;
  stream: MediaStream | null;
  animationFrameId: number | null;
  watcherId: number | null;
  generation: number;
}

export function createProjectorWindowSession(): ProjectorWindowSession {
  return { popup: null, stream: null, animationFrameId: null, watcherId: null, generation: 0 };
}

function stopProjectorFeed(session: ProjectorWindowSession): void {
  session.generation += 1;
  if (session.animationFrameId !== null) window.cancelAnimationFrame(session.animationFrameId);
  if (session.watcherId !== null) window.clearInterval(session.watcherId);
  session.animationFrameId = null;
  session.watcherId = null;
  for (const track of session.stream?.getTracks() ?? []) track.stop();
  session.stream = null;
}

export function closeProjectorWindow(session: ProjectorWindowSession): void {
  const popup = session.popup;
  stopProjectorFeed(session);
  session.popup = null;
  if (popup && !popup.closed) {
    try { popup.close(); } catch { /* The popup may have closed between the check and close. */ }
  }
}

export function openCanvasProjector(
  kind: ProjectorKind,
  canvas: HTMLCanvasElement,
  frameRate: number,
  session: ProjectorWindowSession,
  onError: (message: string) => void,
): boolean {
  const label = kind === 'preview' ? 'preview' : 'program';
  const popup = window.open('about:blank', PROJECTOR_WINDOW_NAMES[kind], 'popup,width=1280,height=720');
  if (!popup) {
    onError(`The ${label} projector could not be opened.`);
    return false;
  }

  stopProjectorFeed(session);
  session.popup = popup;
  const generation = session.generation;
  let projectorDocument: Document;
  try {
    projectorDocument = popup.document;
    projectorDocument.title = `LumaStream ${kind === 'preview' ? 'Preview' : 'Program'}`;
    projectorDocument.documentElement.setAttribute('style', 'width:100%;height:100%;overflow:hidden;background:#000');
    projectorDocument.body.setAttribute('style', 'width:100%;height:100%;margin:0;overflow:hidden;background:#000');
    const projectorVideo = projectorDocument.createElement('video');
    projectorVideo.dataset.projectorFeed = kind;
    projectorVideo.autoplay = true;
    projectorVideo.muted = true;
    projectorVideo.playsInline = true;
    projectorVideo.setAttribute('style', 'display:block;width:100%;height:100%;background:#000;object-fit:contain');
    projectorVideo.addEventListener('dblclick', () => {
      if (projectorDocument.fullscreenElement) void projectorDocument.exitFullscreen().catch(() => undefined);
      else void projectorDocument.documentElement.requestFullscreen().catch(() => undefined);
    });
    projectorDocument.body.replaceChildren(projectorVideo);
  } catch {
    onError(`The ${label} projector could not be initialized.`);
    closeProjectorWindow(session);
    return false;
  }

  try { popup.focus(); } catch { /* Focus can be denied while the popup is closing. */ }

  let output: MediaStream;
  try { output = canvas.captureStream(frameRate); }
  catch {
    onError(`The ${label} output could not be shared with the projector.`);
    closeProjectorWindow(session);
    return false;
  }

  session.stream = output;
  const deadline = Date.now() + 8000;
  const attachOutput = () => {
    if (session.generation !== generation || session.popup !== popup) return;
    if (popup.closed) {
      closeProjectorWindow(session);
      return;
    }
    let attached = false;
    try {
      const video = popup.document.querySelector<HTMLVideoElement>(`[data-projector-feed="${kind}"]`);
      if (video) {
        video.srcObject = output;
        void video.play().catch(() => undefined);
        attached = true;
      }
    } catch {
      onError(`The ${label} projector could not connect to the output.`);
      closeProjectorWindow(session);
      return;
    }
    if (attached) {
      session.animationFrameId = null;
      return;
    }
    if (Date.now() >= deadline) {
      onError(`The ${label} projector did not become ready.`);
      closeProjectorWindow(session);
      return;
    }
    session.animationFrameId = window.requestAnimationFrame(attachOutput);
  };
  session.animationFrameId = window.requestAnimationFrame(attachOutput);
  const watcherId = window.setInterval(() => {
    if (!popup.closed) return;
    if (session.popup !== popup || session.generation !== generation) {
      window.clearInterval(watcherId);
      return;
    }
    closeProjectorWindow(session);
  }, 500);
  session.watcherId = watcherId;
  return true;
}
