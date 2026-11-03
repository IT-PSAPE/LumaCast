import { describe, expect, it } from 'vitest';
import { getVisibleSourceIdsForScenes } from '../../../../apps/stream/shared/scene-reference-graph';
import { mergeRuntimeSources, getOriginSourceId, getSourceRuntimeId, preserveDesktopCaptureRuntime, toRuntimeProject, toRuntimeSource } from '../../../../apps/stream/renderer/source-runtime';
import { bindDesktopCaptureSource } from '../../../../apps/stream/renderer/desktop-capture-binding';
import { cloneSceneSource, createSource } from '../../../../apps/stream/renderer/features/sources/helpers';
import { createDefaultProject, type StreamProject, type StreamScene, type StreamSource } from '../../../../apps/stream/shared/desktop-api';

function source(overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id: 'source-a', name: 'Source', kind: 'media', visible: true, muted: false, volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 }, assetId: 'asset-a', assetExtension: 'mp4', mediaKind: 'video',
    ...overrides,
  };
}

function visibleOriginIds(scenes: readonly StreamScene[], rootSceneIds: readonly string[]): Set<string> {
  const toLogicalSource = (source: StreamSource): StreamSource => ({
    ...source,
    id: getOriginSourceId(source),
    ...(source.kind === 'group' ? { children: (source.children ?? []).map(toLogicalSource) } : {}),
  });
  const logicalScenes = scenes.map((scene) => ({ ...scene, sources: scene.sources.map(toLogicalSource) }));
  return getVisibleSourceIdsForScenes(logicalScenes, rootSceneIds);
}

