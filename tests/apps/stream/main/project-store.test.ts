// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultProject, type AudioFilters, type AudioTrack, type StreamProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { ProjectStore } from '../../../../apps/stream/main/project-store';

const temporaryDirectories: string[] = [];

function projectWithDisplaySource(): StreamProject {
  const project = createDefaultProject();
  const scene = project.scenes[0];
  if (!scene) throw new Error('Default Stream project has no scene.');
  scene.sources.push({
    id: 'display-source',
    name: 'Display 1',
    kind: 'display',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: project.output.width, height: project.output.height },
    captureId: 'screen:1',
    cursorMode: 'never',
  });
  return project;
}

function projectWithMicrophoneSource(): StreamProject {
  const project = createDefaultProject();
  const scene = project.scenes[0];
  if (!scene) throw new Error('Default Stream project has no scene.');
  const audioFilters: AudioFilters = {
    gainDb: 0,
    noiseSuppression: false,
    noiseGate: false,
    noiseGateOpenThresholdDb: -26,
    noiseGateCloseThresholdDb: -32,
    noiseGateAttackMs: 10,
    noiseGateHoldMs: 150,
    noiseGateReleaseMs: 250,
    expander: false,
    expanderThresholdDb: -40,
    expanderRatio: 2,
    expanderAttackMs: 10,
    expanderReleaseMs: 150,
    compressor: false,
    compressorThresholdDb: -18,
    compressorRatio: 4,
    limiter: false,
  };
  const source: StreamSource = {
    id: 'microphone-source',
    name: 'Microphone',
    kind: 'microphone',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 1, height: 1 },
    audioFilters,
  };
  scene.sources.push(source);
  return project;
}

function projectWithDesktopAudioSource(): StreamProject {
  const project = createDefaultProject();
  const scene = project.scenes[0];
  if (!scene) throw new Error('Default Stream project has no scene.');
  scene.sources.push({
    id: 'desktop-audio-source',
    name: 'Desktop Audio',
    kind: 'desktop-audio',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 1, height: 1 },
    captureId: 'screen:1',
  });
  return project;
}

function projectWithApplicationAudioSource(): StreamProject {
  const project = createDefaultProject();
  const scene = project.scenes[0];
  if (!scene) throw new Error('Default Stream project has no scene.');
  scene.sources.push({
    id: 'application-audio-source',
    name: 'Music Player',
    kind: 'application-audio',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 1, height: 1 },
    applicationPath: 'C:\\Program Files\\Music Player\\player.exe',
  });
  return project;
}

function projectWithMediaSource(): StreamProject {
  const project = createDefaultProject();
  const scene = project.scenes[0];
  if (!scene) throw new Error('Default Stream project has no scene.');
  scene.sources.push({
    id: 'media-source',
    name: 'Clip',
    kind: 'media',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: project.output.width, height: project.output.height },
    assetId: '00000000-0000-4000-8000-000000000001',
    assetExtension: 'mp4',
    mediaKind: 'video',
    loop: false,
    restartPlaybackWhenActive: false,
    showNothingWhenPlaybackEnds: false,
  });
  return project;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('LumaStream desktop audio persistence', () => {
  it('round-trips the desktop loopback source and its selected display', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(projectWithDesktopAudioSource()), 'utf8');

    const restored = await new ProjectStore(directory).load();
    const source = restored.project.scenes[0]?.sources.find((item) => item.id === 'desktop-audio-source');
    expect(source?.kind).toBe('desktop-audio');
    expect(source?.captureId).toBe('screen:1');
    expect(source?.audioTracks).toEqual([1]);
  });
});

describe('LumaStream application audio persistence', () => {
  it('round-trips the selected executable path without persisting a process ID', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(projectWithApplicationAudioSource()), 'utf8');

    const restored = await new ProjectStore(directory).load();
    const source = restored.project.scenes[0]?.sources.find((item) => item.id === 'application-audio-source');
    expect(source?.kind).toBe('application-audio');
    expect(source?.applicationPath).toBe('C:\\Program Files\\Music Player\\player.exe');
    expect(source).not.toHaveProperty('pid');
  });

  it('rejects a relative executable path', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithApplicationAudioSource();
    project.scenes[0]!.sources[0]!.applicationPath = 'player.exe';
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    await expect(new ProjectStore(directory).load()).rejects.toThrow('invalid application audio source');
  });

  it('rejects an application audio source without an executable path', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithApplicationAudioSource();
    delete project.scenes[0]!.sources[0]!.applicationPath;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    await expect(new ProjectStore(directory).load()).rejects.toThrow('incomplete application audio source');
  });
});

