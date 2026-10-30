import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Modal, NumberField, ReacstButton, Select, StatusBar, StatusDot, Toolbar, TooltipProvider } from '@lumacast/ui';
import { Clapperboard, ExternalLink, Radio, Settings } from 'lucide-react';
import { CanvasComposition, RuntimeVideoBank } from './canvas-composition';
import type { SceneTransitionType } from './scene-transition';
import { TitleBar } from './chrome/title-bar';
import { buildAppMenus } from './chrome/app-menu';
import { StreamDialog } from './dialogs/stream-dialog';
import { BrowserSourceDialog } from './dialogs/workspace-dialogs';
import { NameDialog } from './dialogs/name-dialog';
import { ApplicationAudioPicker, CapturePicker, InputDevicePicker } from './dialogs/pickers';
import { SettingsDialog } from './dialogs/settings-dialog';
import { ScenesDock } from './docks/scenes-dock';
import { ControlsDock } from './docks/controls-dock';
import { MixerDock } from './docks/mixer-dock';
import { SourcesDock } from './docks/sources-dock';
import { YouTubeDock } from './docks/youtube-dock';
import { ZoomDock } from './docks/zoom-dock';
import { getStreamService } from '../shared/stream-services';
import { outputRectFromCanvasRect } from './output-scaling';
import { supportsAudioOutputSelection } from './monitor-device-routing';
import { fitPreviewSize } from './preview-layout';
import { multiviewTileCapacityFor } from './multiview-window';
import { canTransformSource } from './source-transform';
import { ActionNotifications } from './action-notifications';
import { SceneThumbnail } from './docks/scene-thumbnail';
import { getSourceRuntimeId, mergeRuntimeSources, toRuntimeProject } from './source-runtime';
import { projectRuntimeMap, projectRuntimeRecord } from './runtime-projection';
import { mergeSourceStatuses, type SourceStatus } from './source-availability';
import { formatElapsed } from './format-elapsed';
import { recordingElapsedTime } from './recording-controls';
import { flattenSourceNodes } from '../shared/source-tree';
import { canReferenceScene, getVisibleSourceIdsForScenes } from '../shared/scene-reference-graph';
import { dockColumnsMinWidth, dockColumnsTemplate, dockGridColumn, workbenchRowsTemplate } from './workbench-layout';
import {
  desktopAudioCaptureModeForPlatform, isVideoEncoderAvailableOnPlatform, primaryShortcutLabel,
  supportsApplicationAudioCapture, supportsDisplayCaptureSystemAudio, systemVideoEncoderForPlatform,
} from '../shared/platform-capabilities';
import { createDefaultTextStyle, VIDEO_ENCODER_OPTIONS } from '../shared/desktop-api';
import { friendlyError } from './features/shared/friendly-error';
import { DEFAULT_CHROMA_KEY, DEFAULT_SOURCE_CROP, DEFAULT_SOURCE_FILTERS } from './features/sources/helpers';

import { useWorkspace } from './features/workspace/use-workspace';
import { useCapture } from './features/capture/use-capture';
import { useSources } from './features/sources/use-sources';
import { useScenes } from './features/scenes/use-scenes';
import { useProgram } from './features/scenes/use-program';
import { useMultiview } from './features/multiview/use-multiview';
import { useRecording } from './features/recording/use-recording';
import { useStreaming } from './features/streaming/use-streaming';
import { useReplayBuffer } from './features/replay-buffer/use-replay-buffer';
import { useWorkbenchLayout } from './features/workbench/use-workbench-layout';
import { useHotkeys } from './features/hotkeys/use-hotkeys';
import { useRuntimeStats } from './features/status/use-runtime-stats';
import { useAppMenu } from './features/chrome/use-app-menu';
import { useNativeMenu } from './features/chrome/use-native-menu';

const transitionOptions: { value: SceneTransitionType; label: string }[] = [
  { value: 'Fade', label: 'Fade' },
  { value: 'Cut', label: 'Cut' },
  { value: 'Swipe', label: 'Swipe' },
  { value: 'Slide', label: 'Slide' },
  { value: 'FadeToColor', label: 'Fade to Color' },
];

// Populated only if the build defines it (no current Vite config does); the
// About dialog falls back to the product name alone when it's absent.
const appVersion = import.meta.env.PACKAGE_VERSION as string | undefined;

