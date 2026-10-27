import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasComposition, hitTestSource } from '../../../../apps/stream/renderer/canvas-composition';
import { createDefaultProject, type SourceKind, type StreamScene } from '../../../../apps/stream/shared/desktop-api';
import { getSourceRuntimeId } from '../../../../apps/stream/renderer/source-runtime';

// Only the drawing calls the composition makes; cast to CanvasRenderingContext2D at the getContext mock boundary.
interface FakeContext {
  fillStyle: string;
  fills: Array<{ style: string; rect: [number, number, number, number] }>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
}

function createContext(): FakeContext {
  return {
    fillStyle: '#000000',
    fills: [],
    fillRect: vi.fn(function (this: FakeContext, x: number, y: number, width: number, height: number) {
      this.fills.push({ style: this.fillStyle, rect: [x, y, width, height] });
    }),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    setTransform: vi.fn(),
  };
}

function source(id: string, kind: SourceKind, transform: { x: number; y: number; width: number; height: number }, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    kind,
    visible: true,
    muted: false,
    volume: 1,
    transform,
    ...(kind === 'color' ? { color: '#ffffff' } : {}),
    ...extra,
  } as StreamScene['sources'][number];
}

describe('CanvasComposition Scene sources', () => {
  const contexts = new WeakMap<HTMLCanvasElement, FakeContext>();
  let frames: FrameRequestCallback[] = [];

  afterEach(() => {
    cleanup();
    frames = [];
    vi.restoreAllMocks();
  });

  function installCanvasMocks() {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
      if (contextId !== '2d') return null;
      let context = contexts.get(this);
      if (!context) {
        context = createContext();
        contexts.set(this, context);
      }
      return context as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    return { getContext, cancelAnimationFrame };
  }

  it('composites the referenced scene into the Scene source transform bounds', () => {
    installCanvasMocks();
    const project = createDefaultProject();
    const owner = project.scenes[0]!;
    const target: StreamScene = {
      id: 'target-scene',
      name: 'Target',
      sources: [source('target-color', 'color', { x: 10, y: 20, width: 300, height: 120 })],
    };
    owner.sources.push(source('scene-source', 'scene', { x: 120, y: 90, width: 960, height: 540 }, { referencedSceneId: target.id }));
    project.scenes.push(target);

    const { unmount } = render(<CanvasComposition
      project={project}
      scene={owner}
      videoElements={new Map()}
      imageElements={new Map()}
    />);
    act(() => frames.shift()?.(0));

    const ownerCanvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    const ownerContext = contexts.get(ownerCanvas)!;
    const [targetCanvas, x, y, width, height] = ownerContext.drawImage.mock.calls[0]! as [HTMLCanvasElement, number, number, number, number];
    expect(targetCanvas).toBeInstanceOf(HTMLCanvasElement);
    expect([x, y, width, height]).toEqual([120, 90, 960, 540]);
    expect([targetCanvas.width, targetCanvas.height]).toEqual([960, 540]);
    expect(contexts.get(targetCanvas)?.fillRect).toHaveBeenCalledWith(10, 20, 300, 120);

    unmount();
  });

  it('renders nested Scene sources recursively and does not draw hidden references', () => {
    installCanvasMocks();
    const project = createDefaultProject();
    const owner = project.scenes[0]!;
    const nested: StreamScene = {
      id: 'nested-scene',
      name: 'Nested',
      sources: [source('leaf-color', 'color', { x: 5, y: 6, width: 7, height: 8 })],
    };
    const target: StreamScene = {
      id: 'target-scene',
      name: 'Target',
      sources: [source('nested-ref', 'scene', { x: 30, y: 40, width: 500, height: 300 }, { referencedSceneId: nested.id })],
    };
    owner.sources.push(source('hidden-ref', 'scene', { x: 0, y: 0, width: 1920, height: 1080 }, { referencedSceneId: target.id, visible: false }));
    owner.sources.push(source('scene-source', 'scene', { x: 100, y: 100, width: 960, height: 540 }, { referencedSceneId: target.id }));
    project.scenes.push(target, nested);

    render(<CanvasComposition project={project} scene={owner} videoElements={new Map()} imageElements={new Map()} />);
    act(() => frames.shift()?.(0));

    const ownerCanvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    const ownerContext = contexts.get(ownerCanvas)!;
    expect(ownerContext.drawImage).toHaveBeenCalledTimes(1);
    const targetCanvas = ownerContext.drawImage.mock.calls[0]![0] as HTMLCanvasElement;
    const targetContext = contexts.get(targetCanvas)!;
    expect(targetContext.drawImage).toHaveBeenCalledTimes(1);
    const nestedCanvas = targetContext.drawImage.mock.calls[0]![0] as HTMLCanvasElement;
    expect(contexts.get(nestedCanvas)?.fillRect).toHaveBeenCalledWith(5, 6, 7, 8);
  });

  it('selects the topmost nested visual child and falls back to its group bounds', () => {
    const back = source('back', 'color', { x: 0, y: 0, width: 50, height: 50 });
    const front = source('front', 'color', { x: 20, y: 20, width: 40, height: 40 });
    const group = source('group', 'group', { x: 0, y: 0, width: 100, height: 100 }, { children: [back, front] });
    const scene = { sources: [group] } as StreamScene;

    expect(hitTestSource(scene, 30, 30)?.id).toBe('front');
    expect(hitTestSource(scene, 80, 80)?.id).toBe('group');
  });

  it('does not hit hidden group descendants or audio-only sources', () => {
    const visual = source('visual', 'color', { x: 0, y: 0, width: 100, height: 100 });
    const audio = source('audio', 'microphone', { x: 0, y: 0, width: 100, height: 100 });
    const hiddenChild = source('hidden-child', 'color', { x: 0, y: 0, width: 100, height: 100 });
    const hiddenGroup = source('hidden-group', 'group', { x: 0, y: 0, width: 100, height: 100 }, { visible: false, children: [hiddenChild] });

    expect(hitTestSource({ sources: [visual, audio] } as StreamScene, 10, 10)?.id).toBe('visual');
    expect(hitTestSource({ sources: [visual, hiddenGroup] } as StreamScene, 10, 10)?.id).toBe('visual');
  });

  it('treats Scene sources as a selectable source on the owner canvas', () => {
    const sceneSource = source('scene-ref', 'scene', { x: 10, y: 20, width: 100, height: 50 }, { referencedSceneId: 'target' });
    expect(hitTestSource({ sources: [sceneSource] } as StreamScene, 20, 30)?.id).toBe('scene-ref');
  });

  it('draws a rotated visual source around its center and hit-tests its rotated bounds', () => {
    installCanvasMocks();
    const project = createDefaultProject();
    const rotated = source('rotated-color', 'color', { x: 10, y: 20, width: 100, height: 50 }, {
      transform: { x: 10, y: 20, width: 100, height: 50, rotation: 45 },
    });
    const scene = project.scenes[0]!;
    scene.sources.push(rotated);

    render(<CanvasComposition project={project} scene={scene} videoElements={new Map()} imageElements={new Map()} />);
    act(() => frames.shift()?.(0));

    const canvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    expect(contexts.get(canvas)?.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(hitTestSource(scene, 55, 5)?.id).toBe('rotated-color');
    expect(hitTestSource(scene, 12, 2)).toBeNull();
  });

  it('draws color bars when a camera has no live video track instead of reusing its stale frame', () => {
    installCanvasMocks();
    const project = createDefaultProject();
    const camera = source('camera', 'camera', { x: 12, y: 20, width: 320, height: 180 });
    project.scenes[0]!.sources.push(camera);
    const endedTrack = { readyState: 'ended' };
    const video = {
      srcObject: { getVideoTracks: () => [endedTrack] },
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1280,
      videoHeight: 720,
      ended: false,
    } as unknown as HTMLVideoElement;

    render(<CanvasComposition
      project={project}
      scene={project.scenes[0]!}
      videoElements={new Map([[getSourceRuntimeId(camera), video]])}
      imageElements={new Map()}
    />);
    act(() => frames.shift()?.(0));

    const canvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    const context = contexts.get(canvas)!;
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.fillText).toHaveBeenCalledWith('NO SIGNAL', 172, 183.8, 308);
    expect(context.fills.some(({ style, rect }) => style === '#c0c0c0' && rect[0] === 12 && rect[1] === 20)).toBe(true);
  });

  it('draws an unavailable-asset tile inside an image source with no selected asset', () => {
    installCanvasMocks();
    const project = createDefaultProject();
    project.scenes[0]!.sources.push(source('missing-image', 'image', { x: 40, y: 30, width: 200, height: 100 }));

    render(<CanvasComposition project={project} scene={project.scenes[0]!} videoElements={new Map()} imageElements={new Map()} />);
    act(() => frames.shift()?.(0));

    const canvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    expect(contexts.get(canvas)?.fillText).toHaveBeenCalledWith('Image unavailable', 140, 112, 188);
  });

  it('draws an unavailable-asset tile for a video source before its media element is available', () => {
    installCanvasMocks();
    const project = createDefaultProject();
    project.scenes[0]!.sources.push(source('video', 'media', { x: 40, y: 30, width: 200, height: 100 }, { mediaKind: 'video', assetId: 'clip' }));

    render(<CanvasComposition project={project} scene={project.scenes[0]!} videoElements={new Map()} imageElements={new Map()} />);
    act(() => frames.shift()?.(0));

    const canvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    expect(contexts.get(canvas)?.fillText).toHaveBeenCalledWith('Media unavailable', 140, 112, 188);
  });

  it('renders the outgoing scene from its frozen nested project graph during a fade', () => {
    installCanvasMocks();
    vi.spyOn(performance, 'now').mockReturnValue(500);
    const project = createDefaultProject();
    const currentOwner: StreamScene = {
      id: 'shared-owner',
      name: 'Current owner',
      sources: [source('current-ref', 'scene', { x: 0, y: 0, width: 400, height: 240 }, { referencedSceneId: 'shared-target' })],
    };
    const currentTarget: StreamScene = {
      id: 'shared-target',
      name: 'Current target',
      sources: [source('current-color', 'color', { x: 10, y: 20, width: 50, height: 40 }, { color: '#123456' })],
    };
    const outgoingOwner: StreamScene = {
      id: 'shared-owner',
      name: 'Outgoing owner',
      sources: [source('outgoing-ref', 'scene', { x: 0, y: 0, width: 400, height: 240 }, { referencedSceneId: 'shared-target' })],
    };
    const outgoingTarget: StreamScene = {
      id: 'shared-target',
      name: 'Outgoing target',
      sources: [source('outgoing-color', 'color', { x: 10, y: 20, width: 50, height: 40 }, { color: '#abcdef' })],
    };
    project.scenes = [currentOwner, currentTarget];
    const outgoingProject = { ...project, scenes: [outgoingOwner, outgoingTarget] };

    render(<CanvasComposition
      project={project}
      scene={currentOwner}
      outgoingProject={outgoingProject}
      outgoingScene={outgoingOwner}
      videoElements={new Map()}
      imageElements={new Map()}
      transition={{ type: 'Fade', fromSceneId: outgoingOwner.id, startedAt: 0, durationMs: 1_000 }}
    />);
    act(() => frames.shift()?.(0));

    const canvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    const nestedCanvases = contexts.get(canvas)!.drawImage.mock.calls.map(([nested]) => nested as HTMLCanvasElement);
    expect(nestedCanvases).toHaveLength(2);
    const nestedFills = nestedCanvases.map((nested) => contexts.get(nested)!.fills.map(({ style }) => style));
    expect(nestedFills).toEqual(expect.arrayContaining([
      expect.arrayContaining(['#abcdef']),
      expect.arrayContaining(['#123456']),
    ]));
  });

  it('does not allocate a drawing context while rendering is disabled', () => {
    installCanvasMocks();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const project = createDefaultProject();

    render(<CanvasComposition project={project} scene={project.scenes[0]!} videoElements={new Map()} imageElements={new Map()} renderEnabled={false} />);

    expect(getContext).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  it('caps thumbnail redraws without slowing the default composition rate', () => {
    installCanvasMocks();
    const project = createDefaultProject();
    project.scenes[0]!.sources.push(source('fill', 'color', { x: 0, y: 0, width: 100, height: 100 }));

    render(<CanvasComposition project={project} scene={project.scenes[0]!} videoElements={new Map()} imageElements={new Map()} maxFrameRate={10} />);
    const canvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    const context = contexts.get(canvas)!;

    act(() => frames.shift()?.(0));
    const firstFrameFillCount = context.fillRect.mock.calls.length;
    act(() => frames.shift()?.(30));
    expect(context.fillRect).toHaveBeenCalledTimes(firstFrameFillCount);
    act(() => frames.shift()?.(100));
    expect(context.fillRect).toHaveBeenCalledTimes(firstFrameFillCount * 2);
  });

  it('keeps the animation loop and bitmap when the transition callback identity changes', () => {
    const { getContext, cancelAnimationFrame } = installCanvasMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const project = createDefaultProject();
    const scene = project.scenes[0]!;
    const originalCallback = vi.fn();
    const latestCallback = vi.fn();
    const props = {
      project,
      scene,
      videoElements: new Map<string, HTMLVideoElement>(),
      imageElements: new Map<string, HTMLImageElement>(),
      transition: { type: 'Fade' as const, fromSceneId: scene.id, startedAt: 0, durationMs: 1_000 },
    };
    const view = render(<CanvasComposition {...props} onTransitionEnd={originalCallback} />);
    const canvas = document.querySelector<HTMLCanvasElement>('.composition-canvas')!;
    const initialWidth = canvas.width;
    const initialHeight = canvas.height;
    const widthSetter = vi.spyOn(canvas, 'width', 'set');
    const heightSetter = vi.spyOn(canvas, 'height', 'set');
    const initialContextCalls = getContext.mock.calls.length;

    view.rerender(<CanvasComposition {...props} onTransitionEnd={latestCallback} />);

    expect(frames).toHaveLength(1);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(getContext).toHaveBeenCalledTimes(initialContextCalls);
    expect(widthSetter).not.toHaveBeenCalled();
    expect(heightSetter).not.toHaveBeenCalled();
    expect([canvas.width, canvas.height]).toEqual([initialWidth, initialHeight]);

    act(() => frames.shift()?.(1_000));
    expect(originalCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(1);
  });
});