describe('LumaStream media playback persistence', () => {
  it('round-trips loop, restart-on-active, and end-frame behavior', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(projectWithMediaSource()), 'utf8');

    const restored = await new ProjectStore(directory).load();
    const source = restored.project.scenes[0]?.sources.find((item) => item.id === 'media-source');
    expect(source?.loop).toBe(false);
    expect(source?.restartPlaybackWhenActive).toBe(false);
    expect(source?.showNothingWhenPlaybackEnds).toBe(false);
  });

  it('rejects media playback settings with non-boolean values', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithMediaSource();
    (project.scenes[0]!.sources[0] as unknown as Record<string, unknown>).restartPlaybackWhenActive = 'yes';
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    await expect(new ProjectStore(directory).load()).rejects.toThrow('invalid media restart setting');
  });

  it('ignores a legacy loop field on image sources without rejecting the collection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.scenes[0]!.sources.push({
      id: 'legacy-image-source',
      name: 'Still Image',
      kind: 'image',
      visible: true,
      muted: false,
      volume: 1,
      transform: { x: 0, y: 0, width: project.output.width, height: project.output.height },
      assetId: '00000000-0000-4000-8000-000000000002',
      assetExtension: 'png',
      mediaKind: 'image',
      loop: true,
    });
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    const restored = await new ProjectStore(directory).load();
    const source = restored.project.scenes[0]?.sources.find((item) => item.id === 'legacy-image-source');
    expect(source?.kind).toBe('image');
    expect(source?.loop).toBeUndefined();
  });
});

describe('LumaStream encoder family persistence', () => {
  it('defaults older collections to Media Foundation and round-trips selected families', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const legacyProject = createDefaultProject();
    delete (legacyProject.output as Partial<typeof legacyProject.output>).streamVideoEncoder;
    delete (legacyProject.output as Partial<typeof legacyProject.output>).recordingVideoEncoder;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(legacyProject), 'utf8');

    const store = new ProjectStore(directory);
    const workspace = await store.load();
    expect(workspace.project.output.streamVideoEncoder).toBe('h264_mf');
    expect(workspace.project.output.recordingVideoEncoder).toBe('h264_mf');

    const project = {
      ...workspace.project,
      output: { ...workspace.project.output, streamVideoEncoder: 'h264_nvenc' as const, recordingVideoEncoder: 'h264_amf' as const },
    };
    await store.save(workspace.activeCollectionId, workspace.activeProfileId, project);
    const restored = await store.load();
    expect(restored.project.output.streamVideoEncoder).toBe('h264_nvenc');
    expect(restored.project.output.recordingVideoEncoder).toBe('h264_amf');
  });

  it('rejects a saved rate-control mode unsupported by its selected encoder', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.output.streamVideoEncoder = 'libopenh264';
    project.output.streamRateControl = 'quality';
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid video settings.');
  });
});

describe('LumaStream scene collection portability', () => {
  it('imports collections with unique names and the active output profile', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const initial = await store.load();
    const modified = {
      ...initial.project,
      output: { ...initial.project.output, width: 2560 },
    };

    const imported = await store.importCollection('Portable Collection', modified);
    expect(imported.collections.at(-1)?.name).toBe('Portable Collection');
    expect(imported.project.output.width).toBe(initial.project.output.width);

    const duplicate = await store.importCollection('Portable Collection', modified);
    expect(duplicate.collections.at(-1)?.name).toBe('Portable Collection (2)');
    expect(duplicate.project.output.width).toBe(initial.project.output.width);
  });
});

