// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultProject, createDefaultTextStyle, type AudioFilters, type AudioTrack, type StreamProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { ProjectStore } from '../../../../apps/stream/main/project-store';
import { MAX_SOURCE_GROUP_DEPTH } from '../../../../apps/stream/shared/source-tree';

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

function projectWithTextSource(): StreamProject {
  const project = createDefaultProject();
  const scene = project.scenes[0];
  if (!scene) throw new Error('Default Stream project has no scene.');
  scene.sources.push({
    id: 'text-source', name: 'Title', kind: 'text', visible: true, muted: false, volume: 1,
    transform: { x: 100, y: 80, width: 800, height: 240 }, text: 'Stream title', color: '#ffffff', textStyle: createDefaultTextStyle(),
  });
  return project;
}

describe('LumaStream text source persistence', () => {
  it('applies safe text style defaults to legacy sources and round-trips customized styles', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-text-'));
    temporaryDirectories.push(directory);
    const legacy = projectWithTextSource();
    const legacySource = legacy.scenes[0]?.sources.find((source) => source.kind === 'text');
    if (!legacySource) throw new Error('Text source was not created.');
    delete legacySource.textStyle;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(legacy), 'utf8');

    const store = new ProjectStore(directory);
    const loaded = await store.load();
    expect(loaded.project.scenes[0]?.sources.find((source) => source.id === legacySource.id)?.textStyle).toEqual(createDefaultTextStyle());
    const style = createDefaultTextStyle();
    style.fontFamily = 'Georgia';
    style.fontSize = 68;
    style.bold = false;
    style.italic = true;
    style.horizontalAlignment = 'center';
    style.verticalAlignment = 'bottom';
    style.outline = { enabled: true, color: '#123456', width: 5 };
    style.shadow = { enabled: true, color: '#654321', blur: 18, offsetX: -7, offsetY: 12 };
    style.background = { color: '#abcdef', opacity: 0.42 };
    const changed: StreamProject = {
      ...loaded.project,
      scenes: loaded.project.scenes.map((scene) => ({
        ...scene,
        sources: scene.sources.map((source) => source.id === legacySource.id ? { ...source, textStyle: style } : source),
      })),
    };
    await store.save(loaded.activeCollectionId, loaded.activeProfileId, changed);
    expect((await store.load()).project.scenes[0]?.sources.find((source) => source.id === legacySource.id)?.textStyle).toEqual(style);
  });

  it.each([
    ['font size', (style: Record<string, unknown>) => { style.fontSize = 513; }],
    ['font family', (style: Record<string, unknown>) => { style.fontFamily = ''; }],
    ['alignment', (style: Record<string, unknown>) => { style.horizontalAlignment = 'justify'; }],
    ['outline color', (style: Record<string, unknown>) => { (style.outline as Record<string, unknown>).color = 'red'; }],
    ['shadow offset', (style: Record<string, unknown>) => { (style.shadow as Record<string, unknown>).offsetX = 129; }],
    ['background opacity', (style: Record<string, unknown>) => { (style.background as Record<string, unknown>).opacity = 1.1; }],
  ])('rejects invalid text %s', async (_name, mutate) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-text-invalid-'));
    temporaryDirectories.push(directory);
    const project = projectWithTextSource();
    const source = project.scenes[0]?.sources.find((item) => item.kind === 'text');
    if (!source?.textStyle) throw new Error('Text source settings were not created.');
    mutate(source.textStyle as unknown as Record<string, unknown>);
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid text settings.');
  });

  it('rejects text styling on non-text sources', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-text-kind-'));
    temporaryDirectories.push(directory);
    const project = projectWithDisplaySource();
    const source = project.scenes[0]?.sources.find((item) => item.kind === 'display');
    if (!source) throw new Error('Display source was not created.');
    (source as unknown as { textStyle: unknown }).textStyle = createDefaultTextStyle();
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid text settings.');
  });
});

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

    const store = new ProjectStore(directory, { platform: 'win32' });
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

    await expect(new ProjectStore(directory, { platform: 'win32' }).load()).rejects.toThrow('Project contains invalid video settings.');
  });

  it('coerces encoder families from another platform to the host default', async () => {
    const win32Directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(win32Directory);
    const win32Project = createDefaultProject('win32');
    win32Project.output.streamVideoEncoder = 'h264_nvenc';
    win32Project.output.streamRateControl = 'cbr';
    win32Project.output.recordingVideoEncoder = 'h264_mf';
    win32Project.output.recordingRateControl = 'cbr';
    await writeFile(path.join(win32Directory, 'scene-collection.json'), JSON.stringify(win32Project), 'utf8');

    const onDarwin = await new ProjectStore(win32Directory, { platform: 'darwin' }).load();
    expect(onDarwin.project.output.streamVideoEncoder).toBe('h264_videotoolbox');
    expect(onDarwin.project.output.streamRateControl).toBe('cbr');
    expect(onDarwin.project.output.recordingVideoEncoder).toBe('h264_videotoolbox');

    const darwinDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(darwinDirectory);
    const darwinProject = createDefaultProject('darwin');
    darwinProject.output.streamVideoEncoder = 'h264_videotoolbox';
    darwinProject.output.streamRateControl = 'cbr';
    await writeFile(path.join(darwinDirectory, 'scene-collection.json'), JSON.stringify(darwinProject), 'utf8');

    const onWin32 = await new ProjectStore(darwinDirectory, { platform: 'win32' }).load();
    expect(onWin32.project.output.streamVideoEncoder).toBe('h264_mf');

    const openH264Directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(openH264Directory);
    const openH264Project = createDefaultProject('linux');
    openH264Project.output.streamVideoEncoder = 'libopenh264';
    openH264Project.output.streamRateControl = 'cbr';
    await writeFile(path.join(openH264Directory, 'scene-collection.json'), JSON.stringify(openH264Project), 'utf8');

    const openH264OnDarwin = await new ProjectStore(openH264Directory, { platform: 'darwin' }).load();
    expect(openH264OnDarwin.project.output.streamVideoEncoder).toBe('h264_videotoolbox');
    expect(openH264OnDarwin.project.output.streamRateControl).toBe('cbr');
  });

  it('creates default collections with the host platform encoder', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const workspace = await new ProjectStore(directory, { platform: 'darwin' }).load();
    expect(workspace.project.output.streamVideoEncoder).toBe('h264_videotoolbox');
    expect(workspace.project.output.recordingVideoEncoder).toBe('h264_videotoolbox');
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

  it('keeps the scene canvas separate from scaled output dimensions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.output.baseWidth = 2560;
    project.output.baseHeight = 1440;
    project.output.width = 1280;
    project.output.height = 720;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    const restored = (await new ProjectStore(directory).load()).project.output;
    expect(restored).toMatchObject({ baseWidth: 2560, baseHeight: 1440, width: 1280, height: 720 });
  });

  it('uses the old output dimensions as the canvas for projects without base dimensions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.output.width = 1600;
    project.output.height = 900;
    delete (project.output as Partial<typeof project.output>).baseWidth;
    delete (project.output as Partial<typeof project.output>).baseHeight;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');

    const restored = (await new ProjectStore(directory).load()).project.output;
    expect(restored).toMatchObject({ baseWidth: 1600, baseHeight: 900, width: 1600, height: 900 });
  });

  it('rejects custom canvas dimensions and frame rates outside engine bounds', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-project-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    project.output.width = 16385;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid video settings.');

    project.output.width = 1920;
    project.output.baseWidth = 16385;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid video settings.');

    project.output.baseWidth = 1920;
    project.output.baseHeight = 179;
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    await expect(new ProjectStore(directory).load()).rejects.toThrow('Project contains invalid video settings.');

    project.output.baseHeight = 1080;
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

describe('LumaStream source group persistence', () => {
  it('round-trips group children and regenerates every source ID when a collection is duplicated', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-source-groups-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const initial = await store.load();
    const project = structuredClone(initial.project);
    project.scenes[0]!.sources.push({
      id: 'group-root', name: 'Overlay', kind: 'group', visible: true, muted: false, volume: 1,
      transform: { x: 100, y: 100, width: 800, height: 500 },
      children: [{
        id: 'group-child', name: 'Title', kind: 'text', visible: true, muted: false, volume: 1,
        transform: { x: 100, y: 100, width: 800, height: 500 }, text: 'Title', color: '#ffffff',
      }],
    });

    const imported = await store.importCollection('Grouped Collection', project);
    const group = imported.project.scenes[0]?.sources.find((source) => source.kind === 'group');
    expect(group?.children?.[0]?.name).toBe('Title');

    const duplicate = await store.create('Grouped Copy', true);
    const duplicateGroup = duplicate.project.scenes[0]?.sources.find((source) => source.kind === 'group');
    expect(duplicateGroup?.id).not.toBe(group?.id);
    expect(duplicateGroup?.children?.[0]?.id).not.toBe(group?.children?.[0]?.id);
  });

  it('accepts nested groups and rejects nesting beyond the safe limit or duplicate IDs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-invalid-groups-'));
    temporaryDirectories.push(directory);
    const project = createDefaultProject();
    const leaf: StreamSource = {
      id: 'group-leaf', name: 'Leaf', kind: 'text', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1, height: 1 }, text: 'Leaf', color: '#ffffff',
    };
    project.scenes[0]!.sources.push({
      id: 'group-root', name: 'Group', kind: 'group', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1, height: 1 },
      children: [{ id: 'group-child', name: 'Nested', kind: 'group', visible: true, muted: false, volume: 1, transform: { x: 0, y: 0, width: 1, height: 1 }, children: [leaf] }],
    });
    await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
    expect((await new ProjectStore(directory).load()).project.scenes[0]?.sources[0]?.children?.[0]?.children?.[0]?.id).toBe('group-leaf');

    const maxDepthDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-max-depth-groups-'));
    temporaryDirectories.push(maxDepthDirectory);
    const maxDepthProject = createDefaultProject();
    let maxDepthSource: StreamSource = leaf;
    for (let depth = 0; depth < MAX_SOURCE_GROUP_DEPTH; depth += 1) {
      maxDepthSource = { id: `max-group-${depth}`, name: `Max Group ${depth}`, kind: 'group', visible: true, muted: false, volume: 1, transform: { x: 0, y: 0, width: 1, height: 1 }, children: [maxDepthSource] };
    }
    maxDepthProject.scenes[0]!.sources.push(maxDepthSource);
    await writeFile(path.join(maxDepthDirectory, 'scene-collection.json'), JSON.stringify(maxDepthProject), 'utf8');
    expect((await new ProjectStore(maxDepthDirectory).load()).project.scenes[0]?.sources[0]?.id).toBe(`max-group-${MAX_SOURCE_GROUP_DEPTH - 1}`);

    const tooDeepDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-deep-groups-'));
    temporaryDirectories.push(tooDeepDirectory);
    const tooDeepProject = createDefaultProject();
    let nested: StreamSource = leaf;
    for (let depth = 0; depth <= MAX_SOURCE_GROUP_DEPTH; depth += 1) {
      nested = { id: `group-${depth}`, name: `Group ${depth}`, kind: 'group', visible: true, muted: false, volume: 1, transform: { x: 0, y: 0, width: 1, height: 1 }, children: [nested] };
    }
    tooDeepProject.scenes[0]!.sources.push(nested);
    await writeFile(path.join(tooDeepDirectory, 'scene-collection.json'), JSON.stringify(tooDeepProject), 'utf8');
    await expect(new ProjectStore(tooDeepDirectory).load()).rejects.toThrow('Source groups exceed the maximum nesting depth.');

    const duplicateDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-duplicate-group-ids-'));
    temporaryDirectories.push(duplicateDirectory);
    const duplicateProject = createDefaultProject();
    duplicateProject.scenes[0]!.sources.push({
      id: 'shared-id', name: 'Group', kind: 'group', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1, height: 1 },
      children: [{
        id: 'shared-id', name: 'Child', kind: 'text', visible: true, muted: false, volume: 1,
        transform: { x: 0, y: 0, width: 1, height: 1 }, text: 'Child', color: '#ffffff',
      }],
    });
    await writeFile(path.join(duplicateDirectory, 'scene-collection.json'), JSON.stringify(duplicateProject), 'utf8');
    await expect(new ProjectStore(duplicateDirectory).load()).rejects.toThrow('Project contains duplicate source IDs.');
  });
});

