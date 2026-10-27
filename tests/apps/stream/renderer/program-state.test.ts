import { describe, expect, it } from 'vitest';
import { createProgramSnapshot, programConfigurationMatches, programSnapshotToProject } from '../../../../apps/stream/renderer/program-state';
import type { StreamProject, StreamSource } from '../../../../apps/stream/shared/desktop-api';

function source(id: string, overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id, name: id, kind: 'media', visible: true, muted: false, volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 }, assetId: `${id}-asset`, assetExtension: 'mp4', mediaKind: 'video',
    ...overrides,
  };
}

function project(): StreamProject {
  return {
    version: 1,
    output: { width: 1920 } as StreamProject['output'],
    studioMode: true,
    activeSceneId: 'preview',
    liveSceneId: 'program',
    hotkeys: {} as StreamProject['hotkeys'],
    sceneSwitchHotkeys: {},
    sourceVisibilityHotkeys: {},
    scenes: [
      { id: 'program', name: 'Program', sources: [{ ...source('ref', { kind: 'scene' }), referencedSceneId: 'nested' }] },
      { id: 'nested', name: 'Nested', sources: [source('media')] },
      { id: 'unrelated', name: 'Unrelated', sources: [source('other')] },
    ],
  };
}

describe('Program snapshots', () => {
  it('freezes the root and referenced scene graph, including scenes later removed from the draft', () => {
    const draft = project();
    const snapshot = createProgramSnapshot(draft)!;
    draft.scenes.splice(1, 1);
    draft.scenes[0]!.sources[0]!.referencedSceneId = 'unrelated';
    draft.scenes[0]!.name = 'Changed';

    expect(snapshot.scenes.map((scene) => scene.id)).toEqual(['program', 'nested']);
    expect(snapshot.scenes[0]!.name).toBe('Program');
    expect(snapshot.scenes[0]!.sources[0]!.referencedSceneId).toBe('nested');
    expect(programSnapshotToProject(draft, snapshot).liveSceneId).toBe('program');
  });

  it('compares the reachable graph and output, ignoring unrelated scenes', () => {
    const draft = project();
    const snapshot = createProgramSnapshot(draft)!;
    expect(programConfigurationMatches(draft, snapshot)).toBe(true);

    draft.scenes.find((scene) => scene.id === 'unrelated')!.sources[0]!.name = 'Unrelated edit';
    expect(programConfigurationMatches(draft, snapshot)).toBe(true);

    draft.scenes.find((scene) => scene.id === 'nested')!.sources[0]!.volume = 0.25;
    expect(programConfigurationMatches(draft, snapshot)).toBe(false);
    expect(programConfigurationMatches({ ...draft, output: { ...draft.output, width: 1280 } }, snapshot)).toBe(false);
  });

  it('returns no snapshot for a missing Program root', () => {
    expect(createProgramSnapshot(project(), 'missing')).toBeNull();
  });
});