describe('LumaStream scene switch hotkey persistence', () => {
  it('round-trips scene shortcuts with the collection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-scene-hotkeys-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const workspace = await store.load();
    const sceneId = workspace.project.scenes[0]!.id;
    const project = { ...workspace.project, sceneSwitchHotkeys: { [sceneId]: 'Control+Shift+1' } };
    await store.save(workspace.activeCollectionId, workspace.activeProfileId, project);

    const restored = await store.load();
    expect(restored.project.sceneSwitchHotkeys).toEqual({ [sceneId]: 'Control+Shift+1' });
  });

  it('rejects bindings for scene IDs that are absent from the collection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-scene-hotkeys-invalid-'));
    temporaryDirectories.push(directory);
    const project = { ...createDefaultProject(), sceneSwitchHotkeys: { missing: 'Control+Shift+1' } };
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid scene switch hotkeys.');
  });
});

describe('LumaStream source visibility hotkey persistence', () => {
  it('round-trips source bindings with the collection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-source-hotkeys-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const workspace = await store.load();
    const project = structuredClone(workspace.project);
    const source = projectWithDisplaySource().scenes[0]!.sources[0]!;
    const sourceId = source.id;
    project.scenes[0]!.sources.push(source);
    project.sourceVisibilityHotkeys = { [sourceId]: 'Control+Shift+2' };
    await store.save(workspace.activeCollectionId, workspace.activeProfileId, project);

    const restored = await store.load();
    expect(restored.project.sourceVisibilityHotkeys).toEqual({ [sourceId]: 'Control+Shift+2' });
  });

  it('rejects bindings for source IDs that are absent from the collection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-source-hotkeys-invalid-'));
    temporaryDirectories.push(directory);
    const project = { ...createDefaultProject(), sourceVisibilityHotkeys: { missing: 'Control+Shift+2' } };
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid source visibility hotkeys.');
  });
});

describe('LumaStream image slideshow persistence', () => {
  it('round-trips slideshow images and playback settings', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-slideshow-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const workspace = await store.load();
    const project = workspace.project;
    project.scenes[0]!.sources.push({
      id: 'slide-show', name: 'Welcome Slides', kind: 'slideshow', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: project.output.width, height: project.output.height },
      slideshowImages: [
        { assetId: 'f53a46ac-0bd4-4cab-8ab1-3d7c5a66f0af', assetExtension: 'png', name: 'Opening' },
        { assetId: '6d8a9018-b77e-4c50-a172-4bc615b65ec7', assetExtension: 'jpg', name: 'Closing' },
      ],
      slideshowIntervalSeconds: 12,
      slideshowLoop: false,
    });

    await store.save(workspace.activeCollectionId, workspace.activeProfileId, project);
    const restored = await store.load();
    const slideshow = restored.project.scenes[0]?.sources.find((source) => source.id === 'slide-show');
    expect(slideshow?.kind).toBe('slideshow');
    expect(slideshow?.slideshowImages?.map((image) => image.name)).toEqual(['Opening', 'Closing']);
    expect(slideshow?.slideshowIntervalSeconds).toBe(12);
    expect(slideshow?.slideshowLoop).toBe(false);
  });

  it('rejects slideshow settings outside their supported bounds', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-slideshow-invalid-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.scenes[0]!.sources.push({
      id: 'slide-show', name: 'Invalid Slides', kind: 'slideshow', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: project.output.width, height: project.output.height },
      slideshowImages: [{ assetId: 'f53a46ac-0bd4-4cab-8ab1-3d7c5a66f0af', assetExtension: 'exe', name: 'Invalid' }],
      slideshowIntervalSeconds: 0,
    });
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid image slideshow settings.');
  });
});

