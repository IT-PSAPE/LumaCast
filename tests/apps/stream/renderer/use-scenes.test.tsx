import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useScenes, type UseScenesParams } from '../../../../apps/stream/renderer/features/scenes/use-scenes';
import type { StreamProject, StreamSource } from '../../../../apps/stream/shared/desktop-api';

function makeSceneReference(id: string, referencedSceneId: string): StreamSource {
  return {
    id,
    name: id,
    kind: 'scene',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 1, height: 1 },
    referencedSceneId,
  };
}

function makeProject(overrides: Partial<StreamProject> = {}): StreamProject {
  return {
    version: 1,
    output: {} as StreamProject['output'],
    studioMode: true,
    activeSceneId: 'program',
    liveSceneId: 'program',
    hotkeys: {} as StreamProject['hotkeys'],
    sceneSwitchHotkeys: {},
    sourceVisibilityHotkeys: {},
    scenes: [
      { id: 'program', name: 'Program', sources: [] },
      { id: 'preview', name: 'Preview', sources: [] },
    ],
    ...overrides,
  };
}

function setup(initialProject = makeProject(), extraParams: Partial<UseScenesParams> = {}) {
  const selectSource = vi.fn();
  const stopRuntime = vi.fn();
  const { result } = renderHook(() => {
    const [project, setProject] = useState<StreamProject | null>(initialProject);
    const scenes = useScenes({
      project,
      setProjectValue: (update) => setProject((current) => current ? update(current) : current),
      setActionError: vi.fn(),
      working: false,
      setWorking: vi.fn(),
      selectSource,
      runtimes: { current: new Map() },
      applicationAudioInputs: { current: new Map() },
      applicationAudioSessions: { current: new Map() },
      attachRuntime: vi.fn(),
      stopRuntime,
      startApplicationAudioRuntime: vi.fn(),
      startSystemAudioRuntime: vi.fn(),
      ...extraParams,
    } satisfies UseScenesParams);
    return { project, scenes };
  });
  return { result, selectSource, stopRuntime };
}

describe('useScenes transition behavior', () => {
  it('keeps scene selection in preview until transitionScene sends it to program', () => {
    const { result, selectSource } = setup();

    act(() => result.current.scenes.chooseScene('preview'));
    expect(result.current.project?.activeSceneId).toBe('preview');
    expect(result.current.project?.liveSceneId).toBe('program');

    act(() => result.current.scenes.transitionScene());
    expect(result.current.project?.activeSceneId).toBe('preview');
    expect(result.current.project?.liveSceneId).toBe('preview');
    expect(result.current.scenes.transition).not.toBeNull();
    expect(selectSource).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the active scene is already live', () => {
    const { result, selectSource } = setup(makeProject({ activeSceneId: 'program', liveSceneId: 'program' }));

    act(() => result.current.scenes.transitionScene());

    expect(result.current.project?.liveSceneId).toBe('program');
    expect(result.current.scenes.transition).toBeNull();
    expect(selectSource).not.toHaveBeenCalled();
  });

  it('transitions an explicit scene to program without requiring it to be active first', () => {
    const { result, selectSource } = setup();

    act(() => result.current.scenes.transitionScene('preview'));

    expect(result.current.project?.activeSceneId).toBe('preview');
    expect(result.current.project?.liveSceneId).toBe('preview');
    expect(result.current.scenes.transition).not.toBeNull();
    expect(selectSource).toHaveBeenCalledOnce();
  });

  it('switches program immediately when the selected transition is Cut', () => {
    const { result } = setup();

    act(() => result.current.scenes.chooseScene('preview'));
    act(() => result.current.scenes.setTransitionType('Cut'));
    act(() => result.current.scenes.transitionScene());

    expect(result.current.project?.liveSceneId).toBe('preview');
    expect(result.current.scenes.transition).toBeNull();
  });

  it('commits a dirty same-scene Program configuration and retains its outgoing graph', () => {
    const commitProgram = vi.fn(() => true);
    const finishProgramTransition = vi.fn();
    const { result, selectSource } = setup(makeProject(), {
      programSceneId: 'program',
      canTransition: vi.fn(() => true),
      commitProgram,
      finishProgramTransition,
    });

    act(() => result.current.scenes.transitionScene('program'));

    expect(commitProgram).toHaveBeenCalledWith('program');
    expect(result.current.project?.liveSceneId).toBe('program');
    expect(result.current.scenes.transition?.fromSceneId).toBe('program');
    expect(finishProgramTransition).not.toHaveBeenCalled();
    expect(selectSource).not.toHaveBeenCalled();

    act(() => result.current.scenes.finishTransition());
    expect(finishProgramTransition).toHaveBeenCalledOnce();
  });

  it('releases the outgoing Program immediately for a Cut commit', () => {
    const commitProgram = vi.fn(() => true);
    const finishProgramTransition = vi.fn();
    const { result } = setup(makeProject(), { commitProgram, finishProgramTransition });

    act(() => result.current.scenes.setTransitionType('Cut'));
    act(() => result.current.scenes.transitionScene('preview'));

    expect(commitProgram).toHaveBeenCalledWith('preview');
    expect(result.current.scenes.transition).toBeNull();
    expect(finishProgramTransition).toHaveBeenCalledOnce();
  });

  it('keeps the Program fade alive when the active draft scene is deleted in Studio Mode', () => {
    const commitProgram = vi.fn(() => true);
    const finishProgramTransition = vi.fn();
    const { result } = setup(makeProject({ activeSceneId: 'preview' }), {
      programSceneId: 'program',
      canTransition: vi.fn(() => true),
      commitProgram,
      finishProgramTransition,
    });

    act(() => result.current.scenes.transitionScene('preview'));
    const inFlightTransition = result.current.scenes.transition;
    act(() => result.current.scenes.deleteScenes(['preview']));

    expect(result.current.scenes.transition).toBe(inFlightTransition);
    expect(result.current.project?.scenes.some((scene) => scene.id === 'preview')).toBe(false);
    expect(finishProgramTransition).not.toHaveBeenCalled();
  });

  it('does not toggle Studio Mode or release Program during an active fade', () => {
    const finishProgramTransition = vi.fn();
    const { result } = setup(makeProject(), {
      programSceneId: 'program',
      canTransition: vi.fn(() => true),
      commitProgram: vi.fn(() => true),
      finishProgramTransition,
    });

    act(() => result.current.scenes.transitionScene('preview'));
    expect(result.current.scenes.transition).not.toBeNull();
    act(() => result.current.scenes.toggleStudioMode());

    expect(result.current.project?.studioMode).toBe(true);
    expect(result.current.scenes.transition).not.toBeNull();
    expect(finishProgramTransition).not.toHaveBeenCalled();
  });
});

