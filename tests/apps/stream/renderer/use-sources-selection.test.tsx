import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSources, type UseSourcesParams } from '../../../../apps/stream/renderer/features/sources/use-sources';
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

function setup(sources: StreamSource[]) {
  const stopRuntime = vi.fn();
  const setterCalls = { count: 0 };
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
      api: {} as StreamAPI,
      project,
      projectRef,
      allSources: scene ? flattenSourceNodes(scene.sources) : [],
      activeScene: scene,
      liveScene: scene,
      setProjectValue: updateProject,
      setActionError: vi.fn(),
      working: false,
      setWorking: vi.fn(),
      videoElements: useRef(new Map()),
      imageElements: useRef(new Map()),
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
  return { result, stopRuntime, setterCalls };
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