describe('LumaStream Scene source persistence', () => {
  it('round-trips Scene source references and remaps scene, source, and hotkey IDs when duplicating a collection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-scene-source-'));
    temporaryDirectories.push(directory);
    const store = new ProjectStore(directory);
    const initial = await store.load();
    const project = structuredClone(initial.project);
    const owner = project.scenes[0]!;
    const target = { id: 'reusable-scene', name: 'Reusable', sources: [] };
    owner.sources.push({
      id: 'scene-reference', name: 'Reusable', kind: 'scene', visible: true, muted: false, volume: 1,
      transform: { x: 120, y: 90, width: 960, height: 540 }, referencedSceneId: target.id,
    });
    project.scenes.push(target);
    project.sceneSwitchHotkeys = { [owner.id]: 'Control+1', [target.id]: 'Control+2' };
    project.sourceVisibilityHotkeys = { 'scene-reference': 'Control+Shift+1' };

    const imported = await store.importCollection('Reusable Scenes', project);
    expect(imported.project.scenes[0]?.sources.find((source) => source.id === 'scene-reference')?.referencedSceneId).toBe(target.id);

    const duplicate = await store.create('Reusable Scenes Copy', true);
    const duplicateOwner = duplicate.project.scenes.find((scene) => scene.name === owner.name)!;
    const duplicateTarget = duplicate.project.scenes.find((scene) => scene.name === target.name)!;
    const duplicateReference = duplicateOwner.sources.find((source) => source.kind === 'scene');
    expect(duplicateReference?.id).not.toBe('scene-reference');
    expect(duplicateReference?.referencedSceneId).toBe(duplicateTarget.id);
    expect(duplicate.project.sceneSwitchHotkeys).toEqual({ [duplicateOwner.id]: 'Control+1', [duplicateTarget.id]: 'Control+2' });
    expect(duplicate.project.sourceVisibilityHotkeys).toEqual({ [duplicateReference!.id]: 'Control+Shift+1' });
  });

  it('rejects missing targets, self and indirect cycles, and references on non-Scene sources', async () => {
    const invalidProjects: Array<{ project: StreamProject; error: string }> = [];
    const missing = createDefaultProject();
    missing.scenes[0]!.sources.push({
      id: 'scene-ref', name: 'Missing', kind: 'scene', referencedSceneId: 'absent', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    invalidProjects.push({ project: missing, error: 'A scene source references a scene that does not exist.' });

    const selfCycle = createDefaultProject();
    selfCycle.scenes[0]!.sources.push({
      id: 'scene-ref', name: 'Self', kind: 'scene', referencedSceneId: selfCycle.scenes[0]!.id, visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    invalidProjects.push({ project: selfCycle, error: 'Scene references cannot contain a cycle.' });

    const indirectCycle = createDefaultProject();
    const first = indirectCycle.scenes[0]!;
    const second = { id: 'second-scene', name: 'Second', sources: [] as StreamSource[] };
    first.sources.push({
      id: 'first-to-second', name: 'Second', kind: 'scene', referencedSceneId: second.id, visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    second.sources.push({
      id: 'second-to-first', name: 'First', kind: 'scene', referencedSceneId: first.id, visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    indirectCycle.scenes.push(second);
    invalidProjects.push({ project: indirectCycle, error: 'Scene references cannot contain a cycle.' });

    const wrongKind = createDefaultProject();
    wrongKind.scenes[0]!.sources.push({
      id: 'color-ref', name: 'Color', kind: 'color', color: '#ffffff', referencedSceneId: wrongKind.scenes[0]!.id, visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    invalidProjects.push({ project: wrongKind, error: 'Project contains an invalid Scene source reference.' });

    for (const { project, error } of invalidProjects) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-invalid-scene-ref-'));
      temporaryDirectories.push(directory);
      await writeFile(path.join(directory, 'scene-collection.json'), JSON.stringify(project), 'utf8');
      await expect(new ProjectStore(directory).load()).rejects.toThrow(error);
    }
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
      output: { ...original.project.output, baseWidth: 2560, baseHeight: 1440, width: 1280, height: 720 },
      hotkeys: { ...original.project.hotkeys, toggleRecording: 'Control+Alt+R' },
    };
    await store.save(original.activeCollectionId, original.activeProfileId, configured);

    const secondCollection = await store.create('Second Show', false);
    expect(secondCollection.activeProfileId).toBe(original.activeProfileId);
    expect(secondCollection.project.output).toMatchObject({ baseWidth: 2560, baseHeight: 1440, width: 1280, height: 720 });
    expect(secondCollection.project.hotkeys.toggleRecording).toBe('Control+Alt+R');

    const alternateProfile = await store.createProfile('Vertical Stream', false);
    expect(alternateProfile.project.output).toMatchObject({ baseWidth: 1920, baseHeight: 1080, width: 1920, height: 1080 });
    const restored = await store.activateProfile(original.activeProfileId);
    expect(restored.project.output).toMatchObject({ baseWidth: 2560, baseHeight: 1440, width: 1280, height: 720 });
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
      output: { ...original.project.output, baseWidth: 2560, baseHeight: 1440, width: 1280, height: 720 },
      hotkeys: { ...original.project.hotkeys, toggleRecording: 'Control+Alt+R' },
    };
    await store.save(original.activeCollectionId, original.activeProfileId, configured);
    const exported = await store.exportProfile(original.activeProfileId);
    expect(exported.format).toBe('lumastream-profile');

    const imported = await store.importProfile({ ...exported, name: 'Portable Setup' });
    expect(imported.project.output).toMatchObject({ baseWidth: 2560, baseHeight: 1440, width: 1280, height: 720 });
    expect(imported.project.hotkeys.toggleRecording).toBe('Control+Alt+R');
    const renamedDuplicate = await store.importProfile({ ...exported, name: 'Portable Setup' });
    expect(renamedDuplicate.profiles.find((profile) => profile.id === renamedDuplicate.activeProfileId)?.name).toBe('Portable Setup (2)');

    await expect(store.importProfile({ ...exported, format: 'obs-profile' }))
      .rejects.toThrow('This file is not a supported LumaStream profile.');
    await expect(store.importProfile({ ...exported, output: { ...exported.output, width: 128 } }))
      .rejects.toThrow('Project contains invalid video settings.');
  });
});
