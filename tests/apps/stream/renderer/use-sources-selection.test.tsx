import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSources, type UseSourcesParams } from '../../../../apps/stream/renderer/features/sources/use-sources';
import { slideshowImageElementKey } from '../../../../apps/stream/renderer/slideshow';
import { flattenSourceNodes } from '../../../../apps/stream/shared/source-tree';
import { createDefaultProject, type StreamAPI, type StreamProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';

function makeSource(id: string, x: number, overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id,
    name: id,
    kind: 'display',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x, y: 10, width: 20, height: 20 },
    ...overrides,
  };
}

function makeProject(sources: StreamSource[]): StreamProject {
  const project = createDefaultProject();
  project.activeSceneId = 'scene';
  project.liveSceneId = 'scene';
  project.scenes = [{ id: 'scene', name: 'Scene', sources }];
  project.output.baseWidth = 100;
  project.output.baseHeight = 100;
  project.output.width = 100;
  project.output.height = 100;
  return project;
}

function setup(sources: StreamSource[], platform: StreamAPI['platform'] = 'win32', elements: {
  images?: Map<string, HTMLImageElement>;
  videos?: Map<string, HTMLVideoElement>;
} = {}) {
  const stopRuntime = vi.fn();
  const setterCalls = { count: 0 };
  const videoElements = elements.videos ?? new Map<string, HTMLVideoElement>();
  const imageElements = elements.images ?? new Map<string, HTMLImageElement>();
  const { result } = renderHook(() => {
    const [project, setProject] = useState<StreamProject | null>(() => makeProject(sources));
    const projectRef = useRef(project);
    projectRef.current = project;
    const updateProject = (update: (current: StreamProject) => StreamProject) => {
      setterCalls.count += 1;
      setProject((current) => current ? update(current) : current);
    };
    const scene = project?.scenes[0] ?? null;
    const sourcesState = useSources({
      api: { platform } as StreamAPI,
      project,
      projectRef,
      allSources: scene ? flattenSourceNodes(scene.sources) : [],
      activeScene: scene,
      liveScene: scene,
      setProjectValue: updateProject,
      setActionError: vi.fn(),
      working: false,
      setWorking: vi.fn(),
      videoElements: useRef(videoElements),
      imageElements: useRef(imageElements),
      mediaElements: useRef(new Map()),
      runtimes: useRef(new Map()),
      mixer: useRef(null),
      applicationAudioInputs: useRef(new Map()),
      applicationAudioSessions: useRef(new Map()),
      attachRuntime: vi.fn(),
      stopRuntime,
      startApplicationAudioRuntime: vi.fn(),
      startSystemAudioRuntime: vi.fn(),
      clearNoiseSuppressionPreference: vi.fn(),
    } satisfies UseSourcesParams);
    return { project, replaceProject: setProject, sources: sourcesState };
  });
  return { result, stopRuntime, setterCalls, videoElements, imageElements };
}

