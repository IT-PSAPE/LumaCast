import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useScenes, type UseScenesParams } from '../../../../apps/stream/renderer/features/scenes/use-scenes';
import type { StreamProject, StreamSource } from '../../../../apps/stream/shared/desktop-api';

function project(activeSceneId = 'program'): StreamProject {
  return {
    version: 1, output: {} as StreamProject['output'], studioMode: true,
    activeSceneId, liveSceneId: 'program', hotkeys: {} as StreamProject['hotkeys'],
    sceneSwitchHotkeys: {}, sourceVisibilityHotkeys: {},
    scenes: [
      { id: 'program', name: 'Program', sources: [] },
      { id: 'preview', name: 'Preview', sources: [] },
    ],
  };
}

function setup(initial = project(), overrides: Partial<UseScenesParams> = {}) {
  const stopRuntime = vi.fn();
  const commitProgram = vi.fn(() => true);
  const finishProgramTransition = vi.fn();
  const { result } = renderHook(() => {
    const [draft, setDraft] = useState<StreamProject | null>(initial);
    const scenes = useScenes({
      project: draft,
      setProjectValue: (update) => setDraft((current) => current ? update(current) : current),
      setActionError: vi.fn(), working: false, setWorking: vi.fn(), selectSource: vi.fn(),
      runtimes: { current: new Map() }, applicationAudioInputs: { current: new Map() },
      applicationAudioSessions: { current: new Map() }, attachRuntime: vi.fn(), stopRuntime,
      startApplicationAudioRuntime: vi.fn(), startSystemAudioRuntime: vi.fn(),
      programSceneId: 'program', canTransition: () => true, commitProgram, finishProgramTransition,
      ...overrides,
    });
    return { draft, scenes };
  });
  return { result, stopRuntime, commitProgram, finishProgramTransition };
}

describe('useScenes Program configuration commits', () => {
  it('stages scene selection until Transition commits the selected scene', () => {
    const { result, commitProgram } = setup();
    act(() => result.current.scenes.chooseScene('preview'));
    expect(result.current.draft?.activeSceneId).toBe('preview');
    expect(result.current.draft?.liveSceneId).toBe('program');
    expect(commitProgram).not.toHaveBeenCalled();
    act(() => result.current.scenes.transitionScene());
    expect(commitProgram).toHaveBeenCalledWith('preview');
    expect(result.current.draft?.liveSceneId).toBe('preview');
  });

  it('commits a dirty same-scene configuration and retains outgoing Program until the fade finishes', () => {
    const { result, commitProgram, finishProgramTransition } = setup();
    act(() => result.current.scenes.transitionScene());
    expect(commitProgram).toHaveBeenCalledWith('program');
    expect(result.current.scenes.transition?.fromSceneId).toBe('program');
    expect(finishProgramTransition).not.toHaveBeenCalled();
    act(() => result.current.scenes.finishTransition());
    expect(finishProgramTransition).toHaveBeenCalledOnce();
  });

  it('releases outgoing Program immediately for Cut', () => {
    const { result, commitProgram, finishProgramTransition } = setup(project('preview'));
    act(() => result.current.scenes.setTransitionType('Cut'));
    act(() => result.current.scenes.transitionScene());
    expect(commitProgram).toHaveBeenCalledWith('preview');
    expect(result.current.scenes.transition).toBeNull();
    expect(finishProgramTransition).toHaveBeenCalledOnce();
  });

  it('retains an active Studio fade when the editable scene is deleted', () => {
    const { result, finishProgramTransition } = setup(project('preview'));
    act(() => result.current.scenes.transitionScene());
    const transition = result.current.scenes.transition;
    act(() => result.current.scenes.deleteActiveScene());
    expect(result.current.scenes.transition).toBe(transition);
    expect(result.current.draft?.scenes.some((scene) => scene.id === 'preview')).toBe(false);
    expect(finishProgramTransition).not.toHaveBeenCalled();
  });

  it('does not toggle Studio Mode or release Program during an active fade', () => {
    const { result, finishProgramTransition } = setup();
    act(() => result.current.scenes.transitionScene());
    act(() => result.current.scenes.toggleStudioMode());
    expect(result.current.draft?.studioMode).toBe(true);
    expect(result.current.scenes.transition).not.toBeNull();
    expect(finishProgramTransition).not.toHaveBeenCalled();
  });

  it('leaves source cleanup to graph ownership when the draft scene is deleted', () => {
    const draft = project('preview');
    draft.scenes[1]!.sources = [{
      id: 'camera', name: 'Camera', kind: 'camera', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 100, height: 100 },
    } satisfies StreamSource];
    const { result, stopRuntime } = setup(draft);
    act(() => result.current.scenes.deleteActiveScene());
    expect(result.current.draft?.scenes.map((scene) => scene.id)).toEqual(['program']);
    expect(stopRuntime).not.toHaveBeenCalled();
  });
});