describe('useScenes collection mutations', () => {
  it('duplicates the explicitly targeted scene instead of the active scene', async () => {
    const { result } = setup();

    await act(async () => { await result.current.scenes.duplicateActiveScene('preview'); });

    const project = result.current.project;
    const duplicate = project?.scenes.find((scene) => scene.id === project.activeSceneId);
    expect(duplicate?.name).toBe('Preview Copy');
    expect(project?.liveSceneId).toBe('program');
  });

  it('deletes a selected group in one project update and keeps active and live scene ids valid', () => {
    const project = makeProject({
      scenes: [
        { id: 'program', name: 'Program', sources: [] },
        { id: 'preview', name: 'Preview', sources: [] },
        { id: 'spare', name: 'Spare', sources: [] },
        { id: 'end-card', name: 'End card', sources: [makeSceneReference('preview-ref', 'preview'), makeSceneReference('spare-ref', 'spare')] },
      ],
      sceneSwitchHotkeys: { program: 'p', preview: 'v', spare: 's', 'end-card': 'e' },
      sourceVisibilityHotkeys: { 'preview-ref': 'shift+p', 'spare-ref': 'shift+s' },
    });
    const { result, selectSource } = setup(project);

    act(() => result.current.scenes.deleteScenes(['preview', 'spare']));

    expect(result.current.project?.scenes.map((scene) => scene.id)).toEqual(['program', 'end-card']);
    expect(result.current.project?.activeSceneId).toBe('program');
    expect(result.current.project?.liveSceneId).toBe('program');
    expect(result.current.project?.scenes.find((scene) => scene.id === 'end-card')?.sources).toEqual([]);
    expect(result.current.project?.sceneSwitchHotkeys).toEqual({ program: 'p', 'end-card': 'e' });
    expect(result.current.project?.sourceVisibilityHotkeys).toEqual({});
    expect(selectSource).not.toHaveBeenCalled();
  });

  it('keeps the active scene when every scene is requested for deletion', () => {
    const { result } = setup(makeProject({
      scenes: [
        { id: 'program', name: 'Program', sources: [] },
        { id: 'preview', name: 'Preview', sources: [] },
        { id: 'spare', name: 'Spare', sources: [] },
      ],
    }));

    act(() => result.current.scenes.deleteScenes(['program', 'preview', 'spare']));

    expect(result.current.project?.scenes.map((scene) => scene.id)).toEqual(['program']);
    expect(result.current.project?.activeSceneId).toBe('program');
    expect(result.current.project?.liveSceneId).toBe('program');
  });

  it('does not eagerly stop sources when their editable scene is deleted', () => {
    const { result, stopRuntime } = setup(makeProject({
      scenes: [
        { id: 'program', name: 'Program', sources: [] },
        { id: 'preview', name: 'Preview', sources: [makeSceneReference('source', 'program')] },
      ],
      activeSceneId: 'preview',
    }));

    act(() => result.current.scenes.deleteScenes(['preview']));

    expect(result.current.project?.scenes.map((scene) => scene.id)).toEqual(['program']);
    expect(stopRuntime).not.toHaveBeenCalled();
  });

  it('persists scene reorder by id while preserving scene objects and project fields', () => {
    const project = makeProject();
    const { result } = setup(project);

    act(() => result.current.scenes.reorderScenes(['preview', 'program']));

    expect(result.current.project?.scenes.map((scene) => scene.id)).toEqual(['preview', 'program']);
    expect(result.current.project?.scenes[0]).toBe(project.scenes[1]);
    expect(result.current.project?.activeSceneId).toBe('program');
    expect(result.current.project?.liveSceneId).toBe('program');
  });
});
