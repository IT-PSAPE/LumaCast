import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useProgram } from '../../../../apps/stream/renderer/features/scenes/use-program';
import type { StreamProject, StreamSource } from '../../../../apps/stream/shared/desktop-api';

function mediaSource(id: string, volume = 1): StreamSource {
  return {
    id, name: id, kind: 'media', visible: true, muted: false, volume,
    transform: { x: 0, y: 0, width: 100, height: 100 }, assetId: `${id}-asset`, assetExtension: 'mp4', mediaKind: 'video',
  };
}

function makeProject(studioMode = true): StreamProject {
  return {
    version: 1,
    output: { width: 1920 } as StreamProject['output'],
    studioMode,
    activeSceneId: 'preview',
    liveSceneId: 'program',
    hotkeys: {} as StreamProject['hotkeys'],
    sceneSwitchHotkeys: {},
    sourceVisibilityHotkeys: {},
    scenes: [
      { id: 'program', name: 'Program', sources: [mediaSource('on-air')] },
      { id: 'preview', name: 'Preview', sources: [mediaSource('draft')] },
    ],
  };
}

function setup(initialProject = makeProject(), workspaceKey = 'collection:profile') {
  return renderHook(({ initial, key }: { initial: StreamProject | null; key: string }) => {
    const [project, setProject] = useState<StreamProject | null>(initial);
    return { project, setProject, program: useProgram({ project, workspaceKey: key }) };
  }, { initialProps: { initial: initialProject as StreamProject | null, key: workspaceKey } });
}

describe('useProgram', () => {
  it('keeps Studio Mode Preview edits off Program until commit, including same-scene commits', () => {
    const { result } = setup();

    act(() => result.current.setProject((current) => ({
      ...current!,
      scenes: current!.scenes.map((scene) => scene.id === 'program'
        ? { ...scene, sources: [mediaSource('on-air', 0.25)] }
        : scene),
    })));

    expect(result.current.program.programScene?.sources[0]?.volume).toBe(1);
    expect(result.current.program.canTransition('program')).toBe(true);
    act(() => { expect(result.current.program.commitProgram('program')).toBe(true); });
    expect(result.current.program.programScene?.sources[0]?.volume).toBe(0.25);
    expect(result.current.program.outgoingScene?.sources[0]?.volume).toBe(1);
    expect(result.current.program.canTransition('preview')).toBe(false);

    act(() => result.current.program.finishOutgoingProgram());
    expect(result.current.program.outgoingSnapshot).toBeNull();
    expect(result.current.program.canTransition('preview')).toBe(true);
  });

  it('does not undo a committed Program snapshot when draft history restores an older edit', () => {
    const { result } = setup();
    const originalDraft = result.current.project!;
    act(() => result.current.setProject((current) => ({
      ...current!,
      scenes: current!.scenes.map((scene) => scene.id === 'program'
        ? { ...scene, sources: [mediaSource('on-air', 0.25)] }
        : scene),
    })));
    act(() => { expect(result.current.program.commitProgram('program')).toBe(true); });
    expect(result.current.program.programScene?.sources[0]?.volume).toBe(0.25);

    act(() => result.current.setProject(originalDraft));

    expect(result.current.program.programScene?.sources[0]?.volume).toBe(0.25);
    expect(result.current.project?.scenes[0]?.sources[0]?.volume).toBe(1);
  });

  it('retains outgoing Program across a scene commit until transition completion', () => {
    const { result } = setup();
    expect(result.current.program.canTransition('preview')).toBe(true);

    act(() => { expect(result.current.program.commitProgram('preview')).toBe(true); });

    expect(result.current.program.programSceneId).toBe('preview');
    expect(result.current.program.outgoingScene?.id).toBe('program');
    act(() => result.current.program.finishOutgoingProgram());
    expect(result.current.program.outgoingScene).toBeNull();
  });

  it('keeps committed and outgoing project projections stable across draft edits', () => {
    const { result } = setup();
    const initialProgramProject = result.current.program.programProject;

    act(() => result.current.setProject((current) => ({
      ...current!,
      scenes: current!.scenes.map((scene) => scene.id === 'preview'
        ? { ...scene, sources: [mediaSource('draft', 0.4)] }
        : scene),
    })));

    expect(result.current.program.programProject).toBe(initialProgramProject);
    expect(result.current.program.programProject?.scenes[0]?.sources[0]?.volume).toBe(1);

    act(() => { expect(result.current.program.commitProgram('preview')).toBe(true); });
    const committedProject = result.current.program.programProject;
    const outgoingProject = result.current.program.outgoingProject;
    expect(committedProject).not.toBe(initialProgramProject);
    expect(committedProject?.scenes[0]?.sources[0]?.volume).toBe(0.4);

    act(() => result.current.setProject((current) => ({
      ...current!,
      scenes: current!.scenes.map((scene) => scene.id === 'preview'
        ? { ...scene, sources: [mediaSource('draft', 0.8)] }
        : scene),
    })));

    expect(result.current.program.programProject).toBe(committedProject);
    expect(result.current.program.outgoingProject).toBe(outgoingProject);
    expect(result.current.program.programProject?.scenes[0]?.sources[0]?.volume).toBe(0.4);
    expect(result.current.program.outgoingProject?.scenes[0]?.id).toBe('program');
  });

  it('follows draft edits directly when Studio Mode is off', () => {
    const { result } = setup(makeProject(false));
    const initialProgramProject = result.current.program.programProject;

    act(() => result.current.setProject((current) => ({
      ...current!,
      scenes: current!.scenes.map((scene) => scene.id === 'program'
        ? { ...scene, sources: [mediaSource('on-air', 0.5)] }
        : scene),
    })));

    expect(result.current.program.programScene?.sources[0]?.volume).toBe(0.5);
    expect(result.current.program.programProject).not.toBe(initialProgramProject);
    expect(result.current.program.programProject?.scenes[0]?.sources[0]?.volume).toBe(0.5);
  });

  it('refreshes the projection when switching from Studio Mode to direct single-view mode', () => {
    const { result } = setup();
    const studioProgramProject = result.current.program.programProject;

    act(() => result.current.setProject((current) => ({
      ...current!,
      scenes: current!.scenes.map((scene) => scene.id === 'program'
        ? { ...scene, sources: [mediaSource('on-air', 0.35)] }
        : scene),
    })));
    expect(result.current.program.programProject).toBe(studioProgramProject);
    expect(result.current.program.programScene?.sources[0]?.volume).toBe(1);

    act(() => result.current.setProject((current) => ({ ...current!, studioMode: false })));

    expect(result.current.program.programProject).not.toBe(studioProgramProject);
    expect(result.current.program.programScene?.sources[0]?.volume).toBe(0.35);
  });

  it('reinitializes from the newly loaded profile or collection', () => {
    const { result, rerender } = setup();
    const initialProgramProject = result.current.program.programProject;
    const nextProject = makeProject();
    nextProject.scenes[0]!.name = 'Loaded Program';
    nextProject.scenes[0]!.sources = [mediaSource('new-on-air', 0.6)];

    act(() => result.current.setProject(nextProject));
    rerender({ initial: nextProject, key: 'collection:other-profile' });

    expect(result.current.program.programScene?.name).toBe('Loaded Program');
    expect(result.current.program.programScene?.sources[0]?.volume).toBe(0.6);
    expect(result.current.program.programProject).not.toBe(initialProgramProject);
  });
});