describe('LumaStream multitrack audio persistence', () => {
  it('migrates older projects to track 1 and round-trips source and output track choices', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-audio-tracks-'));
    temporaryDirectories.push(directory);
    const legacy = projectWithMicrophoneSource();
    const source = legacy.scenes[0]?.sources[0];
    if (!source) throw new Error('Microphone source was not created.');
    delete source.audioTracks;
    delete (legacy.output as Partial<typeof legacy.output>).streamAudioTrack;
    delete (legacy.output as Partial<typeof legacy.output>).recordingAudioTracks;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(legacy), 'utf8');

    const store = new ProjectStore(directory);
    const workspace = await store.load();
    expect(workspace.project.scenes[0]?.sources[0]?.audioTracks).toEqual([1]);
    expect(workspace.project.output.streamAudioTrack).toBe(1);
    expect(workspace.project.output.recordingAudioTracks).toEqual([1]);

    const updated = {
      ...workspace.project,
      output: { ...workspace.project.output, streamAudioTrack: 4, recordingAudioTracks: [2, 4, 6] as AudioTrack[] },
      scenes: workspace.project.scenes.map((scene) => ({
        ...scene,
        sources: scene.sources.map((item) => item.id === source.id ? { ...item, audioTracks: [2, 6] as AudioTrack[] } : item),
      })),
    };
    await store.save(workspace.activeCollectionId, workspace.activeProfileId, updated as StreamProject);
    const restored = await store.load();
    expect(restored.project.output.streamAudioTrack).toBe(4);
    expect(restored.project.output.recordingAudioTracks).toEqual([2, 4, 6]);
    expect(restored.project.scenes[0]?.sources[0]?.audioTracks).toEqual([2, 6]);
  });

  it('rejects unsupported track numbers and duplicate track assignments', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-audio-tracks-'));
    temporaryDirectories.push(directory);
    const project = projectWithMicrophoneSource();
    const source = project.scenes[0]?.sources[0];
    if (!source) throw new Error('Microphone source was not created.');
    (source as unknown as { audioTracks: number[] }).audioTracks = [1, 7];
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid audio track routing.');

    source.audioTracks = [1];
    (project.output as unknown as { recordingAudioTracks: number[] }).recordingAudioTracks = [2, 2];
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid video settings.');
  });
});

describe('LumaStream capture cursor persistence', () => {
  it('defaults older display captures to motion and round-trips the selected mode', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const legacyProject = projectWithDisplaySource();
    const legacySource = legacyProject.scenes[0]?.sources[0];
    if (!legacySource) throw new Error('Display source was not created.');
    delete legacySource.cursorMode;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(legacyProject), 'utf8');

    const store = new ProjectStore(directory);
    const workspace = await store.load();
    const decodedSource = workspace.project.scenes[0]?.sources[0];
    expect(decodedSource?.cursorMode).toBe('motion');

    if (!decodedSource) throw new Error('Display source did not load.');
    const project = {
      ...workspace.project,
      scenes: workspace.project.scenes.map((scene) => ({
        ...scene,
        sources: scene.sources.map((source) => source.id === decodedSource.id ? { ...source, cursorMode: 'always' as const } : source),
      })),
    };
    await store.save(workspace.activeCollectionId, workspace.activeProfileId, project);
    const restoredSource = (await store.load()).project.scenes[0]?.sources[0];
    expect(restoredSource?.cursorMode).toBe('always');
  });

  it('rejects unsupported modes and cursor settings on non-capture sources', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithDisplaySource();
    const source = project.scenes[0]?.sources[0];
    if (!source) throw new Error('Display source was not created.');
    (source as unknown as { cursorMode: string }).cursorMode = 'sometimes';
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid cursor capture settings.');

    source.cursorMode = 'never';
    source.kind = 'camera';
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid cursor capture settings.');
  });
});

describe('LumaStream audio gain filter persistence', () => {
  it('defaults older audio filters to unity gain and round-trips the setting', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const legacyProject = projectWithMicrophoneSource();
    const source = legacyProject.scenes[0]?.sources[0];
    if (!source?.audioFilters) throw new Error('Microphone audio filters were not created.');
    delete (source.audioFilters as Partial<AudioFilters>).gainDb;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(legacyProject), 'utf8');

    const store = new ProjectStore(directory);
    const workspace = await store.load();
    expect(workspace.project.scenes[0]?.sources[0]?.audioFilters?.gainDb).toBe(0);
    const updated: StreamProject = {
      ...workspace.project,
      scenes: workspace.project.scenes.map((scene) => ({
        ...scene,
        sources: scene.sources.map((item) => item.id === source.id
          ? { ...item, audioFilters: { ...item.audioFilters!, gainDb: 8.5 } }
          : item),
      })),
    };
    await store.save(workspace.activeCollectionId, workspace.activeProfileId, updated);
    expect((await store.load()).project.scenes[0]?.sources[0]?.audioFilters?.gainDb).toBe(8.5);
  });

  it('rejects gain outside the supported range', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithMicrophoneSource();
    project.scenes[0]!.sources[0]!.audioFilters!.gainDb = 30.5;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid audio filters.');
  });
});