export function App() {
  const api = window.streamApi;
  const platform = api.platform;
  const desktopAudioMode = desktopAudioCaptureModeForPlatform(platform);
  const applicationAudioSupported = supportsApplicationAudioCapture(platform);
  const displayCaptureSystemAudio = supportsDisplayCaptureSystemAudio(platform);
  const systemVideoEncoder = systemVideoEncoderForPlatform(platform);
  const videoEncoderOptions = VIDEO_ENCODER_OPTIONS.filter((option) => isVideoEncoderAvailableOnPlatform(platform, option.value));
  const monitorDeviceSelectionSupported = typeof AudioContext !== 'undefined' && supportsAudioOutputSelection(AudioContext.prototype);

  const [actionFeedback, setActionFeedback] = useState({ message: '', sequence: 0 });
  const setActionError = useCallback((message: string) => {
    setActionFeedback((current) => ({ message, sequence: current.sequence + 1 }));
  }, []);
  const [working, setWorking] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  const monitorStageRef = useRef<HTMLDivElement>(null);
  const settingsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const programCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoElements = useRef(new Map<string, HTMLVideoElement>());
  const mediaElements = useRef(new Map<string, HTMLMediaElement>());
  const imageElements = useRef(new Map<string, HTMLImageElement>());
  // Async capture restoration reads the latest owner scope before attaching.
  const activeSourceIdsRef = useRef<Set<string>>(new Set());

  const [multiviewWindowOpen, setMultiviewWindowOpen] = useState(false);
  const [resourceStatuses, setResourceStatuses] = useState<Record<string, SourceStatus>>({});
  const [visibleThumbnailSceneIds, setVisibleThumbnailSceneIds] = useState<ReadonlySet<string>>(new Set());
  const reportThumbnailVisibility = useCallback((sceneId: string, visible: boolean) => {
    setVisibleThumbnailSceneIds((current) => {
      if (current.has(sceneId) === visible) return current;
      const next = new Set(current);
      if (visible) next.add(sceneId); else next.delete(sceneId);
      return next;
    });
  }, []);
  const workbench = useWorkbenchLayout();

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const workspace = useWorkspace({
    api,
    setActionError,
    working,
    setWorking,
    isOutputActive: () => recording.isActive() || streaming.isActive() || replayBuffer.isActive(),
    onWorkspaceChanging: () => {
      capture.resetForWorkspaceChange();
      program.resetForWorkspaceChange();
      setResourceStatuses({});
      setVisibleThumbnailSceneIds(new Set());
      sources.resetForWorkspaceChange();
      scenes.resetForWorkspaceChange();
      streaming.setStreamDialogOpen(false);
    },
  });
  const { project, setProjectValue, allSources, projectRef } = workspace;

  const activeScene = project?.scenes.find((scene) => scene.id === project.activeSceneId) ?? null;
  const program = useProgram({ project, workspaceKey: `${workspace.activeCollectionId ?? ''}:${workspace.activeProfileId ?? ''}` });
  const liveScene = program.programScene;
  const runtimeDraftProject = useMemo(() => project ? toRuntimeProject(project) : null, [project]);
  const runtimeProgramProject = useMemo(() => program.programProject ? toRuntimeProject(program.programProject) : null, [program.programProject]);
  const runtimeOutgoingProject = useMemo(() => program.outgoingProject ? toRuntimeProject(program.outgoingProject) : null, [program.outgoingProject]);
  const runtimeSources = useMemo(() => mergeRuntimeSources({
    draftScenes: runtimeDraftProject?.scenes ?? [], programScenes: runtimeProgramProject?.scenes ?? [], outgoingScenes: runtimeOutgoingProject?.scenes,
  }), [runtimeDraftProject?.scenes, runtimeProgramProject?.scenes, runtimeOutgoingProject?.scenes]);
  const editorRuntimeSources = useMemo(() => runtimeDraftProject?.scenes.flatMap((scene) => flattenSourceNodes(scene.sources)) ?? [], [runtimeDraftProject]);
  const runtimeSourcesRef = useRef(runtimeSources);
  runtimeSourcesRef.current = runtimeSources;
  useEffect(() => {
    const ownedIds = new Set(runtimeSources.map((source) => source.id));
    setResourceStatuses((current) => Object.keys(current).some((id) => !ownedIds.has(id))
      ? Object.fromEntries(Object.entries(current).filter(([id]) => ownedIds.has(id))) : current);
  }, [runtimeSources]);
  const runtimeProjectRef = useRef(runtimeDraftProject);
  runtimeProjectRef.current = runtimeDraftProject;
  const programSourceIds = useMemo(() => runtimeProgramProject && liveScene
    ? getVisibleSourceIdsForScenes(runtimeProgramProject.scenes, [liveScene.id]) : new Set<string>(), [runtimeProgramProject, liveScene?.id]);
  const retainedSourceIds = useMemo(() => {
    const ids = new Set(programSourceIds);
    if (runtimeOutgoingProject && program.outgoingScene) {
      for (const id of getVisibleSourceIdsForScenes(runtimeOutgoingProject.scenes, [program.outgoingScene.id])) ids.add(id);
    }
    return ids;
  }, [programSourceIds, runtimeOutgoingProject, program.outgoingScene?.id]);
  const reportResourceStatus = useCallback((sourceId: string, status: SourceStatus) => {
    setResourceStatuses((current) => current[sourceId]?.state === status.state && current[sourceId]?.message === status.message
      ? current : { ...current, [sourceId]: status });
  }, []);

  useEffect(() => {
    const monitorStage = monitorStageRef.current;
    if (!monitorStage || !project) return;

    const updatePreviewSize = () => {
      const horizontalPadding = project.studioMode ? 24 : 36;
      const horizontalGap = project.studioMode ? 12 : 0;
      const availableWidth = (monitorStage.clientWidth - horizontalPadding - horizontalGap) / (project.studioMode ? 2 : 1);
      const availableHeight = monitorStage.clientHeight - 24 - 20;
      const nextSize = fitPreviewSize(availableWidth, availableHeight, project.output.width, project.output.height);
      setPreviewSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
    };

    const observer = new ResizeObserver(updatePreviewSize);
    observer.observe(monitorStage);
    updatePreviewSize();
    return () => observer.disconnect();
  }, [project?.studioMode, project?.output.width, project?.output.height]);

  // Thumbnail capture, Program playback, and audio output have distinct scopes.
  const activeSourceIds = useMemo(() => {
    const ids = new Set(retainedSourceIds);
    if (runtimeDraftProject) {
      const sceneIds = [runtimeDraftProject.activeSceneId];
      if (multiviewWindowOpen) sceneIds.push(...runtimeDraftProject.scenes.slice(0, multiviewTileCapacityFor(runtimeDraftProject.scenes.length)).map((scene) => scene.id));
      if (workbench.visibleDockIds.includes('scenes')) sceneIds.push(...visibleThumbnailSceneIds);
      for (const id of getVisibleSourceIdsForScenes(runtimeDraftProject.scenes, sceneIds)) ids.add(id);
    }
    return ids;
  }, [runtimeDraftProject, retainedSourceIds, workbench.visibleDockIds, multiviewWindowOpen, visibleThumbnailSceneIds]);
  activeSourceIdsRef.current = activeSourceIds;

  const capture = useCapture({
    api, project: runtimeDraftProject, projectRef: runtimeProjectRef,
    allSources: runtimeSources, allSourcesRef: runtimeSourcesRef,
    liveScene: runtimeProgramProject?.scenes.find((scene) => scene.id === liveScene?.id) ?? null,
    programProject: runtimeProgramProject, programSourceIds, retainedSourceIds, activeSourceIds, activeSourceIdsRef,
    setActionError, working, setWorking, displayCaptureSystemAudio, imageElements,
    closeSourceMenu: () => sources.setSourceMenuOpen(false),
    addToActiveScene: (source) => sources.addToActiveScene(source),
    updateSource: (sourceId, update) => {
      const originId = runtimeSourcesRef.current.find((source) => source.id === sourceId)?.originSourceId ?? sourceId;
      sources.updateSource(originId, (current) => {
        const updated = { ...update(current) } as typeof current & { originSourceId?: string };
        delete updated.originSourceId;
        return { ...updated, id: originId };
      });
    },
  });
  const editorRuntimes = useRef(capture.runtimes.current);
  editorRuntimes.current = projectRuntimeMap(editorRuntimeSources, capture.runtimes.current);
  const editorApplicationAudioInputs = useRef(capture.applicationAudioInputs.current);
  editorApplicationAudioInputs.current = projectRuntimeMap(editorRuntimeSources, capture.applicationAudioInputs.current);
  const editorApplicationAudioSessions = useRef(capture.applicationAudioSessions.current);
  editorApplicationAudioSessions.current = projectRuntimeMap(editorRuntimeSources, capture.applicationAudioSessions.current);
  const editorVideoElements = useRef(videoElements.current);
  editorVideoElements.current = projectRuntimeMap(editorRuntimeSources, videoElements.current);
  const editorImageElements = useRef(imageElements.current);
  editorImageElements.current = projectRuntimeMap(editorRuntimeSources, imageElements.current);
  const editorMediaElements = useRef(mediaElements.current);
  editorMediaElements.current = projectRuntimeMap(editorRuntimeSources, mediaElements.current);
  const editorMeterLevels = projectRuntimeRecord(editorRuntimeSources, capture.meterLevels);
  const editorPlaybackStates = projectRuntimeRecord(editorRuntimeSources, capture.mediaPlaybackStates);
  const editorSourceStatuses = projectRuntimeRecord(editorRuntimeSources, mergeSourceStatuses(editorRuntimeSources, capture.sourceStatuses, resourceStatuses));

  const sources = useSources({
    api, project, projectRef, allSources, activeScene, liveScene, setProjectValue, setActionError, working, setWorking,
    videoElements: editorVideoElements, imageElements: editorImageElements, mediaElements: editorMediaElements, programSourceIds,
    runtimes: editorRuntimes, mixer: capture.mixer, applicationAudioInputs: editorApplicationAudioInputs,
    applicationAudioSessions: editorApplicationAudioSessions, attachRuntime: capture.attachRuntime, stopRuntime: capture.stopRuntime,
    startApplicationAudioRuntime: capture.startApplicationAudioRuntime, startSystemAudioRuntime: capture.startSystemAudioRuntime,
    clearNoiseSuppressionPreference: capture.clearNoiseSuppressionPreference,
  });

  const scenes = useScenes({
    project, setProjectValue, setActionError, working, setWorking, selectSource: sources.selectSource,
    programSceneId: program.programSceneId, canTransition: program.canTransition, commitProgram: program.commitProgram, finishProgramTransition: program.finishOutgoingProgram,
    runtimes: editorRuntimes, applicationAudioInputs: editorApplicationAudioInputs, applicationAudioSessions: editorApplicationAudioSessions,
    attachRuntime: capture.attachRuntime, stopRuntime: capture.stopRuntime,
    startApplicationAudioRuntime: capture.startApplicationAudioRuntime, startSystemAudioRuntime: capture.startSystemAudioRuntime,
  });

  const multiview = useMultiview({
    project, projectRef, programSceneId: program.programSceneId, programFrameRate: program.programProject?.output.frameRate ?? null,
    previewCanvasRef, programCanvasRef, chooseScene: scenes.chooseScene, transitionToScene: scenes.transitionToScene, setActionError,
    multiviewWindowOpen, setMultiviewWindowOpen,
  });

  const referenceableScenes = useMemo(() => project && activeScene
    ? project.scenes.filter((scene) => canReferenceScene(project.scenes, activeScene.id, scene.id))
    : [], [project?.scenes, activeScene?.id]);

  const recording = useRecording({ api, project: program.programProject, programCanvasRef, ensureMixer: capture.ensureMixer, setActionError, working, setWorking });
  const streaming = useStreaming({ api, project: program.programProject, programCanvasRef, ensureMixer: capture.ensureMixer, setActionError });
  const replayBuffer = useReplayBuffer({ api, project: program.programProject, programCanvasRef, ensureMixer: capture.ensureMixer, setActionError, working, setWorking });

  const runtimeStats = useRuntimeStats({ api });

  const openSettingsDialog = () => {
    setSettingsOpen(true);
    void capture.refreshAudioOutputDevices();
  };
  const openSettings = (event: ReactMouseEvent<HTMLButtonElement>) => {
    settingsOpenerRef.current = event.currentTarget;
    openSettingsDialog();
  };
  const closeSettings = () => setSettingsOpen(false);

  // Shared by the Mixer and Sources docks' "Properties"/gear actions: select
  // the source, and reveal the Sources dock (which hosts the properties
  // panel) if hidden.
  const openSourceProperties = (sourceId: string) => {
    sources.selectSource(sourceId);
    if (!workbench.visibleDockIds.includes('sources')) workbench.toggleDock('sources');
  };

  const hotkeys = useHotkeys({
    api, project, setProjectValue, setActionError,
    selectedSource: sources.selectedSource, updateSource: sources.updateSource, fitSource: sources.fitSource,
    stretchSource: sources.stretchSource, centerSource: sources.centerSource,
    undoSceneEdit: workspace.undoSceneEdit, redoSceneEdit: workspace.redoSceneEdit,
    pasteSource: sources.pasteSource, removeSelectedSource: sources.removeSelectedSource, copySelectedSource: sources.copySelectedSource,
    sourceClipboardAvailable: sources.sourceClipboardAvailable, chooseScene: scenes.chooseScene,
    startRecording: recording.startRecording, stopRecording: recording.stopRecording, isRecording: recording.isActive,
    isActivelyRecording: recording.isActivelyRecording,
    stopStreaming: streaming.stopStreaming, isStreaming: streaming.isActive, openStreamDialog: streaming.openStreamDialog,
    startReplayBuffer: replayBuffer.startReplayBuffer, stopReplayBuffer: replayBuffer.stopReplayBuffer, saveReplay: replayBuffer.saveReplay,
    isReplayBufferActive: replayBuffer.isActive,
    openSettings: openSettingsDialog,
  });

  // Hooks must run on every render, including the loading and error states below.
  const appMenuContext = useAppMenu({
    platform,
    project,
    multiviewWindowOpen,
    undoAvailable: workspace.undoAvailable,
    redoAvailable: workspace.redoAvailable,
    selectedSource: sources.selectedSource,
    sourceClipboardAvailable: sources.sourceClipboardAvailable,
    workbenchLayout: workbench.workbenchLayout,
    collections: workspace.collections,
    activeCollectionId: workspace.activeCollectionId,
    profiles: workspace.profiles,
    activeProfileId: workspace.activeProfileId,
    openSettings: openSettingsDialog,
    importCollectionFromFile: workspace.importCollectionFromFile,
    exportActiveCollection: workspace.exportActiveCollection,
    showRecordingsFolder: recording.showRecordingsFolder,
    remuxRecording: recording.remuxRecording,
    undoSceneEdit: workspace.undoSceneEdit,
    redoSceneEdit: workspace.redoSceneEdit,
    copySelectedSource: sources.copySelectedSource,
    pasteSource: sources.pasteSource,
    removeSelectedSource: sources.removeSelectedSource,
    fitSource: sources.fitSource,
    stretchSource: sources.stretchSource,
    centerSource: sources.centerSource,
    resetSourceTransform: sources.resetSourceTransform,
    toggleStudioMode: scenes.toggleStudioMode,
    toggleMultiviewWindow: multiview.toggleMultiviewWindow,
    openProjector: multiview.openProjector,
    toggleDock: workbench.toggleDock,
    resetUi: workbench.resetUi,
    activateCollection: workspace.activateCollection,
    openCollectionDialog: workspace.openCollectionDialog,
    activateProfile: workspace.activateProfile,
    openProfileDialog: workspace.openProfileDialog,
    importProfileFromFile: workspace.importProfileFromFile,
    exportActiveProfile: workspace.exportActiveProfile,
    setAboutDialogOpen,
    setShortcutsDialogOpen,
  });
  const appMenus = useMemo(() => buildAppMenus(appMenuContext), [appMenuContext]);
  useNativeMenu({ api, platform, menus: appMenus });

  if (workspace.loadingError) return <main className="fatal"><div className="fatal-mark"><Radio size={24} /></div><h1>Stream could not start</h1><p>{workspace.loadingError}</p></main>;
  if (!project || !activeScene || !liveScene) return <main className="loading"><div className="brand-pulse"><Radio size={22} /></div><span>Starting Stream</span></main>;

  const sourceInScene = flattenSourceNodes(activeScene.sources).find((source) => source.id === sources.selectedSourceId);
  const previewTransform = sourceInScene?.transform;
  const previewOutputRect = previewTransform ? outputRectFromCanvasRect(
    previewTransform,
    { width: project.output.baseWidth, height: project.output.baseHeight },
    { width: project.output.width, height: project.output.height },
  ) : null;
  const previewScene = activeScene;
  const runtimePreviewScene = runtimeDraftProject!.scenes.find((scene) => scene.id === activeScene.id)!;
  const runtimeProgramScene = runtimeProgramProject!.scenes.find((scene) => scene.id === liveScene.id)!;
  const runtimeOutgoingScene = runtimeOutgoingProject?.scenes.find((scene) => scene.id === program.outgoingScene?.id);
  const programPreviewSize = fitPreviewSize(previewSize.width, previewSize.height, runtimeProgramProject!.output.width, runtimeProgramProject!.output.height);
  const duration = formatElapsed(recording.recordingStartedAt === null ? 0 : recordingElapsedTime(clockNow, recording.recordingPausedAt, recording.recordingAccumulatedPauseMs) - recording.recordingStartedAt, 'full');
  const streamDuration = formatElapsed(streaming.streamingStartedAt === null ? 0 : clockNow - streaming.streamingStartedAt, 'full');
  const activeSceneVisibleSourceIds = getVisibleSourceIdsForScenes(project.scenes, [activeScene.id]);
  const activeSceneLeafSources = allSources.filter((source) => activeSceneVisibleSourceIds.has(source.id)
    && source.kind !== 'group' && source.kind !== 'scene');
  // Every audio-capable leaf source across every scene, for Advanced Audio
  // Properties — mirrors the predicate that actually gets a source wired into
  // the mixer (see attachRuntime/connectMediaElement in use-capture.ts):
  // microphone, desktop-audio and application-audio always qualify; media
  // sources (video or audio) always get an audio element attached; browser
  // sources only qualify with their own audio-capture toggle on. Camera
  // capture always requests `audio: false` (see cameraCaptureConstraints), so
  // cameras are excluded even though they look similar to a microphone in the
  // Sources list.
  const allAudioSources = allSources.filter((source) => source.kind === 'microphone'
    || source.kind === 'desktop-audio'
    || source.kind === 'application-audio'
    || source.kind === 'media'
    || (source.kind === 'browser' && source.browserAudioEnabled === true));
  const selectedSource = sources.selectedSource;
  const selectedFilters = { ...DEFAULT_SOURCE_FILTERS, ...selectedSource?.filters };
  const selectedTextStyle = selectedSource?.kind === 'text' ? selectedSource.textStyle ?? createDefaultTextStyle() : null;
  const selectedCrop = { ...DEFAULT_SOURCE_CROP, ...selectedSource?.crop };
  const selectedChromaKey = { ...DEFAULT_CHROMA_KEY, ...selectedSource?.chromaKey };
  const selectionHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const visibleDockIds = workbench.visibleDockIds;
  // Docks render in a fixed DOM order but are placed by grid column, so the
  // visually last dock is the one that drops its right border.
  const lastDockId = visibleDockIds[visibleDockIds.length - 1];


  return (
    <TooltipProvider>
    <main className="app-shell">
      <ActionNotifications message={actionFeedback.message} sequence={actionFeedback.sequence} />
      <RuntimeVideoBank sources={runtimeSources} runtimes={capture.runtimesSnapshot} elements={videoElements.current} mediaElements={mediaElements.current} images={imageElements.current} activeSourceIds={activeSourceIds} programSourceIds={programSourceIds} playbackSourceIds={retainedSourceIds} onSourceStatus={reportResourceStatus} onMediaElement={capture.connectMediaElement} onMediaPlaybackState={capture.onMediaPlaybackState} onBrowserElement={capture.onBrowserElement} />
      {multiviewWindowOpen && <div className="multiview-offscreen" aria-hidden="true">
        {project.scenes.slice(0, multiviewTileCapacityFor(project.scenes.length)).map((scene) => <CanvasComposition
          key={scene.id}
          ref={(canvas) => {
            if (canvas) multiview.multiviewCanvasesRef.current.set(scene.id, canvas);
            else multiview.multiviewCanvasesRef.current.delete(scene.id);
          }}
          project={runtimeDraftProject!}
          scene={runtimeDraftProject!.scenes.find((item) => item.id === scene.id)!}
          maxFrameRate={10}
          videoElements={videoElements.current}
          imageElements={imageElements.current}
          renderScale={0.2}
        />)}
      </div>}
      <TitleBar platform={platform} menuMode={platform === 'darwin' ? 'native' : 'hamburger'} title="LumaStream" menus={appMenus}>
        <ReacstButton.Icon variant="ghost" size="sm" label="Open settings" tooltip="Settings" onClick={openSettings}><Settings /></ReacstButton.Icon>
      </TitleBar>

      {settingsOpen && <SettingsDialog
        settingsOpenerRef={settingsOpenerRef}
        onClose={closeSettings}
        project={project}
        setProjectValue={setProjectValue}
        platform={platform}
        streamServiceSettings={streaming.streamServiceSettings}
        onSaveStreamServiceSettings={streaming.setStreamServiceSettings}
        onRemuxRecording={() => void recording.remuxRecording()}
        audio={{
          monitorDeviceSelectionSupported,
          audioSettings: capture.audioSettings,
          audioOutputDevices: capture.audioOutputDevices,
          audioSettingsError: capture.audioSettingsError,
          onUpdateMonitoringDevice: (deviceId) => void capture.updateMonitoringDevice(deviceId),
        }}
        replayBufferDurationSeconds={replayBuffer.replayBufferDurationSeconds}
        setReplayBufferDurationSeconds={replayBuffer.setReplayBufferDurationSeconds}
        replayBufferStartedAt={replayBuffer.replayBufferStartedAt}
        recording={{
          recordingPreferences: recording.recordingPreferences,
          setRecordingPreferences: recording.setRecordingPreferences,
          recordingPreferencesError: recording.recordingPreferencesError,
          onChooseDirectory: () => void recording.chooseRecordingDirectory(),
          onUseDefaultDirectory: () => void recording.useDefaultRecordingDirectory(),
          onFilenameBlur: recording.handleRecordingFilenameBlur,
        }}
        recordingStartedAt={recording.recordingStartedAt}
        recordingFinalizing={recording.recordingFinalizing}
        videoEncoderOptions={videoEncoderOptions}
        systemVideoEncoder={systemVideoEncoder}
        hotkeys={{
          hotkeyDraft: hotkeys.hotkeyDraft,
          sceneSwitchHotkeyDraft: hotkeys.sceneSwitchHotkeyDraft,
          sourceVisibilityHotkeyDraft: hotkeys.sourceVisibilityHotkeyDraft,
          hotkeyError: hotkeys.hotkeyError,
          hotkeysWorking: hotkeys.hotkeysWorking,
          onCaptureHotkey: hotkeys.captureHotkey,
          onCaptureSceneSwitchHotkey: hotkeys.captureSceneSwitchHotkey,
          onCaptureSourceVisibilityHotkey: hotkeys.captureSourceVisibilityHotkey,
          onApply: () => void hotkeys.applyHotkeys(),
        }}
      />}

      <section
        ref={workbench.workbenchRef}
        className={`workbench${workbench.workbenchResizing ? ` resizing-${workbench.workbenchResizing}` : ''}${workbench.dockDrag ? ' reordering' : ''}`}
        style={{ gridTemplateRows: workbenchRowsTemplate(workbench.workbenchLayout.bottomPanelHeight, visibleDockIds.length) ?? undefined }}
        onPointerDown={workbench.handleWorkbenchTitlePointerDown}
        onPointerMove={workbench.handleWorkbenchTitlePointerMove}
        onPointerUp={workbench.endDockDrag}
        onPointerCancel={workbench.endDockDrag}
      >
        <section className="monitor-dock">
          <div
            className="workbench-panel-resizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize bottom panel"
            title="Drag to resize · double-click to reset"
            onPointerDown={workbench.startPanelResize}
            onPointerMove={workbench.moveWorkbenchResize}
            onPointerUp={workbench.endWorkbenchResize}
            onPointerCancel={workbench.endWorkbenchResize}
            onDoubleClick={() => workbench.resetWorkbenchDimension('bottomPanelHeight')}
          />
          <div ref={monitorStageRef} className={`monitor-stage ${project.studioMode ? 'studio' : ''}`}>
            {project.studioMode && <div key="preview-panel" className="stage-panel">
              <div className="stage-label"><span>PREVIEW</span><b>{activeScene.name}</b><ReacstButton.Icon variant="ghost" size="xs" label="Open preview projector" tooltip="Open preview projector" onClick={() => multiview.openProjector('preview')}><ExternalLink /></ReacstButton.Icon></div>
              <div className="stage-surface" style={previewSize} onPointerDown={(event) => sources.handleStagePointerDown(event, previewScene)} onPointerMove={sources.handleStagePointerMove} onPointerUp={sources.handleStagePointerUp} onPointerCancel={sources.handleStagePointerUp}>
                <CanvasComposition ref={previewCanvasRef} project={runtimeDraftProject!} scene={runtimePreviewScene} videoElements={videoElements.current} imageElements={imageElements.current} />
                {previewOutputRect && <div className={`selection-frame ${sourceInScene?.locked ? 'locked' : ''}`} style={{ left: `${(previewOutputRect.x / project.output.width) * 100}%`, top: `${(previewOutputRect.y / project.output.height) * 100}%`, width: `${(previewOutputRect.width / project.output.width) * 100}%`, height: `${(previewOutputRect.height / project.output.height) * 100}%`, transform: sourceInScene?.kind === 'group' ? undefined : `rotate(${sourceInScene?.transform.rotation ?? 0}deg)`, transformOrigin: 'center' }}>{canTransformSource(sourceInScene?.locked) && selectionHandles.map((handle) => <span key={handle} className={`resize-handle resize-${handle}`} data-resize-handle={handle} />)}</div>}
              </div>
            </div>}
            <div key="program-panel" className="stage-panel program-panel">
              <div className="stage-label"><span><StatusDot tone="error" />PROGRAM</span><b>{liveScene.name}</b></div>
              <div className="stage-surface" style={programPreviewSize} onPointerDown={!project.studioMode ? (event) => sources.handleStagePointerDown(event, liveScene) : undefined} onPointerMove={!project.studioMode ? sources.handleStagePointerMove : undefined} onPointerUp={!project.studioMode ? sources.handleStagePointerUp : undefined} onPointerCancel={!project.studioMode ? sources.handleStagePointerUp : undefined}>
                <CanvasComposition ref={programCanvasRef} project={runtimeProgramProject!} scene={runtimeProgramScene} outgoingProject={runtimeOutgoingProject ?? undefined} outgoingScene={runtimeOutgoingScene} videoElements={videoElements.current} imageElements={imageElements.current} transition={scenes.transition} onTransitionEnd={scenes.finishTransition} />
                {!project.studioMode && previewOutputRect && <div className={`selection-frame ${sourceInScene?.locked ? 'locked' : ''}`} style={{ left: `${(previewOutputRect.x / project.output.width) * 100}%`, top: `${(previewOutputRect.y / project.output.height) * 100}%`, width: `${(previewOutputRect.width / project.output.width) * 100}%`, height: `${(previewOutputRect.height / project.output.height) * 100}%`, transform: sourceInScene?.kind === 'group' ? undefined : `rotate(${sourceInScene?.transform.rotation ?? 0}deg)`, transformOrigin: 'center' }}>{canTransformSource(sourceInScene?.locked) && selectionHandles.map((handle) => <span key={handle} className={`resize-handle resize-${handle}`} data-resize-handle={handle} />)}</div>}
              </div>
            </div>
          </div>
          <Toolbar size="sm" label="Program controls" className="border-t border-primary text-sm text-tertiary">
            <Toolbar.Group label="Transition">
              <Select<SceneTransitionType> size="sm" className="w-28" label="Scene transition" labelPlacement="hidden" value={scenes.transitionType} onValueChange={scenes.setTransitionType} options={transitionOptions} />
              {scenes.transitionType === 'FadeToColor' && (
                <label className="flex items-center gap-1.5 rounded-control bg-tertiary px-2 py-1">
                  <span>Color</span>
                  <input aria-label="Transition color" type="color" className="h-[18px] w-[19px] cursor-pointer rounded-hairline border border-primary bg-transparent p-px [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-hairline [&::-webkit-color-swatch]:border-0" value={scenes.transitionColor} onChange={(event) => scenes.setTransitionColor(event.target.value)} />
                </label>
              )}
              <NumberField size="sm" className="w-24" label="Transition duration in milliseconds" labelPlacement="hidden" suffix="ms" commitOn="change" min={50} max={5000} step={50} value={scenes.transitionMs} onValueChange={scenes.setTransitionMs} />
              {project.studioMode && <ReacstButton variant="success" size="sm" aria-label="Transition scene" title="Transition scene" disabled={!program.canTransition(project.activeSceneId)} onClick={() => scenes.transitionScene()}>Transition <Clapperboard size={13} /></ReacstButton>}
            </Toolbar.Group>
            <Toolbar.Spacer />
            <Toolbar.Group label="Program">
              <ReacstButton size="sm" pressed={project.studioMode} disabled={scenes.transition !== null} onClick={scenes.toggleStudioMode}><Clapperboard size={14} />Studio Mode</ReacstButton>
              <ReacstButton.Icon variant="ghost" size="sm" label="Open program projector" tooltip="Open program projector" onClick={() => multiview.openProjector('program')}><ExternalLink /></ReacstButton.Icon>
            </Toolbar.Group>
            <span className="shrink-0 rounded-hairline bg-tertiary px-1.5 py-0.5">{project.output.width ? Math.round((previewSize.width / project.output.width) * 100) : 0}%</span>
          </Toolbar>
        </section>

        <div className="workbench-docks">
          <div className="workbench-docks-grid" style={{ gridTemplateColumns: dockColumnsTemplate(workbench.workbenchLayout) ?? undefined, minWidth: dockColumnsMinWidth(workbench.workbenchLayout) }}>
        {visibleDockIds.includes('scenes') && <ScenesDock
          style={{ gridColumn: dockGridColumn(workbench.workbenchLayout, 'scenes') ?? undefined, opacity: workbench.dockDragOpacity('scenes'), borderRight: lastDockId === 'scenes' ? 0 : undefined }}
          resizer={workbench.resizerForDock('scenes')}
          onHide={() => workbench.toggleDock('scenes')}
          platform={platform}
          scenes={project.scenes}
          activeSceneId={project.activeSceneId}
          liveSceneId={liveScene.id}
          undoAvailable={workspace.undoAvailable}
          redoAvailable={workspace.redoAvailable}
          onUndo={workspace.undoSceneEdit}
          onRedo={workspace.redoSceneEdit}
          onAddScene={scenes.addScene}
          onChooseScene={scenes.chooseScene}
          setSceneNameDraft={scenes.setSceneNameDraft}
          setSceneDialog={scenes.setSceneDialog}
          working={working}
          onDuplicateScene={() => void scenes.duplicateActiveScene()}
          studioMode={project.studioMode}
          onTransitionScene={scenes.transitionScene}
          canTransitionScene={program.canTransition}
          renderThumbnail={(scene) => <SceneThumbnail
            onVisibilityChange={reportThumbnailVisibility}
            project={runtimeDraftProject!}
            scene={runtimeDraftProject!.scenes.find((item) => item.id === scene.id)!}
            videoElements={videoElements.current}
            imageElements={imageElements.current}
            meterLevels={capture.meterLevels}
          />}
          onOpenProjector={multiview.openProjector}
          onRenameScene={scenes.renameScene}
          onReorderScenes={scenes.reorderScenes}
        />}

        {visibleDockIds.includes('sources') && <SourcesDock
          style={{ gridColumn: dockGridColumn(workbench.workbenchLayout, 'sources') ?? undefined, opacity: workbench.dockDragOpacity('sources'), borderRight: lastDockId === 'sources' ? 0 : undefined }}
          resizer={workbench.resizerForDock('sources')}
          onHide={() => workbench.toggleDock('sources')}
          sources={activeScene.sources}
          selectedSource={sources.selectedSource}
          selectedSourceIds={sources.selectedSourceIds}
          collapsedGroupIds={sources.collapsedGroupIds}
          setCollapsedGroupIds={sources.setCollapsedGroupIds}
          meterLevels={editorMeterLevels}
          sourceStatuses={editorSourceStatuses}
          onSelectSourceRow={sources.selectSourceRow}
          onToggleSourceLock={sources.toggleSourceLock}
          onMoveSource={sources.moveSource}
          onUpdateSource={sources.updateSource}
          platform={platform}
          onOpenSourceProperties={openSourceProperties}
          onOpenSourceFilters={sources.selectSource}
          onMoveSourceTo={sources.moveSourceTo}
          onReorderSources={sources.onReorderSources}
          sourceMenuTriggerRef={sources.sourceMenuTriggerRef}
          sourceMenuOpen={sources.sourceMenuOpen}
          setSourceMenuOpen={sources.setSourceMenuOpen}
          sourceActionsTriggerRef={sources.sourceActionsTriggerRef}
          sourceActionsMenuOpen={sources.sourceActionsMenuOpen}
          setSourceActionsMenuOpen={sources.setSourceActionsMenuOpen}
          sourceActions={{
            sourceClipboardAvailable: sources.sourceClipboardAvailable,
            working,
            canGroupSelectedSources: sources.canGroupSelectedSources,
            onCopySource: sources.copySelectedSource,
            onPasteSource: () => void sources.pasteSource(),
            onGroupSources: sources.groupSelectedSources,
            onUngroupSource: sources.ungroupSelectedSource,
            onFitSource: sources.fitSource,
            onCenterSource: sources.centerSource,
            onStretchSource: sources.stretchSource,
            onResetTransform: sources.resetSourceTransform,
            onRemoveSelectedSource: sources.removeSelectedSource,
          }}
          addSourceMenu={{
            desktopAudioMode,
            applicationAudioSupported,
            onOpenCapturePicker: (kind, targetSourceId) => void capture.openCapturePicker(kind, targetSourceId),
            onAddSystemAudioCapture: (targetSourceId) => void capture.addSystemAudioCapture(targetSourceId),
            onOpenApplicationAudioPicker: (targetSourceId) => void capture.openApplicationAudioPicker(targetSourceId),
            onAddCamera: () => void capture.openInputDevicePicker('camera'),
            onAddMicrophone: () => void capture.openInputDevicePicker('microphone'),
            onAddMedia: (kind) => void sources.addMedia(kind),
            onAddSlideshow: () => void sources.addSlideshow(),
            onOpenBrowserDialog: () => { sources.setSourceMenuOpen(false); sources.setBrowserDialogOpen(true); },
            onAddText: sources.addText,
            onAddColor: sources.addColor,
            referenceableScenes,
            onAddSceneReference: sources.addSceneReference,
          }}
          properties={{
            project,
            activeSceneId: activeScene.id,
            referenceableScenes,
            platform,
            working,
            desktopAudioMode,
            inputDeviceOptions: capture.inputDeviceOptions,
            runtimesSnapshot: editorRuntimes.current,
            mediaElements: editorMediaElements.current,
            mediaPlaybackStates: editorPlaybackStates,
            playbackInProgram: sources.selectedSource !== null && programSourceIds.has(getSourceRuntimeId(sources.selectedSource)),
            textStyle: selectedTextStyle,
            filters: selectedFilters,
            crop: selectedCrop,
            chromaKey: selectedChromaKey,
            hasAudioMeter: sources.selectedSource !== null && editorMeterLevels[sources.selectedSource.id] !== undefined,
            onRemove: sources.removeSelectedSource,
            onUpdateSource: sources.updateSource,
            onUpdateTextStyle: sources.updateTextStyle,
            onSwitchInputDevice: (source, deviceId) => void capture.switchInputDevice(source, deviceId),
            onUpdateCameraCaptureSettings: (source, settings) => void capture.updateCameraCaptureSettings(source, settings),
            onAddSystemAudioCapture: (targetSourceId) => void capture.addSystemAudioCapture(targetSourceId),
            onOpenApplicationAudioPicker: (targetSourceId) => void capture.openApplicationAudioPicker(targetSourceId),
            onOpenCapturePicker: (kind, targetSourceId) => void capture.openCapturePicker(kind, targetSourceId),
            onUpdateCaptureCursorMode: (sourceId, cursorMode) => void sources.updateCaptureCursorMode(sourceId, cursorMode),
            onUpdateSourceTransform: sources.updateSourceTransform,
            onFitSource: sources.fitSource,
            onCenterSource: sources.centerSource,
            onResetTransform: sources.resetSourceTransform,
            onTogglePlayback: sources.toggleMediaPlayback,
            onRestartPlayback: sources.restartMediaPlayback,
            onStopPlayback: sources.stopMediaPlayback,
            onMoveSlideshowImage: sources.moveSlideshowImage,
            onRemoveSlideshowImage: sources.removeSlideshowImage,
            onAddSlideshowImage: (sourceId) => void sources.addSlideshowImage(sourceId),
            onUpdateBrowserAudio: sources.updateBrowserAudio,
            onUpdateSourceSettings: sources.updateSourceSettings,
            onUpdateSourceMonitoring: sources.updateSourceMonitoring,
            onUpdateSourceAudioTrack: sources.updateSourceAudioTrack,
            onUpdateSourceAudioFilters: sources.updateSourceAudioFilters,
            onUpdateSourceFilters: sources.updateSourceFilters,
            onUpdateSourceCrop: sources.updateSourceCrop,
            onUpdateSourceChromaKey: sources.updateSourceChromaKey,
          }}
        />}

        {visibleDockIds.includes('mixer') && <MixerDock
          style={{ gridColumn: dockGridColumn(workbench.workbenchLayout, 'mixer') ?? undefined, opacity: workbench.dockDragOpacity('mixer'), borderRight: lastDockId === 'mixer' ? 0 : undefined }}
          resizer={workbench.resizerForDock('mixer')}
          onHide={() => workbench.toggleDock('mixer')}
          onOpenSettings={openSettings}
          staged={project.studioMode}
          sources={activeSceneLeafSources}
          meterLevels={editorMeterLevels}
          onUpdateSourceSettings={sources.updateSourceSettings}
          allAudioSources={allAudioSources}
          onUpdateSourceAudio={sources.updateSourceAudio}
          onOpenSourceProperties={openSourceProperties}
        />}

        {visibleDockIds.includes('youtube') && <YouTubeDock
          api={api}
          style={{ gridColumn: dockGridColumn(workbench.workbenchLayout, 'youtube') ?? undefined, opacity: workbench.dockDragOpacity('youtube'), borderRight: lastDockId === 'youtube' ? 0 : undefined }}
          resizer={workbench.resizerForDock('youtube')}
          onHide={() => workbench.toggleDock('youtube')}
          settings={streaming.streamServiceSettings}
          onChange={streaming.setStreamServiceSettings}
          status={streaming.outputStatuses.youtube ?? { state: 'stopped' }}
          activeOutputs={streaming.activeOutputIds.map((id) => ({ id, status: streaming.outputStatuses[id] ?? { state: 'connecting' } }))}
          streamingStartedAt={streaming.outputStartedAt.youtube ?? null}
          now={clockNow}
          onGoLive={() => streaming.goLiveForService('youtube')}
          onStopStreaming={streaming.stopStreaming}
          onOpenDashboard={() => {
            const dashboardUrl = getStreamService('youtube').dashboardUrl;
            if (dashboardUrl) void api.openExternal(dashboardUrl).catch((error) => setActionError(`Could not open YouTube Studio: ${friendlyError(error)}`));
          }}
        />}

        {visibleDockIds.includes('zoom') && <ZoomDock
          api={api}
          style={{ gridColumn: dockGridColumn(workbench.workbenchLayout, 'zoom') ?? undefined, opacity: workbench.dockDragOpacity('zoom'), borderRight: lastDockId === 'zoom' ? 0 : undefined }}
          resizer={workbench.resizerForDock('zoom')}
          onHide={() => workbench.toggleDock('zoom')}
          settings={streaming.streamServiceSettings}
          onChange={streaming.setStreamServiceSettings}
          status={streaming.outputStatuses.zoom ?? { state: 'stopped' }}
          onGoLive={() => streaming.goLiveForService('zoom')}
          onStopStreaming={() => streaming.stopStreaming('zoom')}
        />}

        {visibleDockIds.includes('controls') && <ControlsDock
          style={{ gridColumn: dockGridColumn(workbench.workbenchLayout, 'controls') ?? undefined, opacity: workbench.dockDragOpacity('controls'), borderRight: lastDockId === 'controls' ? 0 : undefined }}
          resizer={workbench.resizerForDock('controls')}
          onHide={() => workbench.toggleDock('controls')}
          working={working}
          streamOutputs={Object.entries(streaming.outputStatuses)
            .filter(([, status]) => status.state !== 'stopped')
            .map(([id, status]) => ({
              id,
              label: id === 'youtube' ? 'YouTube' : id === 'zoom' ? 'Zoom' : 'Output',
              status,
              duration: formatElapsed(streaming.outputStartedAt[id] === undefined ? 0 : clockNow - streaming.outputStartedAt[id], 'full'),
            }))}
          onGoLive={streaming.openStreamDialog}
          onStopStreaming={(outputId) => streaming.stopStreaming(outputId)}
          recordingFinalizing={recording.recordingFinalizing}
          recordingStartedAt={recording.recordingStartedAt}
          recordingPausedAt={recording.recordingPausedAt}
          onStartRecording={() => void recording.startRecording()}
          onPauseRecording={recording.pauseRecording}
          onResumeRecording={recording.resumeRecording}
          onStopRecording={recording.stopRecording}
          replayBufferStartedAt={replayBuffer.replayBufferStartedAt}
          onStartReplayBuffer={() => void replayBuffer.startReplayBuffer()}
          onStopReplayBuffer={replayBuffer.stopReplayBuffer}
          canSaveReplay={replayBuffer.canSaveReplay}
          onSaveReplay={() => void replayBuffer.saveReplay()}
          recordingDuration={duration}
        />}

          </div>
        </div>

        {workbench.dockDrag && <div className="dock-drop-indicator" style={{ left: workbench.dockDrag.left, top: workbench.dockDrag.top, height: workbench.dockDrag.height }} />}
      </section>

      <StatusBar label="Stream status">
        <StatusBar.Start>
          {streaming.streamStatus.state === 'error' && <StatusBar.Item tone="error">Error</StatusBar.Item>}
          {working && <StatusBar.Item tone="warning">Working…</StatusBar.Item>}
          {streaming.streamStatus.state === 'connecting' && <StatusBar.Item tone="warning">Connecting</StatusBar.Item>}
          {streaming.streamStatus.state === 'live' && <StatusBar.Item>LIVE {streamDuration} · {streaming.streamStatus.bitrateKbps ?? 0} kb/s</StatusBar.Item>}
          {streaming.reconnectCount > 0 && <StatusBar.Item>Reconnects: {streaming.reconnectCount}</StatusBar.Item>}
          {recording.recordingFinalizing
            ? <StatusBar.Item>REC Finalizing</StatusBar.Item>
            : recording.recordingStartedAt !== null
              ? <StatusBar.Item>{recording.recordingPausedAt === null ? 'REC' : 'REC Paused'} {duration}</StatusBar.Item>
              : null}
          {!working && streaming.streamStatus.state !== 'connecting' && streaming.streamStatus.state !== 'live'
            && recording.recordingStartedAt === null && !recording.recordingFinalizing
            && streaming.streamStatus.state !== 'error'
            && <StatusBar.Item icon={<StatusDot tone="success" />}>Ready</StatusBar.Item>}
        </StatusBar.Start>
        <StatusBar.End>
          {project.output.baseWidth !== project.output.width || project.output.baseHeight !== project.output.height ? <>
            <StatusBar.Item>Canvas {project.output.baseWidth} × {project.output.baseHeight}</StatusBar.Item>
            <StatusBar.Divider />
            <StatusBar.Item>Output {project.output.width} × {project.output.height}</StatusBar.Item>
            <StatusBar.Divider />
          </> : <StatusBar.Item>Canvas {project.output.width} × {project.output.height}</StatusBar.Item>}

          <StatusBar.Item>{project.output.frameRate} FPS</StatusBar.Item>
          {runtimeStats.runtimeStats && <>
            <StatusBar.Divider />
            <StatusBar.Item>CPU {Math.round(runtimeStats.runtimeStats.cpuPercent)}%</StatusBar.Item>
          </>}
        </StatusBar.End>
      </StatusBar>

      {scenes.sceneDialog && <NameDialog
        noun="Scene"
        mode={scenes.sceneDialog}
        name={scenes.sceneNameDraft}
        setName={scenes.setSceneNameDraft}
        nameMaxLength={120}
        deleteCopy={`Delete “${activeScene.name}” and remove its sources from this scene collection?`}
        onSubmit={scenes.sceneDialog === 'rename' ? scenes.renameActiveScene : scenes.deleteActiveScene}
        onClose={() => scenes.setSceneDialog(null)}
      />}

      {workspace.collectionDialog && <NameDialog
        noun="Collection"
        mode={workspace.collectionDialog}
        name={workspace.collectionNameDraft}
        setName={workspace.setCollectionNameDraft}
        nameMaxLength={80}
        deleteCopy={`Delete “${workspace.activeCollection?.name}”? Its scene collection will be removed. Imported media remains available to other collections.`}
        error={workspace.collectionError}
        working={working}
        deleteDisabled={workspace.collections.length <= 1}
        onSubmit={() => void workspace.submitCollectionDialog()}
        onClose={() => workspace.setCollectionDialog(null)}
      />}

      {workspace.profileDialog && <NameDialog
        noun="Profile"
        mode={workspace.profileDialog}
        name={workspace.profileNameDraft}
        setName={workspace.setProfileNameDraft}
        nameMaxLength={80}
        deleteCopy={`Delete “${workspace.activeProfile?.name}”? Output settings and hotkeys saved in this profile will be removed.`}
        error={workspace.profileError}
        working={working}
        deleteDisabled={workspace.profiles.length <= 1}
        onSubmit={() => void workspace.submitProfileDialog()}
        onClose={() => workspace.setProfileDialog(null)}
      />}

      {sources.browserDialogOpen && <BrowserSourceDialog
        url={sources.browserUrl}
        setUrl={sources.setBrowserUrl}
        onSubmit={sources.addBrowserSource}
        onClose={() => sources.setBrowserDialogOpen(false)}
      />}

      {streaming.streamDialogOpen && <StreamDialog
        project={project}
        setProjectValue={setProjectValue}
        platform={platform}
        working={working}
        settings={streaming.streamServiceSettings}
        onChangeSettings={streaming.setStreamServiceSettings}
        videoEncoderOptions={videoEncoderOptions}
        systemVideoEncoder={systemVideoEncoder}
        onSubmit={streaming.goLive}
        onClose={() => streaming.setStreamDialogOpen(false)}
      />}

      {capture.captureOptions && <CapturePicker
        captureOptions={capture.captureOptions}
        captureKind={capture.captureKind}
        captureTargetSourceId={capture.captureTargetSourceId}
        runtimesSnapshot={editorRuntimes.current}
        working={working}
        displayCaptureSystemAudio={displayCaptureSystemAudio}
        includeSystemAudio={capture.includeSystemAudio}
        setIncludeSystemAudio={capture.setIncludeSystemAudio}
        captureCursorMode={capture.captureCursorMode}
        setCaptureCursorMode={capture.setCaptureCursorMode}
        onSelect={(option) => void capture.addDesktopCapture(option)}
        onClose={() => { capture.setCaptureOptions(null); capture.setCaptureKind(null); capture.setCaptureTargetSourceId(null); }}
      />}

      {capture.inputDevicePicker && <InputDevicePicker
        kind={capture.inputDevicePicker}
        devices={capture.inputDeviceOptions[capture.inputDevicePicker]}
        working={working}
        onChoose={(device) => void capture.chooseInputDevice(device)}
        onClose={() => capture.setInputDevicePicker(null)}
      />}

      {capture.applicationAudioOptions && <ApplicationAudioPicker
        options={capture.applicationAudioOptions}
        targetSourceId={capture.applicationAudioTargetSourceId}
        runtimesSnapshot={editorRuntimes.current}
        working={working}
        onChoose={(application) => void capture.chooseAudioApplication(application)}
        onClose={() => { capture.setApplicationAudioOptions(null); capture.setApplicationAudioTargetSourceId(null); }}
      />}

      {shortcutsDialogOpen && <Modal open title="Keyboard Shortcuts" className="scene-modal" onClose={() => setShortcutsDialogOpen(false)}>
        <dl className="settings-token-legend" style={{ padding: '18px', maxHeight: '60vh', overflowY: 'auto' }}>
          <div className="settings-token-row"><dt>Settings</dt><dd>{primaryShortcutLabel(platform, ',')}</dd></div>
          <div className="settings-token-row"><dt>Undo</dt><dd>{primaryShortcutLabel(platform, 'Z')}</dd></div>
          <div className="settings-token-row"><dt>Redo</dt><dd>{primaryShortcutLabel(platform, 'Z', true)}</dd></div>
          <div className="settings-token-row"><dt>Copy Source</dt><dd>{primaryShortcutLabel(platform, 'C')}</dd></div>
          <div className="settings-token-row"><dt>Paste Source</dt><dd>{primaryShortcutLabel(platform, 'V')}</dd></div>
          <div className="settings-token-row"><dt>Delete Source</dt><dd>Delete</dd></div>
          <div className="settings-token-row"><dt>Toggle Recording</dt><dd>Ctrl+Shift+R</dd></div>
          <div className="settings-token-row"><dt>Fit Source to Screen</dt><dd>{primaryShortcutLabel(platform, 'F')}</dd></div>
          <div className="settings-token-row"><dt>Stretch Source to Screen</dt><dd>{primaryShortcutLabel(platform, 'S')}</dd></div>
          <div className="settings-token-row"><dt>Center Source</dt><dd>{primaryShortcutLabel(platform, 'D')}</dd></div>
          <div className="settings-token-row"><dt>Reset Transform</dt><dd>{primaryShortcutLabel(platform, 'R')}</dd></div>
          <div className="settings-token-row"><dt>Move Source</dt><dd>Arrow keys (Shift = 10px)</dd></div>
          <div className="settings-token-row"><dt>Rename Scene</dt><dd>F2</dd></div>
          <div className="settings-token-row"><dt>Remove Scene</dt><dd>Delete</dd></div>
          <div className="settings-token-row"><dt>Reorder Scene</dt><dd>{primaryShortcutLabel(platform, '↑ / ↓')}</dd></div>
        </dl>
      </Modal>}

      {aboutDialogOpen && <Modal open title="About LumaStream" className="scene-modal" onClose={() => setAboutDialogOpen(false)}>
        <div className="scene-delete-copy">LumaStream{appVersion ? ` ${appVersion}` : ''}</div>
      </Modal>}
    </main>
    </TooltipProvider>
  );
}
