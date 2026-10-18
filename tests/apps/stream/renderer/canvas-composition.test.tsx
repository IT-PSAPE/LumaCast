import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasComposition, hitTestSource } from '../../../../apps/stream/renderer/canvas-composition';
import { createDefaultProject, type SourceKind, type StreamScene } from '../../../../apps/stream/shared/desktop-api';

interface FakeContext extends Partial<CanvasRenderingContext2D> {
  fillRect: ReturnType<typeof vi.fn>;
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
    fillRect: vi.fn(),
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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
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
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
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
});