describe('LumaStream video canvas persistence', () => {
  it('round-trips custom dimensions and fractional frame rates', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.output.width = 1600;
    project.output.height = 900;
    project.output.frameRate = 59.94;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    const restored = (await new ProjectStore(directory).load()).project.output;
    expect(restored.width).toBe(1600);
    expect(restored.height).toBe(900);
    expect(restored.frameRate).toBe(59.94);
  });

  it('rejects custom canvas dimensions and frame rates outside engine bounds', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.output.width = 16385;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid video settings.');

    project.output.width = 1920;
    project.output.frameRate = 240.01;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid video settings.');
  });
});

describe('LumaStream audio balance persistence', () => {
  it('defaults legacy sources to center and preserves left/right balance', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithDisplaySource();
    const source = project.scenes[0]?.sources[0];
    if (!source) throw new Error('Display source was not created.');
    delete source.balance;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    const store = new ProjectStore(directory);
    const loaded = await store.load();
    expect(loaded.project.scenes[0]?.sources[0]?.balance).toBe(0);
    const changed = {
      ...loaded.project,
      scenes: loaded.project.scenes.map((scene) => ({
        ...scene,
        sources: scene.sources.map((item) => item.id === source.id ? { ...item, balance: -0.65 } : item),
      })),
    };
    await store.save(loaded.activeCollectionId, loaded.activeProfileId, changed);
    expect((await store.load()).project.scenes[0]?.sources[0]?.balance).toBe(-0.65);
  });

  it('rejects a balance outside the supported stereo range', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithDisplaySource();
    const source = project.scenes[0]?.sources[0];
    if (!source) throw new Error('Display source was not created.');
    source.balance = 1.01;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid source audio balance.');
  });
});

describe('LumaStream source lock persistence', () => {
  it('defaults legacy sources to unlocked and round-trips a locked source', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithDisplaySource();
    const source = project.scenes[0]?.sources[0];
    if (!source) throw new Error('Display source was not created.');
    delete source.locked;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    const store = new ProjectStore(directory);
    const loaded = await store.load();
    expect(loaded.project.scenes[0]?.sources[0]?.locked).toBe(false);
    const changed = {
      ...loaded.project,
      scenes: loaded.project.scenes.map((scene) => ({
        ...scene,
        sources: scene.sources.map((item) => item.id === source.id ? { ...item, locked: true } : item),
      })),
    };
    await store.save(loaded.activeCollectionId, loaded.activeProfileId, changed);
    expect((await store.load()).project.scenes[0]?.sources[0]?.locked).toBe(true);
  });

  it('rejects a non-boolean saved lock setting', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = projectWithDisplaySource();
    const source = project.scenes[0]?.sources[0];
    if (!source) throw new Error('Display source was not created.');
    (source as unknown as { locked: string }).locked = 'yes';
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid source lock settings.');
  });
});

describe('LumaStream camera capture settings persistence', () => {
  it('round-trips selected camera resolution and frame rate', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const workspace = await store.load();
    const project = {
      ...workspace.project,
      scenes: workspace.project.scenes.map((scene, index) => index === 0 ? {
        ...scene,
        sources: [...scene.sources, {
          id: 'camera-source', name: 'USB Camera', kind: 'camera' as const, visible: true, muted: false, volume: 1,
          transform: { x: 0, y: 0, width: 640, height: 360 }, deviceId: 'camera-device',
          cameraResolution: '1920x1080' as const, cameraFrameRate: 60 as const,
        }],
      } : scene),
    };
    await store.save(workspace.activeCollectionId, workspace.activeProfileId, project);

    const camera = (await store.load()).project.scenes[0]?.sources.find((source) => source.id === 'camera-source');
    expect(camera).toMatchObject({ deviceId: 'camera-device', cameraResolution: '1920x1080', cameraFrameRate: 60 });
  });

  it('rejects camera modes outside the supported presets', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.scenes[0]!.sources.push({
      id: 'camera-source', name: 'USB Camera', kind: 'camera', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 640, height: 360 }, cameraFrameRate: 120 as never,
    });
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid camera frame-rate settings.');
  });
});