describe('source runtime bindings', () => {
  it('allocates stable native-safe UUIDs per stateful resource and logical capture source', () => {
    const first = source();
    const sameResource = source({
      volume: 0.4, muted: true, loop: true, balance: -0.5,
      transform: { x: 10, y: 20, width: 300, height: 200 },
      filters: { brightness: 0.6, contrast: 1.2, saturation: 0.7, opacity: 0.5, blur: 2 },
    });
    const changedResource = source({ assetId: 'asset-b' });
    const sameAssetCopy = source({ id: 'source-copy', volume: 0.8, muted: true, transform: { x: 10, y: 20, width: 300, height: 200 } });
    const audioAsset = source({ id: 'audio-copy', mediaKind: 'audio' });

    const runtimeId = getSourceRuntimeId(first);
    expect(runtimeId).toMatch(/^[0-9a-f-]{16,128}$/i);
    expect(getSourceRuntimeId(sameResource)).toBe(runtimeId);
    expect(getSourceRuntimeId(sameAssetCopy)).toBe(runtimeId);
    expect(getSourceRuntimeId(changedResource)).not.toBe(runtimeId);
    expect(getSourceRuntimeId(audioAsset)).not.toBe(runtimeId);
    expect(getSourceRuntimeId(source({ kind: 'scene', referencedSceneId: 'scene-a' })))
      .not.toBe(getSourceRuntimeId(source({ kind: 'scene', referencedSceneId: 'scene-b' })));
  });

  it('shares ordered slideshow and presentation resources across origins, but distinguishes page changes and order', () => {
    const pages = [
      { assetId: 'page-a', assetExtension: 'png', name: 'A' },
      { assetId: 'page-b', assetExtension: 'jpg', name: 'B' },
    ];
    const firstSlideshow = source({ id: 'show-a', kind: 'slideshow', slideshowImages: pages, slideIndex: 0 });
    const sameSlideshow = { ...firstSlideshow, id: 'show-b', name: 'Renamed', slideIndex: 1, slideshowAutoAdvance: true, slideshowPlaybackId: 'playback-b' };
    const reorderedSlideshow = { ...sameSlideshow, slideshowImages: [...pages].reverse() };
    const changedSlideshow = { ...sameSlideshow, slideshowImages: [pages[0]!, { assetId: 'page-c', assetExtension: 'png', name: 'C' }] };
    const firstPresentation = source({ id: 'deck-a', kind: 'presentation', presentationSlides: pages, slideIndex: 0 });
    const samePresentation = { ...firstPresentation, id: 'deck-b', slideIndex: 9 };
    const reorderedPresentation = { ...samePresentation, presentationSlides: [...pages].reverse() };

    expect(getSourceRuntimeId(firstSlideshow)).toBe(getSourceRuntimeId(sameSlideshow));
    expect(getSourceRuntimeId(firstSlideshow)).not.toBe(getSourceRuntimeId(reorderedSlideshow));
    expect(getSourceRuntimeId(firstSlideshow)).not.toBe(getSourceRuntimeId(changedSlideshow));
    expect(getSourceRuntimeId(firstPresentation)).toBe(getSourceRuntimeId(samePresentation));
    expect(getSourceRuntimeId(firstPresentation)).not.toBe(getSourceRuntimeId(reorderedPresentation));
    expect(getSourceRuntimeId(firstSlideshow)).not.toBe(getSourceRuntimeId(firstPresentation));
  });

  it('shares browser sessions by normalized URL and viewport across origins', () => {
    const first = source({ id: 'browser-a', kind: 'browser', url: 'HTTPS://Example.test:443' });
    const same = { ...first, id: 'browser-b', url: 'https://example.test/' };
    const changedUrl = { ...same, url: 'https://example.test/watch' };
    const viewport = { width: 1920, height: 1080 };

    expect(getSourceRuntimeId(first, viewport)).toBe(getSourceRuntimeId(same, viewport));
    expect(getSourceRuntimeId(first, viewport)).not.toBe(getSourceRuntimeId(changedUrl, viewport));
    expect(getSourceRuntimeId(first, viewport)).not.toBe(getSourceRuntimeId(same, { width: 1280, height: 720 }));
    expect(getSourceRuntimeId({ ...same, id: 'invalid-browser-copy', url: 'not a URL' }, viewport))
      .not.toBe(getSourceRuntimeId({ ...same, id: 'invalid-browser-copy-2', url: 'not a URL' }, viewport));
  });

  it.each(['display', 'window', 'camera', 'microphone', 'desktop-audio', 'application-audio', 'ndi', 'group', 'scene'] as const)(
    'keeps %s runtime identity scoped to its logical source origin',
    (kind) => {
      const first = source({ id: `${kind}-first`, kind });
      const copy = source({ id: `${kind}-copy`, kind });
      expect(getSourceRuntimeId(first)).not.toBe(getSourceRuntimeId(copy));
    },
  );

  it('allocates separate camera runtime resources when audio capture or its explicit input changes', () => {
    const camera = source({ id: 'camera', kind: 'camera' });
    const cameraCopy = { ...camera, id: 'camera-copy' };
    const cameraWithAudio = { ...camera, captureAudioEnabled: true, audioDeviceId: 'audio-1' };
    expect(getSourceRuntimeId(cameraCopy)).not.toBe(getSourceRuntimeId(camera));
    expect(getSourceRuntimeId(cameraWithAudio)).not.toBe(getSourceRuntimeId(camera));
    expect(getSourceRuntimeId({ ...cameraWithAudio, audioDeviceId: 'audio-2' })).not.toBe(getSourceRuntimeId(cameraWithAudio));
    expect(getSourceRuntimeId({ ...cameraWithAudio, captureAudioEnabled: false })).not.toBe(getSourceRuntimeId(cameraWithAudio));
  });

  it('gives each new and cloned desktop capture source its own binding generation', () => {
    const output = createDefaultProject('darwin').output;
    const window = createSource('window', output);
    const display = createSource('display', output);
    const windowBindingId = window.captureBindingId;
    const displayBindingId = display.captureBindingId;
    const cloned = cloneSceneSource(window);

    expect(windowBindingId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(displayBindingId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(cloned.captureBindingId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(cloned.captureBindingId).not.toBe(windowBindingId);
  });

  it('binds desktop audio settings but not durable capture target metadata to runtime identity', () => {
    const display = source({
      id: 'display-runtime-contract', kind: 'display', captureId: 'screen:1',
      captureTarget: { kind: 'screen', name: 'Conference Room', displayId: 'display-1' },
    });
    const renamedTarget = {
      ...display,
      captureTarget: { kind: 'screen' as const, name: 'Renamed Conference Room', displayId: 'display-2' },
    };
    const appAudio = {
      ...display,
      captureAudioMode: 'application' as const,
      captureAudioApplicationPath: 'C:\\Program Files\\Capture App\\capture.exe',
    };
    const changedAppAudioPath = { ...appAudio, captureAudioApplicationPath: 'C:\\Program Files\\Other App\\capture.exe' };
    const systemAudio = { ...appAudio, captureAudioMode: 'system' as const, captureAudioApplicationPath: undefined };

    expect(getSourceRuntimeId(renamedTarget)).toBe(getSourceRuntimeId(display));
    expect(getSourceRuntimeId(appAudio)).not.toBe(getSourceRuntimeId(display));
    expect(getSourceRuntimeId(changedAppAudioPath)).not.toBe(getSourceRuntimeId(appAudio));
    expect(getSourceRuntimeId(systemAudio)).not.toBe(getSourceRuntimeId(appAudio));
  });

  it('aliases only automatic desktop capture recovery to the requested runtime binding', () => {
    const bindingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const current = source({
      id: 'automatic-capture-origin', kind: 'display', captureId: 'screen:original',
      captureBindingId: bindingId,
      captureTarget: { kind: 'screen', name: 'Studio', displayId: 'display-original' },
    });
    const refreshed = {
      ...current,
      captureId: 'screen:refreshed-handle',
      captureBindingId: bindingId,
      captureTarget: { kind: 'screen' as const, name: 'Studio', displayId: 'display-refreshed' },
    };
    const requestedRuntimeId = getSourceRuntimeId(current);

    expect(getSourceRuntimeId(source({
      id: 'legacy-capture-origin', kind: 'display', captureId: 'screen:legacy',
    }))).toBe(getSourceRuntimeId(source({
      id: 'legacy-capture-origin', kind: 'display', captureId: 'screen:legacy',
      captureTarget: { kind: 'screen', name: 'Studio', displayId: 'display-added-later' },
      cursorMode: 'motion',
    })));
    expect(getSourceRuntimeId({ ...current, cursorMode: 'motion' })).toBe(requestedRuntimeId);
    expect(preserveDesktopCaptureRuntime(current, refreshed)).toBe(requestedRuntimeId);
    expect(getSourceRuntimeId(refreshed)).toBe(requestedRuntimeId);

    const legacyCurrent = source({ id: 'legacy-auto-alias-origin', kind: 'window', captureId: 'window:legacy-old:0' });
    const legacyRefreshed = { ...legacyCurrent, captureId: 'window:legacy-new:4' };
    const legacyRuntimeId = getSourceRuntimeId(legacyCurrent);
    expect(preserveDesktopCaptureRuntime(legacyCurrent, legacyRefreshed)).toBe(legacyRuntimeId);
    expect(getSourceRuntimeId(legacyRefreshed)).toBe(legacyRuntimeId);

    const manuallySelectedTarget = { ...current, captureId: 'screen:manual-target', captureBindingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    expect(getSourceRuntimeId(manuallySelectedTarget)).not.toBe(requestedRuntimeId);
  });

  it('does not let an old automatic alias swallow a manual target that reuses its native ID', () => {
    const oldTarget = { kind: 'window' as const, name: 'Original window', appIconHash: 'a'.repeat(64) };
    const oldBindingId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const current = source({
      id: 'reused-window-handle-origin', kind: 'window', captureId: 'window:reused:0',
      captureTarget: oldTarget, captureBindingId: oldBindingId,
    });
    const originalRuntimeId = getSourceRuntimeId(current);
    const autoOption = {
      id: 'window:current:0', name: 'Current window', kind: 'window' as const, thumbnail: '', appIconHash: 'b'.repeat(64),
    };
    const automatic = bindDesktopCaptureSource(current, autoOption, 'motion', 'automatic-restore');
    preserveDesktopCaptureRuntime(current, automatic);
    expect(getSourceRuntimeId(automatic)).toBe(originalRuntimeId);

    const explicitlySelected = bindDesktopCaptureSource(automatic, {
      id: 'window:reused:0', name: 'A different window', kind: 'window', thumbnail: '', appIconHash: 'c'.repeat(64),
    }, 'motion');

    expect(explicitlySelected.captureBindingId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(explicitlySelected.captureBindingId).not.toBe(oldBindingId);
    expect(getSourceRuntimeId(explicitlySelected)).not.toBe(originalRuntimeId);
    expect(getSourceRuntimeId(current)).toBe(originalRuntimeId);
  });

  it('rejects unsafe desktop capture runtime aliases', () => {
    const current = source({ id: 'alias-conflict-origin', kind: 'display', captureId: 'screen:current' });
    const rebound = { ...current, captureId: 'screen:already-bound' };
    getSourceRuntimeId(rebound);
    expect(() => preserveDesktopCaptureRuntime(current, rebound)).toThrow(/already bound/);

    const generatedCurrent = { ...current, captureBindingId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
    const changedGeneration = { ...generatedCurrent, captureId: 'screen:changed', captureBindingId: '11111111-1111-4111-8111-111111111111' };
    expect(() => preserveDesktopCaptureRuntime(generatedCurrent, changedGeneration)).toThrow(/binding generation/);

    const differentOrigin = { ...current, id: 'another-capture-origin', captureId: 'screen:other' };
    const differentKind = { ...current, kind: 'window' as const, captureId: 'window:other' };
    expect(() => preserveDesktopCaptureRuntime(current, differentOrigin)).toThrow(/same logical/);
    expect(() => preserveDesktopCaptureRuntime(current, differentKind)).toThrow(/same logical/);
  });

  it('binds presentation pages but excludes manual slideshow playback position and session state', () => {
    const slideshow = source({
      id: 'slideshow-runtime-contract', kind: 'slideshow', slideIndex: 0,
      slideshowImages: [{ assetId: 'slide-a', assetExtension: 'png', name: 'A' }],
    });
    const changedManualState = {
      ...slideshow,
      slideIndex: 17,
      slideshowAutoAdvance: true,
      slideshowPlaybackId: '8c8395d2-dbc0-4ddf-8bb5-a09de0a319b1',
    };
    const presentation = source({
      id: 'presentation-runtime-contract', kind: 'presentation', slideIndex: 0,
      presentationSlides: [{ assetId: 'page-a', assetExtension: 'png', name: 'Page A' }],
    });
    const changedPages = {
      ...presentation,
      presentationSlides: [{ assetId: 'page-b', assetExtension: 'png', name: 'Page B' }],
    };

    expect(getSourceRuntimeId(changedManualState)).toBe(getSourceRuntimeId(slideshow));
    expect(getSourceRuntimeId(changedPages)).not.toBe(getSourceRuntimeId(presentation));
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
    const browserCopy = toRuntimeSource({ ...browser, id: 'browser-copy', url: 'HTTPS://EXAMPLE.TEST:443/' }, { width: 1920, height: 1080 });
    const audioEnabledBrowser = toRuntimeSource({ ...browser, browserAudioEnabled: true }, { width: 1920, height: 1080 });
    const changedUrlBrowser = toRuntimeSource({ ...browser, url: 'https://other.test' }, { width: 1920, height: 1080 });
    const firstSource = firstViewport.scenes[0]!.sources[0]!;
    const changedSource = changedViewport.scenes[0]!.sources[0]!;
    const merged = mergeRuntimeSources({ draftScenes: firstViewport.scenes, programScenes: [] });
    const draftAndProgram = mergeRuntimeSources({ draftScenes: changedViewport.scenes, programScenes: firstViewport.scenes });

    expect(firstSource.id).toBe(sameViewport.scenes[0]!.sources[0]!.id);
    expect(browserCopy.id).toBe(firstSource.id);
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
    const program = source({ id: 'program-copy', muted: true, volume: 0.8 });
    const editedResource = source({ id: 'edited-resource', assetId: 'edited-asset' });
    const outgoing = source({ id: 'outgoing-source', assetId: 'old-asset', assetExtension: 'mp4', mediaKind: 'video' });
    const scene = (id: string, sources: StreamSource[]): StreamScene => ({ id, name: id, sources });

    const merged = mergeRuntimeSources({
      draftScenes: [scene('draft-scene', [draft, editedResource])],
      outgoingScenes: [scene('outgoing-scene', [outgoing])],
      programScenes: [scene('program-scene', [program])],
    });
    const sharedRuntimeId = getSourceRuntimeId(program);
    expect(merged.find((item) => item.id === sharedRuntimeId)?.muted).toBe(true);
    expect(sharedRuntimeId).toBe(getSourceRuntimeId(draft));
    expect(merged).toHaveLength(3);
    expect(merged.some((item) => item.id === toRuntimeSource(editedResource).id)).toBe(true);
    expect(merged.some((item) => item.originSourceId === 'outgoing-source')).toBe(true);
  });

  it('prefers visible Program aliases over hidden copies, outgoing, and Preview config', () => {
    const pages = [{ assetId: 'shared-page', assetExtension: 'png', name: 'Shared page' }];
    const previewMedia = toRuntimeSource(source({ id: 'preview-media', volume: 0.2, loop: false, restartPlaybackWhenActive: false }));
    const outgoingMedia = toRuntimeSource(source({ id: 'outgoing-media', volume: 0.6, loop: false, restartPlaybackWhenActive: false }));
    const previewOutgoingOnly = toRuntimeSource(source({ id: 'preview-outgoing-only', assetId: 'outgoing-only-asset', volume: 0.2 }));
    const visibleOutgoingOnly = toRuntimeSource(source({ id: 'visible-outgoing-only', assetId: 'outgoing-only-asset', volume: 0.65, loop: true, restartPlaybackWhenActive: true }));
    const previewOnlyMedia = toRuntimeSource(source({ id: 'preview-only-media', assetId: 'preview-only-asset', volume: 0.4, loop: true, restartPlaybackWhenActive: true }));
    const visibleProgramMedia = toRuntimeSource(source({
      id: 'visible-program-media', name: 'Visible Program media', volume: 0.8, loop: true, restartPlaybackWhenActive: true,
    }));
    const hiddenProgramMedia = toRuntimeSource(source({
      id: 'hidden-program-media', visible: false, name: 'Hidden Program media', volume: 0.1, loop: false, restartPlaybackWhenActive: false,
    }));
    const hiddenPreviewMedia = toRuntimeSource(source({
      id: 'hidden-preview-media', visible: false, name: 'Hidden Preview media', volume: 0.05, loop: false, restartPlaybackWhenActive: false,
    }));
    const previewSlideshow = toRuntimeSource(source({
      id: 'preview-slideshow', kind: 'slideshow', slideshowImages: pages,
      slideshowAutoAdvance: false, slideshowLoop: false, restartPlaybackWhenActive: false,
    }));
    const visibleProgramSlideshow = toRuntimeSource(source({
      id: 'visible-program-slideshow', kind: 'slideshow', slideshowImages: pages,
      slideshowAutoAdvance: true, slideshowLoop: true, restartPlaybackWhenActive: true,
    }));
    const hiddenProgramSlideshow = toRuntimeSource(source({
      id: 'hidden-program-slideshow', kind: 'slideshow', visible: false, slideshowImages: pages,
      slideshowAutoAdvance: false, slideshowLoop: false, restartPlaybackWhenActive: false,
    }));
    const hiddenProgramOutgoingOnly = toRuntimeSource(source({
      id: 'hidden-program-outgoing-only', visible: false, assetId: 'outgoing-only-asset', volume: 0.1, loop: false, restartPlaybackWhenActive: false,
    }));
    const hiddenProgramPreviewOnly = toRuntimeSource(source({
      id: 'hidden-program-preview-only', visible: false, assetId: 'preview-only-asset', volume: 0.1, loop: false, restartPlaybackWhenActive: false,
    }));
    const hiddenProgramSceneReference = toRuntimeSource(source({
      id: 'hidden-program-scene-reference', kind: 'scene', visible: false, referencedSceneId: 'program-unreachable-scene',
    }));
    const programUnreachableVisible = toRuntimeSource(source({ id: 'program-unreachable-visible', assetId: 'program-unreachable-visible-asset' }));
    const draftInactiveVisible = toRuntimeSource(source({ id: 'draft-inactive-visible', assetId: 'draft-inactive-visible-asset' }));
    const draftScenes = [{ id: 'preview-scene', name: 'Preview', sources: [
      previewMedia, previewSlideshow, previewOutgoingOnly, previewOnlyMedia, hiddenPreviewMedia,
    ] }, { id: 'draft-inactive-scene', name: 'Inactive but visible Preview source', sources: [draftInactiveVisible] }];
    const outgoingScenes = [{ id: 'outgoing-scene', name: 'Outgoing', sources: [outgoingMedia, visibleOutgoingOnly] }];
    const programScenes = [{
      id: 'program-scene', name: 'Program', sources: [
        visibleProgramMedia, visibleProgramSlideshow, hiddenProgramMedia, hiddenProgramSlideshow,
        hiddenProgramOutgoingOnly, hiddenProgramPreviewOnly, hiddenProgramSceneReference,
      ],
    }, { id: 'program-unreachable-scene', name: 'Hidden reference target', sources: [programUnreachableVisible] }];
    const sourceRowsBeforeMerge = structuredClone({ draftScenes, outgoingScenes, programScenes });

    const merged = mergeRuntimeSources({
      draftScenes,
      outgoingScenes,
      programScenes,
      draftSourceIds: visibleOriginIds(draftScenes, ['preview-scene']),
      outgoingSourceIds: visibleOriginIds(outgoingScenes, ['outgoing-scene']),
      programSourceIds: visibleOriginIds(programScenes, ['program-scene']),
    });
    const resolvedMedia = merged.find((item) => item.id === visibleProgramMedia.id)!;
    const resolvedSlideshow = merged.find((item) => item.id === visibleProgramSlideshow.id)!;
    const resolvedOutgoingOnly = merged.find((item) => item.id === visibleOutgoingOnly.id)!;
    const resolvedPreviewOnly = merged.find((item) => item.id === previewOnlyMedia.id)!;

    expect(resolvedMedia).toMatchObject({
      originSourceId: 'visible-program-media',
      name: 'Visible Program media',
      volume: 0.8,
      loop: true,
      restartPlaybackWhenActive: true,
    });
    expect(resolvedSlideshow).toMatchObject({
      originSourceId: 'visible-program-slideshow',
      slideshowAutoAdvance: true,
      slideshowLoop: true,
      restartPlaybackWhenActive: true,
    });
    expect(resolvedOutgoingOnly).toMatchObject({
      originSourceId: 'visible-outgoing-only',
      volume: 0.65,
      loop: true,
      restartPlaybackWhenActive: true,
    });
    expect(resolvedPreviewOnly).toMatchObject({
      originSourceId: 'preview-only-media',
      volume: 0.4,
      loop: true,
      restartPlaybackWhenActive: true,
    });
    expect(merged.some((item) => item.id === programUnreachableVisible.id)).toBe(false);
    expect(merged.some((item) => item.id === draftInactiveVisible.id)).toBe(true);
    expect(merged).toHaveLength(5);
    expect({ draftScenes, outgoingScenes, programScenes }).toEqual(sourceRowsBeforeMerge);
  });

  it('drops resources hidden by a source or ancestor while retaining visible aliases across inactive scenes', () => {
    const hiddenLeaf = toRuntimeSource(source({ id: 'hidden-leaf', assetId: 'hidden-only-asset' }));
    const hiddenParent = toRuntimeSource(source({
      id: 'hidden-parent', kind: 'group', visible: false, children: [hiddenLeaf],
    }));
    const hiddenOnly = toRuntimeSource(source({ id: 'hidden-only', assetId: 'hidden-only-asset', visible: false }));
    const hiddenOutgoingAlias = toRuntimeSource(source({ id: 'hidden-outgoing-alias', assetId: 'hidden-only-asset', visible: false }));
    const hiddenProgramAlias = toRuntimeSource(source({ id: 'hidden-program-alias', assetId: 'hidden-only-asset', visible: false }));
    const inactiveVisibleAlias = toRuntimeSource(source({
      id: 'inactive-visible-alias', assetId: 'hidden-only-asset', volume: 0.7,
    }));
    const inactiveVisibleResource = toRuntimeSource(source({ id: 'inactive-visible-resource', assetId: 'inactive-visible-asset' }));
    const inactiveVisibleOutgoing = toRuntimeSource(source({ id: 'inactive-visible-outgoing', assetId: 'inactive-outgoing-asset' }));
    const inactiveVisibleProgram = toRuntimeSource(source({ id: 'inactive-visible-program', assetId: 'inactive-program-asset' }));
    const hiddenUniqueResource = toRuntimeSource(source({ id: 'hidden-unique-resource', assetId: 'hidden-unique-asset', visible: false }));
    const hiddenUniqueOutgoing = toRuntimeSource(source({ id: 'hidden-unique-outgoing', assetId: 'hidden-unique-asset', visible: false }));
    const hiddenUniqueProgram = toRuntimeSource(source({ id: 'hidden-unique-program', assetId: 'hidden-unique-asset', visible: false }));
    const draftScenes = [
      { id: 'preview-scene', name: 'Preview', sources: [hiddenParent, hiddenOnly] },
      { id: 'inactive-visible-scene', name: 'Inactive visible scene', sources: [inactiveVisibleAlias, inactiveVisibleResource] },
      { id: 'hidden-unique-scene', name: 'Hidden unique scene', sources: [hiddenUniqueResource] },
    ];
    const outgoingScenes = [
      { id: 'outgoing-hidden-scene', name: 'Outgoing hidden', sources: [hiddenOutgoingAlias] },
      { id: 'outgoing-inactive-scene', name: 'Outgoing inactive visible', sources: [inactiveVisibleOutgoing] },
      { id: 'outgoing-hidden-unique-scene', name: 'Outgoing hidden unique', sources: [hiddenUniqueOutgoing] },
    ];
    const programScenes = [
      { id: 'program-hidden-scene', name: 'Program hidden', sources: [hiddenProgramAlias] },
      { id: 'program-inactive-scene', name: 'Program inactive visible', sources: [inactiveVisibleProgram] },
      { id: 'program-hidden-unique-scene', name: 'Program hidden unique', sources: [hiddenUniqueProgram] },
    ];
    const sourceRowsBeforeMerge = structuredClone({ draftScenes, outgoingScenes, programScenes });

    const merged = mergeRuntimeSources({ draftScenes, outgoingScenes, programScenes });

    expect(merged.map((item) => item.id)).toContain(inactiveVisibleAlias.id);
    expect(merged.map((item) => item.id)).toContain(inactiveVisibleResource.id);
    expect(merged.map((item) => item.id)).toContain(inactiveVisibleOutgoing.id);
    expect(merged.map((item) => item.id)).toContain(inactiveVisibleProgram.id);
    expect(merged.map((item) => item.id)).not.toContain(hiddenParent.id);
    expect(merged.map((item) => item.id)).not.toContain(hiddenUniqueResource.id);
    expect(merged.map((item) => item.originSourceId)).not.toContain(hiddenLeaf.originSourceId);
    expect(merged.map((item) => item.originSourceId)).not.toContain(hiddenOnly.originSourceId);
    expect(merged.map((item) => item.originSourceId)).not.toContain(hiddenOutgoingAlias.originSourceId);
    expect(merged.map((item) => item.originSourceId)).not.toContain(hiddenProgramAlias.originSourceId);
    expect(merged.map((item) => item.originSourceId)).not.toContain(hiddenUniqueOutgoing.originSourceId);
    expect(merged.map((item) => item.originSourceId)).not.toContain(hiddenUniqueProgram.originSourceId);
    expect(merged).toHaveLength(4);
    expect(merged.find((item) => item.id === inactiveVisibleAlias.id)).toMatchObject({
      originSourceId: 'inactive-visible-alias',
      volume: 0.7,
    });
    expect({ draftScenes, outgoingScenes, programScenes }).toEqual(sourceRowsBeforeMerge);
  });
});