function pointerEvent(target: HTMLDivElement, values: Partial<PointerEvent> = {}) {
  return {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target,
    currentTarget: target,
    ...values,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

function stage() {
  const target = document.createElement('div');
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
  target.hasPointerCapture = () => false;
  target.setPointerCapture = vi.fn();
  return target;
}

function resizeHandle(handle: string): HTMLElement {
  const element = document.createElement('span');
  element.setAttribute('data-resize-handle', handle);
  return element;
}

function imageWithSize(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height, complete: true } as HTMLImageElement;
}

describe('useSources shared selection behavior', () => {
  it('supports plain, range and modifier selection while retaining collapsed descendants', () => {
    const group = makeSource('group', 0, {
      kind: 'group',
      children: [makeSource('child-a', 0), makeSource('child-b', 30)],
      transform: { x: 0, y: 10, width: 50, height: 20 },
    });
    const { result } = setup([makeSource('first', 60), group, makeSource('last', 80)]);

    act(() => result.current.sources.selectSourceRow({ type: 'click' }, 'first'));
    act(() => result.current.sources.selectSourceRow({ type: 'click', shiftKey: true }, 'last'));
    expect(result.current.sources.selectedSourceIds).toEqual(['last', 'group', 'child-b', 'child-a', 'first']);

    act(() => result.current.sources.selectSource('child-a'));
    act(() => result.current.sources.setCollapsedGroupIds(['group']));
    act(() => result.current.sources.selectSourceRow({ type: 'click', ctrlKey: true }, 'last'));
    expect(result.current.sources.selectedSourceIds).toContain('child-a');
    expect(result.current.sources.selectedSourceIds).toContain('last');

    act(() => result.current.sources.selectSourceRow({ type: 'click', metaKey: true }, 'last'));
    expect(result.current.sources.selectedSourceIds).toContain('child-a');
    expect(result.current.sources.selectedSourceIds).not.toContain('last');
  });

  it('preserves multi-selection on plain canvas press and moves every movable member from the gesture origin', () => {
    const { result } = setup([makeSource('first', 0), makeSource('second', 40)]);
    const target = stage();
    const pointerDown = (x: number, modifiers: Partial<PointerEvent> = {}) => act(() => {
      result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: x, clientY: 15, ...modifiers }), result.current.project!.scenes[0]!);
    });
    const pointerUp = () => act(() => result.current.sources.handleStagePointerUp(pointerEvent(target)));

    pointerDown(5);
    pointerUp();
    pointerDown(45, { ctrlKey: true });
    pointerUp();
    expect(result.current.sources.selectedSourceIds).toEqual(['second', 'first']);

    pointerDown(5);
    expect(result.current.sources.selectedSourceIds).toEqual(['second', 'first']);
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 15, clientY: 15 })));
    expect(result.current.project?.scenes[0]?.sources.map((item) => item.transform.x)).toEqual([10, 50]);
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 25, clientY: 15 })));
    expect(result.current.project?.scenes[0]?.sources.map((item) => item.transform.x)).toEqual([20, 60]);
    pointerUp();
  });

  it('preserves concurrent source edits and additions during a canvas drag', () => {
    const { result } = setup([makeSource('first', 0), makeSource('second', 40)]);
    const target = stage();
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 5, clientY: 15 }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 15, clientY: 15 })));

    act(() => result.current.replaceProject((current) => current ? ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id !== 'scene' ? scene : ({
        ...scene,
        sources: [
          ...scene.sources.map((source) => source.id === 'second'
            ? { ...source, name: 'Updated second', visible: false, muted: true }
            : source),
          makeSource('added-during-drag', 80),
        ],
      })),
    }) : current));

    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 25, clientY: 15 })));

    const sources = result.current.project?.scenes[0]?.sources;
    expect(sources?.map((source) => source.id)).toEqual(['first', 'second', 'added-during-drag']);
    expect(sources?.map((source) => source.transform.x)).toEqual([20, 40, 80]);
    expect(sources?.[1]).toMatchObject({ name: 'Updated second', visible: false, muted: true });
  });

  it('does not resurrect a selected source deleted during a canvas drag', () => {
    const { result } = setup([makeSource('first', 0), makeSource('second', 40)]);
    const target = stage();
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 5, clientY: 15 }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 15, clientY: 15 })));

    act(() => result.current.replaceProject((current) => current ? ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id !== 'scene' ? scene : ({
        ...scene,
        sources: scene.sources.filter((source) => source.id !== 'first'),
      })),
    }) : current));

    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 25, clientY: 15 })));

    expect(result.current.project?.scenes[0]?.sources.map((source) => source.id)).toEqual(['second']);
  });

  it('stops applying later drag deltas to members that become locked or hidden', () => {
    const { result } = setup([makeSource('first', 0), makeSource('second', 40)]);
    const target = stage();
    act(() => result.current.sources.selectSourceRow({ type: 'click' }, 'first'));
    act(() => result.current.sources.selectSourceRow({ type: 'click', ctrlKey: true }, 'second'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 5, clientY: 15 }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 15, clientY: 15 })));

    act(() => result.current.replaceProject((current) => current ? ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id !== 'scene' ? scene : ({
        ...scene,
        sources: scene.sources.map((source) => source.id === 'first'
          ? { ...source, visible: false }
          : source.id === 'second' ? { ...source, locked: true } : source),
      })),
    }) : current));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 25, clientY: 15 })));

    expect(result.current.project?.scenes[0]?.sources.map((source) => source.transform.x)).toEqual([10, 50]);
  });

  it('copies the explicitly requested secondary source without changing the multi-selection', async () => {
    const { result } = setup([makeSource('first', 0), makeSource('second', 40)]);
    act(() => result.current.sources.selectSourceRow({ type: 'click' }, 'first'));
    act(() => result.current.sources.selectSourceRow({ type: 'click', ctrlKey: true }, 'second'));

    act(() => result.current.sources.copySelectedSource('second'));
    expect(result.current.sources.selectedSourceIds).toEqual(['second', 'first']);
    await act(async () => { await result.current.sources.pasteSource(); });

    expect(result.current.project?.scenes[0]?.sources.at(-1)?.name).toBe('Copy of second');
  });

  it('ungroups the explicitly requested secondary group instead of the primary group', () => {
    const groupA = makeSource('group-a', 0, { kind: 'group', children: [makeSource('child-a', 0)] });
    const groupB = makeSource('group-b', 40, { kind: 'group', children: [makeSource('child-b', 40)] });
    const { result } = setup([groupA, groupB]);
    act(() => result.current.sources.selectSourceRow({ type: 'click' }, 'group-a'));
    act(() => result.current.sources.selectSourceRow({ type: 'click', ctrlKey: true }, 'group-b'));

    act(() => result.current.sources.ungroupSelectedSource('group-b'));

    expect(result.current.project?.scenes[0]?.sources.map((source) => source.id)).toEqual(['group-a', 'child-b']);
    expect(result.current.sources.selectedSourceId).toBe('child-b');
  });

  it('ignores non-primary canvas presses and keeps locked source selection transform-only', () => {
    const { result } = setup([makeSource('locked', 0, { locked: true })]);
    const target = stage();
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { button: 2, clientX: 5, clientY: 15 }), result.current.project!.scenes[0]!));
    expect(result.current.sources.selectedSourceIds).toEqual([]);
    expect(target.setPointerCapture).not.toHaveBeenCalled();

    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 5, clientY: 15 }), result.current.project!.scenes[0]!));
    expect(result.current.sources.selectedSourceIds).toEqual(['locked']);
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 25, clientY: 15 })));
    expect(result.current.project?.scenes[0]?.sources[0]?.transform.x).toBe(0);
  });

  it('drags a selected group from its canvas bounds while leaving its locked child in place', () => {
    const movable = makeSource('movable', 0);
    const locked = makeSource('locked-child', 40, { locked: true });
    const group = makeSource('group', 0, {
      kind: 'group',
      children: [movable, locked],
      transform: { x: 0, y: 10, width: 60, height: 20 },
    });
    const { result } = setup([group]);
    const target = stage();
    act(() => result.current.sources.selectSource('group'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 30, clientY: 15 }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 40, clientY: 15 })));
    act(() => result.current.replaceProject((current) => current ? ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id !== 'scene' ? scene : ({
        ...scene,
        sources: scene.sources.map((source) => source.id === 'group' && source.kind === 'group'
          ? { ...source, children: [...(source.children ?? []), makeSource('new-child', 80)] }
          : source),
      })),
    }) : current));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 50, clientY: 15 })));

    const movedGroup = result.current.project?.scenes[0]?.sources[0];
    const children = movedGroup?.kind === 'group' ? movedGroup.children : [];
    expect(children?.map((item) => item.transform.x)).toEqual([20, 40, 80]);
    expect(movedGroup?.transform).toMatchObject({ x: 20, width: 80 });
    expect(result.current.sources.selectedSourceIds).toEqual(['group']);
  });

  it('snaps a source move to a stationary visible source edge and clears its guide on pointer up', () => {
    const { result } = setup([makeSource('moving', 0), makeSource('target', 35)]);
    const target = stage();
    act(() => result.current.sources.selectSource('moving'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 5, clientY: 15 }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 18, clientY: 15 })));

    expect(result.current.project?.scenes[0]?.sources[0]?.transform.x).toBe(15);
    expect(result.current.sources.snapGuides).toEqual([{ axis: 'x', position: 35 }, { axis: 'y', position: 10 }]);
    act(() => result.current.sources.handleStagePointerUp(pointerEvent(target)));
    expect(result.current.sources.snapGuides).toEqual([]);
  });

  it('does not snap to a moved group or its descendants', () => {
    const group = makeSource('group', 10, {
      kind: 'group',
      transform: { x: 10, y: 10, width: 20, height: 20 },
      children: [makeSource('child', 10)],
    });
    const { result } = setup([group]);
    const target = stage();
    act(() => result.current.sources.selectSource('group'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 15, clientY: 15 }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 20, clientY: 15 })));

    const moved = result.current.project?.scenes[0]?.sources[0];
    expect(moved?.kind === 'group' ? moved.children?.[0]?.transform.x : -1).toBe(15);
    expect(result.current.sources.snapGuides).toEqual([]);
  });

  it('snaps a multi-selection using its combined bounds', () => {
    const { result } = setup([
      makeSource('first', 0), makeSource('second', 30),
      makeSource('target', 80, { transform: { x: 80, y: 10, width: 10, height: 20 } }),
    ]);
    const target = stage();
    act(() => result.current.sources.selectSource('first'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      clientX: 45, clientY: 15, ctrlKey: true,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerUp(pointerEvent(target)));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 5, clientY: 15 }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 34, clientY: 15 })));

    expect(result.current.project?.scenes[0]?.sources.map((source) => source.transform.x)).toEqual([30, 60, 80]);
    expect(result.current.sources.snapGuides).toContainEqual({ axis: 'x', position: 80 });
  });

  it('uses Alt to bypass move snapping', () => {
    const { result } = setup([makeSource('moving', 5)]);
    const target = stage();
    act(() => result.current.sources.selectSource('moving'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, { clientX: 10, clientY: 15 }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 8, clientY: 15, altKey: true })));

    expect(result.current.project?.scenes[0]?.sources[0]?.transform.x).toBe(3);
    expect(result.current.sources.snapGuides).toEqual([]);
  });

  it('snaps a resized edge to another visible source', () => {
    const moving = makeSource('moving', 10, { transform: { x: 10, y: 10, width: 20, height: 20 } });
    const other = makeSource('other', 50, { transform: { x: 50, y: 10, width: 10, height: 20 } });
    const { result } = setup([moving, other]);
    const target = stage();
    act(() => result.current.sources.selectSource('moving'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('e'), clientX: 30, clientY: 20,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 48, clientY: 20 })));

    expect(result.current.project?.scenes[0]?.sources[0]?.transform).toMatchObject({ x: 10, width: 40 });
    expect(result.current.sources.snapGuides).toEqual([{ axis: 'x', position: 50 }]);
  });

  it('uses Alt to bypass resize snapping', () => {
    const moving = makeSource('moving', 10, { transform: { x: 10, y: 10, width: 20, height: 20 } });
    const other = makeSource('other', 50, { transform: { x: 50, y: 10, width: 10, height: 20 } });
    const { result } = setup([moving, other]);
    const target = stage();
    act(() => result.current.sources.selectSource('moving'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('e'), clientX: 30, clientY: 20,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 48, clientY: 20, altKey: true })));

    expect(result.current.project?.scenes[0]?.sources[0]?.transform.width).toBe(38);
    expect(result.current.sources.snapGuides).toEqual([]);
  });

  it('locks the resize ratio on Shift while keeping the opposite corner fixed', () => {
    const moving = makeSource('moving', 20, { transform: { x: 20, y: 20, width: 20, height: 10 } });
    const { result } = setup([moving]);
    const target = stage();
    act(() => result.current.sources.selectSource('moving'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('se'), clientX: 40, clientY: 30, shiftKey: true,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 50, clientY: 45 })));

    const transform = result.current.project?.scenes[0]?.sources[0]?.transform;
    expect(transform).toMatchObject({ x: 20, y: 20, width: 50, height: 25 });
    expect(transform!.width / transform!.height).toBeCloseTo(2);
  });

  it('resizes a selected group proportionally when Shift is held', () => {
    const group = makeSource('group', 10, {
      kind: 'group',
      transform: { x: 10, y: 10, width: 50, height: 20 },
      children: [
        makeSource('child-a', 10, { transform: { x: 10, y: 10, width: 20, height: 20 } }),
        makeSource('child-b', 40, { transform: { x: 40, y: 10, width: 20, height: 20 } }),
      ],
    });
    const { result } = setup([group]);
    const target = stage();
    act(() => result.current.sources.selectSource('group'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('se'), clientX: 60, clientY: 30, shiftKey: true,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 70, clientY: 34 })));

    const resized = result.current.project?.scenes[0]?.sources[0];
    expect(resized!.transform.width / resized!.transform.height).toBeCloseTo(2.5);
    expect(resized?.kind === 'group' ? resized.children?.map((child) => child.transform) : []).toEqual([
      { x: 10, y: 10, width: 24, height: 24 },
      { x: 46, y: 10, width: 24, height: 24 },
    ]);
  });

  it('crops a Windows/Linux Ctrl handle drag without toggling the selected source', () => {
    const image = makeSource('image', 10, {
      kind: 'image',
      transform: { x: 10, y: 20, width: 100, height: 50 },
    });
    const images = new Map([['image', imageWithSize(200, 100)]]);
    const { result } = setup([image], 'win32', { images });
    const target = stage();
    act(() => result.current.sources.selectSource('image'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('e'), clientX: 110, clientY: 45, ctrlKey: true,
    }), result.current.project!.scenes[0]!));
    expect(result.current.sources.selectedSourceIds).toEqual(['image']);
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 105, clientY: 45, altKey: true })));

    const cropped = result.current.project?.scenes[0]?.sources[0];
    expect(cropped?.crop).toEqual({ top: 0, right: 10, bottom: 0, left: 0 });
    expect(cropped?.transform.width).toBeCloseTo(95);
    expect(cropped?.transform.x).toBeCloseTo(10);
    expect(cropped?.transform.width! / (200 - (cropped?.crop?.left ?? 0) - (cropped?.crop?.right ?? 0))).toBeCloseTo(0.5);
  });

  it('uses Command for crop on macOS and falls back to resize when intrinsic dimensions are unavailable', () => {
    const image = makeSource('image', 10, {
      kind: 'image',
      transform: { x: 10, y: 20, width: 20, height: 20 },
    });
    const { result } = setup([image], 'darwin');
    const target = stage();
    act(() => result.current.sources.selectSource('image'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('e'), clientX: 30, clientY: 30, metaKey: true,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 40, clientY: 30 })));

    const resized = result.current.project?.scenes[0]?.sources[0];
    expect(resized?.crop).toBeUndefined();
    expect(resized?.transform.width).toBe(30);
  });

  it('crops a macOS presentation slide using its intrinsic image dimensions', () => {
    const slide = { assetId: 'asset-id', assetExtension: 'png', name: 'Slide 1' };
    const presentation = makeSource('slides', 10, {
      kind: 'presentation',
      presentationSlides: [slide],
      slideIndex: 0,
      transform: { x: 10, y: 20, width: 100, height: 50 },
    });
    const images = new Map([[slideshowImageElementKey('slides', [slide], 0), imageWithSize(200, 100)]]);
    const { result } = setup([presentation], 'darwin', { images });
    const target = stage();
    act(() => result.current.sources.selectSource('slides'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('e'), clientX: 110, clientY: 45, metaKey: true,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 105, clientY: 45, altKey: true })));

    expect(result.current.project?.scenes[0]?.sources[0]?.crop?.right).toBe(10);
  });

  it('crops a video source using its intrinsic video dimensions', () => {
    const camera = makeSource('camera', 10, {
      kind: 'camera',
      transform: { x: 10, y: 20, width: 100, height: 50 },
    });
    const videos = new Map([['camera', { videoWidth: 200, videoHeight: 100 } as HTMLVideoElement]]);
    const { result } = setup([camera], 'win32', { videos });
    const target = stage();
    act(() => result.current.sources.selectSource('camera'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('e'), clientX: 110, clientY: 45, ctrlKey: true,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 105, clientY: 45, altKey: true })));

    expect(result.current.project?.scenes[0]?.sources[0]?.crop?.right).toBe(10);
  });

  it('does not show a crop snap guide when source-pixel quantization misses the target', () => {
    const image = makeSource('image', 10, {
      kind: 'image',
      transform: { x: 10, y: 10, width: 1000, height: 100 },
    });
    const targetSource = makeSource('target', 1005, {
      transform: { x: 1005, y: 10, width: 20, height: 20 },
    });
    const images = new Map([['image', imageWithSize(100, 100)]]);
    const { result } = setup([image, targetSource], 'win32', { images });
    const target = stage();
    act(() => result.current.sources.selectSource('image'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      target: resizeHandle('e'), clientX: 1010, clientY: 60, ctrlKey: true,
    }), result.current.project!.scenes[0]!));
    act(() => result.current.sources.handleStagePointerMove(pointerEvent(target, { clientX: 1005, clientY: 60 })));

    const cropped = result.current.project?.scenes[0]?.sources[0];
    expect(cropped?.crop?.right).toBe(1);
    expect(cropped?.transform.width).toBeCloseTo(990);
    expect(result.current.sources.snapGuides).toEqual([]);
  });

  it('keeps body Ctrl presses as selection modifiers', () => {
    const { result } = setup([makeSource('first', 0), makeSource('second', 40)]);
    const target = stage();
    act(() => result.current.sources.selectSource('first'));
    act(() => result.current.sources.handleStagePointerDown(pointerEvent(target, {
      clientX: 45, clientY: 15, ctrlKey: true,
    }), result.current.project!.scenes[0]!));

    expect(result.current.sources.selectedSourceIds).toEqual(['second', 'first']);
  });

  it('removes a selected group and selected sibling in one update and stops each removed leaf once', () => {
    const child = makeSource('child', 0);
    const group = makeSource('group', 0, { kind: 'group', children: [child] });
    const sibling = makeSource('sibling', 40);
    const { result, stopRuntime, setterCalls } = setup([group, sibling]);
    act(() => result.current.sources.selectSourceRow({ type: 'click' }, 'group'));
    act(() => result.current.sources.selectSourceRow({ type: 'click', ctrlKey: true }, 'sibling'));
    setterCalls.count = 0;

    act(() => result.current.sources.removeSelectedSource());

    expect(result.current.project?.scenes[0]?.sources).toEqual([]);
    expect(stopRuntime.mock.calls.map(([id]) => id).sort()).toEqual(['child', 'sibling']);
    expect(setterCalls.count).toBe(1);
    expect(result.current.sources.selectedSourceIds).toEqual([]);
  });
});