describe('LumaStream output profile persistence', () => {
  it('seeds Profile 1 from a legacy project without losing output settings or hotkeys', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-profiles-'));
    temporaryDirectories.push(directory);
    const legacy = createDefaultProject();
    legacy.output.width = 2560;
    legacy.output.height = 1440;
    legacy.hotkeys.toggleRecording = 'Control+Alt+R';
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(legacy), 'utf8');

    const workspace = await new ProjectStore(directory).load();
    expect(workspace.profiles).toEqual([{ id: workspace.activeProfileId, name: 'Profile 1' }]);
    expect(workspace.project.output.width).toBe(2560);
    expect(workspace.project.hotkeys.toggleRecording).toBe('Control+Alt+R');
  });

  it('shares active profile output settings across scene collections', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-profiles-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const original = await store.load();
    const configured = {
      ...original.project,
      output: { ...original.project.output, width: 2560, height: 1440 },
      hotkeys: { ...original.project.hotkeys, toggleRecording: 'Control+Alt+R' },
    };
    await store.save(original.activeCollectionId, original.activeProfileId, configured);

    const secondCollection = await store.create('Second Show', false);
    expect(secondCollection.activeProfileId).toBe(original.activeProfileId);
    expect(secondCollection.project.output.width).toBe(2560);
    expect(secondCollection.project.hotkeys.toggleRecording).toBe('Control+Alt+R');

    const alternateProfile = await store.createProfile('Vertical Stream', false);
    expect(alternateProfile.project.output.width).toBe(1920);
    const restored = await store.activateProfile(original.activeProfileId);
    expect(restored.project.output.width).toBe(2560);
    expect(restored.project.hotkeys.toggleRecording).toBe('Control+Alt+R');
  });

  it('duplicates, renames, activates, and deletes profiles while preserving the final profile', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-profiles-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const original = await store.load();
    const duplicate = await store.createProfile('Backup Setup', true);
    expect(duplicate.profiles).toHaveLength(2);
    expect(duplicate.project.output).toEqual(original.project.output);

    const duplicateId = duplicate.activeProfileId;
    const renamed = await store.renameProfile(duplicateId, 'Backup Setup 2');
    expect(renamed.find((profile) => profile.id === duplicateId)?.name).toBe('Backup Setup 2');
    await expect(store.createProfile('profile 1', false)).rejects.toThrow('A profile with that name already exists.');

    const afterDelete = await store.deleteProfile(duplicateId);
    expect(afterDelete.profiles).toEqual(original.profiles);
    await expect(store.deleteProfile(original.activeProfileId)).rejects.toThrow('The final profile cannot be deleted.');
  });

  it('rejects saves queued against a profile after another profile becomes active', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-profiles-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const original = await store.load();
    const changed = await store.createProfile('New Output', false);
    await expect(store.save(original.activeCollectionId, original.activeProfileId, original.project))
      .rejects.toThrow('The active profile changed before these settings could be saved.');
    expect(changed.activeProfileId).not.toBe(original.activeProfileId);
  });

  it('exports and imports validated profiles with a unique name when one already exists', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-profiles-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const original = await store.load();
    const configured = {
      ...original.project,
      output: { ...original.project.output, width: 2560, height: 1440 },
      hotkeys: { ...original.project.hotkeys, toggleRecording: 'Control+Alt+R' },
    };
    await store.save(original.activeCollectionId, original.activeProfileId, configured);
    const exported = await store.exportProfile(original.activeProfileId);
    expect(exported.format).toBe('lumastream-profile');

    const imported = await store.importProfile({ ...exported, name: 'Portable Setup' });
    expect(imported.project.output.width).toBe(2560);
    expect(imported.project.hotkeys.toggleRecording).toBe('Control+Alt+R');
    const renamedDuplicate = await store.importProfile({ ...exported, name: 'Portable Setup' });
    expect(renamedDuplicate.profiles.find((profile) => profile.id === renamedDuplicate.activeProfileId)?.name).toBe('Portable Setup (2)');

    await expect(store.importProfile({ ...exported, format: 'obs-profile' }))
      .rejects.toThrow('This file is not a supported LumaStream profile.');
    await expect(store.importProfile({ ...exported, output: { ...exported.output, width: 128 } }))
      .rejects.toThrow('Project contains invalid video settings.');
  });
});
