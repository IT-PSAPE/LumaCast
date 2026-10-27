import { describe, expect, it } from 'vitest';
import { mergeRuntimeSources, getOriginSourceId, getSourceRuntimeId, toRuntimeProject, toRuntimeSource } from '../../../../apps/stream/renderer/source-runtime';
import type { StreamProject, StreamScene, StreamSource } from '../../../../apps/stream/shared/desktop-api';

function source(overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id: 'source-a', name: 'Source', kind: 'media', visible: true, muted: false, volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 }, assetId: 'asset-a', assetExtension: 'mp4', mediaKind: 'video',
    ...overrides,
  };
}

describe('source runtime bindings', () => {
  it('allocates stable native-safe UUIDs per logical source and resource configuration', () => {
    const first = source();
    const sameResource = source({ volume: 0.4, muted: true, loop: true, transform: { x: 10, y: 20, width: 300, height: 200 } });
    const changedResource = source({ assetId: 'asset-b' });

    const runtimeId = getSourceRuntimeId(first);
    expect(runtimeId).toMatch(/^[0-9a-f-]{16,128}$/i);
    expect(getSourceRuntimeId(sameResource)).toBe(runtimeId);
    expect(getSourceRuntimeId(changedResource)).not.toBe(runtimeId);
    expect(getSourceRuntimeId(source({ kind: 'scene', referencedSceneId: 'scene-a' })))
      .not.toBe(getSourceRuntimeId(source({ kind: 'scene', referencedSceneId: 'scene-b' })));
  });

  it('maps nested source trees while retaining logical identity and scene references', () => {
    const project = {
      version: 1,
      output: {} as StreamProject['output'],
      studioMode: true,
      activeSceneId: 'preview',
      liveSceneId: 'program',
      hotkeys: {} as StreamProject['hotkeys'],
      sceneSwitchHotkeys: {},
      sourceVisibilityHotkeys: {},
      scenes: [{
        id: 'program', name: 'Program', sources: [{
          id: 'group', name: 'Group', kind: 'group', visible: true, muted: false, volume: 1,
          transform: { x: 0, y: 0, width: 100, height: 100 },
          children: [source(), { ...source({ id: 'scene-ref', kind: 'scene' }), referencedSceneId: 'nested' }],
        }],
      }, { id: 'nested', name: 'Nested', sources: [] }],
    } satisfies StreamProject;

    const runtimeProject = toRuntimeProject(project);
    const [runtimeGroup] = runtimeProject.scenes[0]!.sources;
    const [runtimeMedia, runtimeScene] = runtimeGroup!.children!;
    expect(runtimeGroup!.id).not.toBe('group');
    expect(runtimeMedia!.id).not.toBe('source-a');
    expect(runtimeScene!.referencedSceneId).toBe('nested');
    expect(getOriginSourceId(runtimeMedia!)).toBe('source-a');
    expect(runtimeProject.scenes[1]!.id).toBe('nested');
  });

  it('binds browser runtime identity to output base dimensions and preserves the viewport through merging', () => {
    const browser = source({ id: 'browser', kind: 'browser', url: 'https://example.test' });
    const project = (width: number, height: number): StreamProject => ({
      version: 1,
      output: { baseWidth: width, baseHeight: height } as StreamProject['output'],
      studioMode: true,
      activeSceneId: 'scene',
      liveSceneId: 'scene',
      hotkeys: {} as StreamProject['hotkeys'],
      sceneSwitchHotkeys: {},
      sourceVisibilityHotkeys: {},
      scenes: [{ id: 'scene', name: 'Scene', sources: [browser] }],
    });

    const firstViewport = toRuntimeProject(project(1920, 1080));
    const sameViewport = toRuntimeProject(project(1920, 1080));
    const changedViewport = toRuntimeProject(project(1280, 720));
    const audioEnabledBrowser = toRuntimeSource({ ...browser, browserAudioEnabled: true }, { width: 1920, height: 1080 });
    const changedUrlBrowser = toRuntimeSource({ ...browser, url: 'https://other.test' }, { width: 1920, height: 1080 });
    const firstSource = firstViewport.scenes[0]!.sources[0]!;
    const changedSource = changedViewport.scenes[0]!.sources[0]!;
    const merged = mergeRuntimeSources({ draftScenes: firstViewport.scenes, programScenes: [] });
    const draftAndProgram = mergeRuntimeSources({ draftScenes: changedViewport.scenes, programScenes: firstViewport.scenes });

    expect(firstSource.id).toBe(sameViewport.scenes[0]!.sources[0]!.id);
    expect(firstSource.id).not.toBe(changedSource.id);
    expect(audioEnabledBrowser.id).toBe(firstSource.id);
    expect(changedUrlBrowser.id).not.toBe(firstSource.id);
    expect(firstSource.browserViewportWidth).toBe(1920);
    expect(firstSource.browserViewportHeight).toBe(1080);
    expect(merged[0]?.id).toBe(firstSource.id);
    expect(merged[0]?.browserViewportWidth).toBe(1920);
    expect(merged[0]?.browserViewportHeight).toBe(1080);
    expect(draftAndProgram.map((item) => item.id)).toContain(firstSource.id);
    expect(draftAndProgram.map((item) => item.id)).toContain(changedSource.id);
    expect(draftAndProgram.find((item) => item.id === firstSource.id)?.browserViewportWidth).toBe(1920);
    expect(draftAndProgram.find((item) => item.id === changedSource.id)?.browserViewportWidth).toBe(1280);
  });

  it('keeps Program config for a shared runtime and retains diverged/outgoing variants', () => {
    const draft = source({ muted: false, volume: 0.2 });
    const program = source({ muted: true, volume: 0.8 });
    const editedResource = source({ url: 'https://example.test/changed' });
    const outgoing = source({ id: 'outgoing-source', assetId: 'old-asset', assetExtension: 'mp4', mediaKind: 'video' });
    const scenes = (sources: StreamSource[]): StreamScene[] => [{ id: 'scene', name: 'Scene', sources }];

    const merged = mergeRuntimeSources({
      draftScenes: scenes([draft, editedResource]),
      outgoingScenes: scenes([outgoing]),
      programScenes: scenes([program]),
    });
    const sharedRuntimeId = getSourceRuntimeId(program);
    expect(merged.find((item) => item.id === sharedRuntimeId)?.muted).toBe(true);
    expect(merged).toHaveLength(3);
    expect(merged.some((item) => item.id === toRuntimeSource(editedResource).id)).toBe(true);
    expect(merged.some((item) => item.originSourceId === 'outgoing-source')).toBe(true);
  });
});
