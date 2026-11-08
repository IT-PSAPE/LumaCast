import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Modal, NumberField, ReacstButton, Select, StatusBar, StatusDot, Toolbar, TooltipProvider } from '@lumacast/ui';
import { Clapperboard, ExternalLink, MousePointer2, Radio, Settings } from 'lucide-react';
import { CanvasComposition, RuntimeVideoBank } from './canvas-composition';
import { SlideControls } from './slide-controls';
import { MediaControls } from './media-controls';
import { isSlideSource, navigateSlidePlayback, resetSlidePlaybackStore } from './slideshow';
import { resolveSlideControlSource, slideControlSources } from './slide-control-sources';
import { BrowserInteractionOverlay } from './browser-interaction';
import type { SceneTransitionType } from './scene-transition';
import { TitleBar } from './chrome/title-bar';
import { buildAppMenus } from './shared/app-menu';
import { StreamDialog } from './dialogs/stream-dialog';
import { NdiDialog } from './dialogs/ndi-dialog';
import { useNdi } from './application/use-ndi';
import { createSource } from './shared/source-factory';
import { BrowserSourceDialog } from './dialogs/workspace-dialogs';
import { NameDialog } from './dialogs/name-dialog';
import { ApplicationAudioPicker, CapturePicker, InputDevicePicker } from './dialogs/pickers';
import { SettingsDialog } from './dialogs/settings-dialog';
import { WorkbenchDocks } from './application/workbench-docks';
import { outputRectFromCanvasRect } from './output-scaling';
import { supportsAudioOutputSelection } from './monitor-device-routing';
import { fitPreviewSize } from './preview-layout';
import { multiviewTileCapacityFor } from './multiview-window';
import { ActionNotifications } from './action-notifications';
import { getOriginSourceId, getSourceRuntimeId, mergeRuntimeSources, toRuntimeProject, toRuntimeSource } from './source-runtime';
import { projectRuntimeMap, projectRuntimeRecord } from './runtime-projection';
import type { SourceStatus } from './source-availability';
import { formatElapsed } from './format-elapsed';
import { recordingElapsedTime } from './recording-controls';
import { flattenSourceNodes } from '../shared/source-tree';
import { getVisibleSourceIdsForScenes } from '../shared/scene-reference-graph';
import { canResizeSourceTree, isSourceTransformableInTree, visibleSelectedSourceRoots } from './source-selection';
import { workbenchRowsTemplate } from './workbench-layout';
import {
  desktopAudioCaptureModeForPlatform, isVideoEncoderAvailableOnPlatform, primaryShortcutLabel,
  supportsApplicationAudioCapture, supportsDisplayCaptureSystemAudio, systemVideoEncoderForPlatform,
} from '../shared/platform-capabilities';
import { VIDEO_ENCODER_OPTIONS } from '../shared/desktop-api';
import { friendlyError } from './shared/friendly-error';

import { useWorkspace } from './features/workspace';
import { useCapture } from './features/capture';
import { useSources } from './features/sources';
import { useScenes } from './features/scenes';
import { useProgram } from './features/scenes';
import { useMultiview } from './features/multiview';
import { useRecording } from './features/recording';
import { useStreaming } from './features/streaming';
import { useReplayBuffer } from './features/replay-buffer';
import { useWorkbenchLayout } from './features/workbench';
import { useHotkeys } from './features/hotkeys';
import { useRuntimeStats } from './features/status';
import { useAppMenu } from './features/chrome';
import { useNativeMenu } from './features/chrome';

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
  const [providerOperationCount, setProviderOperationCount] = useState(0);
  const providerOperations = useRef(new Set<symbol>());
  const beginProviderOperation = useCallback(() => {
    const operation = Symbol();
    providerOperations.current.add(operation);
    setProviderOperationCount(providerOperations.current.size);
    return () => {
      if (providerOperations.current.delete(operation)) setProviderOperationCount(providerOperations.current.size);
    };
  }, []);
  const [clockNow, setClockNow] = useState(Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [ndiDialog, setNdiDialog] = useState<'input' | 'output' | null>(null);
  const [slideTargetSessionId, setSlideTargetSessionId] = useState<string | null>(null);
  const [browserInteract, setBrowserInteract] = useState(false);
  const browserInteractionButtonRef = useRef<HTMLButtonElement>(null);
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
      resetSlidePlaybackStore();
      setSlideTargetSessionId(null);
      setBrowserInteract(false);
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
  const draftOriginIds = useMemo(() => project && activeScene
    ? getVisibleSourceIdsForScenes(project.scenes, [activeScene.id]) : new Set<string>(), [project, activeScene?.id]);
  const programOriginIds = useMemo(() => program.programProject && liveScene
    ? getVisibleSourceIdsForScenes(program.programProject.scenes, [liveScene.id]) : new Set<string>(), [program.programProject, liveScene?.id]);
  const outgoingOriginIds = useMemo(() => program.outgoingProject && program.outgoingScene
    ? getVisibleSourceIdsForScenes(program.outgoingProject.scenes, [program.outgoingScene.id]) : new Set<string>(), [program.outgoingProject, program.outgoingScene?.id]);
  const runtimeSources = useMemo(() => mergeRuntimeSources({
    draftScenes: runtimeDraftProject?.scenes ?? [], programScenes: runtimeProgramProject?.scenes ?? [], outgoingScenes: runtimeOutgoingProject?.scenes,
    draftSourceIds: draftOriginIds, programSourceIds: programOriginIds, outgoingSourceIds: outgoingOriginIds,
  }), [runtimeDraftProject?.scenes, runtimeProgramProject?.scenes, runtimeOutgoingProject?.scenes, draftOriginIds, programOriginIds, outgoingOriginIds]);
  const editorRuntimeSources = useMemo(() => runtimeDraftProject?.scenes.flatMap((scene) => flattenSourceNodes(scene.sources)) ?? [], [runtimeDraftProject]);
  const referencedSourceIds = useMemo(() => new Set([
    ...editorRuntimeSources,
    ...(runtimeProgramProject?.scenes.flatMap((scene) => flattenSourceNodes(scene.sources)) ?? []),
    ...(runtimeOutgoingProject?.scenes.flatMap((scene) => flattenSourceNodes(scene.sources)) ?? []),
  ].map((source) => source.id)), [editorRuntimeSources, runtimeProgramProject, runtimeOutgoingProject]);
  const visibleDraftSourceIds = useMemo(() => project
    ? getVisibleSourceIdsForScenes(project.scenes, project.scenes.map((scene) => scene.id))
    : new Set<string>(), [project?.scenes]);
  const visibleEditorRuntimeSources = useMemo(() => editorRuntimeSources.filter((source) => visibleDraftSourceIds.has(getOriginSourceId(source))),
    [editorRuntimeSources, visibleDraftSourceIds]);
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
  const previewMediaSourceIds = useMemo(() => new Set(project?.studioMode
    ? editorRuntimeSources.filter((source) => draftOriginIds.has(getOriginSourceId(source))).map((source) => source.id)
    : []), [project?.studioMode, editorRuntimeSources, draftOriginIds]);
  const retainedSourceIds = useMemo(() => {
    const ids = new Set(programSourceIds);
    if (runtimeOutgoingProject && program.outgoingScene) {
      for (const id of getVisibleSourceIdsForScenes(runtimeOutgoingProject.scenes, [program.outgoingScene.id])) ids.add(id);
    }
    return ids;
  }, [programSourceIds, runtimeOutgoingProject, program.outgoingScene?.id]);
  const slideshowPlaybackSources = useMemo(() => {
    const visibleSources = (snapshot: typeof program.programProject, sceneId: string | undefined) => {
      if (!snapshot || !sceneId) return [];
      const ids = getVisibleSourceIdsForScenes(snapshot.scenes, [sceneId]);
      return snapshot.scenes.flatMap((scene) => flattenSourceNodes(scene.sources)).filter((source) => ids.has(source.id) && isSlideSource(source))
        .map((source) => toRuntimeSource(source));
    };
    return [...visibleSources(program.outgoingProject, program.outgoingScene?.id), ...visibleSources(program.programProject, liveScene?.id)];
  }, [program.programProject, program.outgoingProject, liveScene?.id, program.outgoingScene?.id]);
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
    programProject: runtimeProgramProject, programSourceIds, programSourceOriginIds: programOriginIds, retainedSourceIds, activeSourceIds, activeSourceIdsRef,
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
  const ndiActiveIds = useMemo(() => new Set([...activeSourceIds, ...retainedSourceIds]), [activeSourceIds, retainedSourceIds]);
  const ndi = useNdi({ api: api.ndi, sources: runtimeSources, activeIds: ndiActiveIds, capture,
    programCanvas: programCanvasRef, project: program.programProject, onError: setActionError });
  const editorRuntimes = useRef(capture.runtimes.current);
  editorRuntimes.current = projectRuntimeMap(visibleEditorRuntimeSources, capture.runtimes.current);
  const editorApplicationAudioInputs = useRef(capture.applicationAudioInputs.current);
  editorApplicationAudioInputs.current = projectRuntimeMap(visibleEditorRuntimeSources, capture.applicationAudioInputs.current);
  const editorApplicationAudioSessions = useRef(capture.applicationAudioSessions.current);
  editorApplicationAudioSessions.current = projectRuntimeMap(visibleEditorRuntimeSources, capture.applicationAudioSessions.current);
  const editorVideoElements = useRef(videoElements.current);
  editorVideoElements.current = projectRuntimeMap(visibleEditorRuntimeSources, videoElements.current);
  const editorImageElements = useRef(imageElements.current);
  editorImageElements.current = projectRuntimeMap(visibleEditorRuntimeSources, imageElements.current);
  const editorMediaElements = useRef(mediaElements.current);
  editorMediaElements.current = projectRuntimeMap(visibleEditorRuntimeSources, mediaElements.current);
  const editorMeterLevels = projectRuntimeRecord(visibleEditorRuntimeSources, capture.meterLevels);

  const sources = useSources({
    api, project, projectRef, allSources, activeScene, liveScene, setProjectValue, setActionError, working, setWorking,
    videoElements: editorVideoElements, imageElements: editorImageElements, mediaElements: editorMediaElements, programSourceIds,
    runtimes: editorRuntimes, mixer: capture.mixer, applicationAudioInputs: editorApplicationAudioInputs,
    applicationAudioSessions: editorApplicationAudioSessions, attachRuntime: capture.attachRuntime, stopRuntime: capture.stopRuntime,
    startApplicationAudioRuntime: capture.startApplicationAudioRuntime, startSystemAudioRuntime: capture.startSystemAudioRuntime,
    clearNoiseSuppressionPreference: capture.clearNoiseSuppressionPreference,
  });
  const availableSlideSources = useMemo(() => slideControlSources(project, program.programProject, program.programSceneId),
    [project, program.programProject, program.programSceneId]);
  const slideControlSource = resolveSlideControlSource(availableSlideSources, slideTargetSessionId);
  useEffect(() => {
    if (slideControlSource) setSlideTargetSessionId(getSourceRuntimeId(slideControlSource));
  }, [slideControlSource]);
  useEffect(() => {
    setBrowserInteract(false);
  }, [sources.selectedSourceId, project?.activeSceneId]);
  useEffect(() => () => resetSlidePlaybackStore(), []);

  const scenes = useScenes({
    project, setProjectValue, setActionError, working, setWorking, selectSource: sources.selectSource,
    programSceneId: program.programSceneId, canTransition: program.canTransition, commitProgram: program.commitProgram, finishProgramTransition: program.finishOutgoingProgram,
    sceneRuntimePort: capture.createSceneRuntimePort(visibleDraftSourceIds),
  });

  const multiview = useMultiview({
    project, projectRef, programSceneId: program.programSceneId, programFrameRate: program.programProject?.output.frameRate ?? null,
    previewCanvasRef, programCanvasRef, chooseScene: scenes.chooseScene, transitionToScene: scenes.transitionToScene, setActionError,
    multiviewWindowOpen, setMultiviewWindowOpen,
  });

  const recording = useRecording({ api, project: program.programProject, programCanvasRef, ensureMixer: capture.ensureMixer, setActionError, working, setWorking });
  const streaming = useStreaming({ api, project: program.programProject, programCanvasRef, ensureMixer: capture.ensureMixer, setActionError });
  const startSelectedDestinations = () => {
    if (providerOperations.current.size > 0) {
      setActionError('Finish connecting or creating destinations before starting.');
      return;
    }
    streaming.startSelectedDestinations();
  };
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
    selectedSource: sources.selectedSource, nudgeSelectedSources: sources.nudgeSelectedSources,
    updateSource: sources.updateSource, fitSource: sources.fitSource,
    stretchSource: sources.stretchSource, centerSource: sources.centerSource,
    undoSceneEdit: workspace.undoSceneEdit, redoSceneEdit: workspace.redoSceneEdit,
    pasteSource: sources.pasteSource, removeSelectedSource: sources.removeSelectedSource, copySelectedSource: sources.copySelectedSource,
    sourceClipboardAvailable: sources.sourceClipboardAvailable, chooseScene: scenes.chooseScene,
    startRecording: recording.startRecording, stopRecording: recording.stopRecording, isRecording: recording.isActive,
    isActivelyRecording: recording.isActivelyRecording,
    stopStreaming: streaming.stopStreaming, isStreaming: streaming.isActive, openStreamDialog: startSelectedDestinations,
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
    onQuit: () => { void api.quit().catch((error) => setActionError(`Stream could not quit: ${friendlyError(error)}`)); },
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
  const appMenus = useMemo(() => project ? buildAppMenus(appMenuContext) : [{
    id: 'file', label: 'File', entries: [{ id: 'file.quit', label: 'Quit', onSelect: appMenuContext.actions.quit }],
  }], [appMenuContext, project]);
  useNativeMenu({ api, platform, menus: appMenus });

  if (!project || !activeScene || !liveScene) return <TooltipProvider>
    <main className="app-shell" style={{ gridTemplateRows: '36px minmax(0, 1fr)' }}>
      <TitleBar platform={platform} menuMode={platform === 'darwin' ? 'native' : 'hamburger'} title="LumaStream" menus={appMenus} />
      {workspace.loadingError ? <section className="fatal" aria-labelledby="workspace-load-error">
        <div className="fatal-mark"><Radio size={24} /></div>
        <h1 id="workspace-load-error">Stream could not start</h1>
        <p role="alert">{workspace.loadingError}</p>
        <ReacstButton onClick={workspace.retryLoad}>Retry</ReacstButton>
      </section> : <section className="loading" aria-live="polite">
        <div className="brand-pulse"><Radio size={22} /></div><span>Starting Stream</span>
      </section>}
    </main>
  </TooltipProvider>;

  const selectedSourceFrames = visibleSelectedSourceRoots(activeScene.sources, sources.selectedSourceIds).map((source) => ({
    source,
    rect: outputRectFromCanvasRect(
      source.transform,
      { width: project.output.baseWidth, height: project.output.baseHeight },
      { width: project.output.width, height: project.output.height },
    ),
  }));
  const canResizeSelectedSource = sources.selectedSourceIds.length === 1
    && selectedSourceFrames.length === 1
    && isSourceTransformableInTree(activeScene.sources, selectedSourceFrames[0]!.source.id)
    && canResizeSourceTree(selectedSourceFrames[0]!.source);
  const stageSnapGuides = sources.snapGuides.map((guide) => {
    const rect = outputRectFromCanvasRect(guide.axis === 'x'
      ? { x: guide.position, y: 0, width: 0, height: project.output.baseHeight }
      : { x: 0, y: guide.position, width: project.output.baseWidth, height: 0 },
    { width: project.output.baseWidth, height: project.output.baseHeight }, project.output);
    return <span key={`${guide.axis}:${guide.position}`} className={`source-snap-guide source-snap-guide--${guide.axis}`} aria-hidden="true"
      style={{ left: `${rect.x / project.output.width * 100}%`, top: `${rect.y / project.output.height * 100}%`,
        ...(guide.axis === 'x' ? { height: `${rect.height / project.output.height * 100}%` } : { width: `${rect.width / project.output.width * 100}%` }) }} />;
  });
  const previewScene = activeScene;
  const runtimePreviewScene = runtimeDraftProject!.scenes.find((scene) => scene.id === activeScene.id)!;
  const runtimeProgramScene = runtimeProgramProject!.scenes.find((scene) => scene.id === liveScene.id)!;
  const runtimeOutgoingScene = runtimeOutgoingProject?.scenes.find((scene) => scene.id === program.outgoingScene?.id);
  const programPreviewSize = fitPreviewSize(previewSize.width, previewSize.height, runtimeProgramProject!.output.width, runtimeProgramProject!.output.height);
  const duration = formatElapsed(recording.recordingStartedAt === null ? 0 : recordingElapsedTime(clockNow, recording.recordingPausedAt, recording.recordingAccumulatedPauseMs) - recording.recordingStartedAt, 'full');
  const streamDuration = formatElapsed(streaming.streamingStartedAt === null ? 0 : clockNow - streaming.streamingStartedAt, 'full');
  const activeSceneVisibleSourceIds = getVisibleSourceIdsForScenes(project.scenes, [activeScene.id]);
  const selectedSource = sources.selectedSource;
  const browserInteractionSourceId = selectedSource?.kind === 'browser' && activeSceneVisibleSourceIds.has(selectedSource.id)
    ? getSourceRuntimeId(selectedSource, { width: project.output.baseWidth, height: project.output.baseHeight }) : null;
  const browserInteractionControl = browserInteractionSourceId && <ReacstButton.Icon ref={browserInteractionButtonRef} variant="ghost" size="xs"
    label="Interact with browser" tooltip="Interact with browser · Esc to exit" pressed={browserInteract} onClick={() => setBrowserInteract((value) => !value)}><MousePointer2 /></ReacstButton.Icon>;
  const exitBrowserInteraction = () => {
    setBrowserInteract(false);
    browserInteractionButtonRef.current?.focus();
  };
  const selectionHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const visibleDockIds = workbench.visibleDockIds;


  return (
    <TooltipProvider>
    <main className="app-shell">
      {ndiDialog && <NdiDialog api={api.ndi} mode={ndiDialog} onClose={() => setNdiDialog(null)}
        sending={ndi.sending} starting={ndi.starting} stopping={ndi.stopping} onStart={ndi.startSending} onStop={ndi.stopSending}
        output={program.programProject?.output} onSelect={(choice) => {
          if (!project) return;
          sources.addToActiveScene(createSource('ndi', project.output, choice.name.slice(0, 120),
            { ndiSourceName: choice.name, ndiUrlAddress: choice.urlAddress, captureAudioEnabled: true }));
          setNdiDialog(null);
        }} />}
      <ActionNotifications message={actionFeedback.message} sequence={actionFeedback.sequence} />
      <RuntimeVideoBank key={workspace.activeCollectionId} sources={runtimeSources} referencedSourceIds={referencedSourceIds} runtimes={capture.runtimesSnapshot} elements={videoElements.current} mediaElements={mediaElements.current} images={imageElements.current} activeSourceIds={activeSourceIds} programSourceIds={programSourceIds} playbackSourceIds={retainedSourceIds} slideshowPlaybackSources={slideshowPlaybackSources} onSourceStatus={reportResourceStatus} onMediaElement={capture.connectMediaElement} onMediaPlaybackState={capture.onMediaPlaybackState} onBrowserElement={capture.onBrowserElement} />
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
        <ReacstButton variant="ghost" size="sm" pressed={project.studioMode} disabled={scenes.transition !== null} onClick={scenes.toggleStudioMode}><Clapperboard size={14} />Studio Mode</ReacstButton>
        <ReacstButton.Icon variant="ghost" size="sm" label="Open program projector" tooltip="Open program projector" onClick={() => multiview.openProjector('program')}><ExternalLink /></ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" size="sm" label="Open settings" tooltip="Settings" onClick={openSettings}><Settings /></ReacstButton.Icon>
      </TitleBar>

      {settingsOpen && <SettingsDialog
        settingsOpenerRef={settingsOpenerRef}
        onClose={closeSettings}
        project={project}
        setProjectValue={setProjectValue}
        platform={platform}
        streamServiceSettings={streaming.streamServiceSettings}
        streamDestinationsLocked={streaming.isActive() || providerOperationCount > 0}
        onSaveStreamServiceSettings={(next) => {
          if (!streaming.isActive() && providerOperations.current.size === 0) streaming.setStreamServiceSettings(next);
        }}
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
              <div className="stage-label"><span>PREVIEW</span><b>{activeScene.name}</b>{browserInteractionControl}<ReacstButton.Icon variant="ghost" size="xs" label="Open preview projector" tooltip="Open preview projector" onClick={() => multiview.openProjector('preview')}><ExternalLink /></ReacstButton.Icon></div>
              <div className="stage-surface" style={previewSize} onPointerDown={(event) => sources.handleStagePointerDown(event, previewScene)} onPointerMove={sources.handleStagePointerMove} onPointerUp={sources.handleStagePointerUp} onPointerCancel={sources.handleStagePointerUp}>
                <CanvasComposition ref={previewCanvasRef} project={runtimeDraftProject!} scene={runtimePreviewScene} videoElements={videoElements.current} imageElements={imageElements.current} />
                {stageSnapGuides}
                {browserInteract && <BrowserInteractionOverlay scene={runtimePreviewScene} output={project.output} selectedSourceId={browserInteractionSourceId}
                  imageElements={imageElements.current} sendBrowserSourceInput={api.sendBrowserSourceInput} onExit={exitBrowserInteraction}
                  onError={(error) => setActionError(`Browser interaction failed: ${friendlyError(error)}`)} />}
                {selectedSourceFrames.map(({ source, rect }) => <div key={source.id} className={`selection-frame ${source.locked ? 'locked' : ''}`} style={{ left: `${(rect.x / project.output.width) * 100}%`, top: `${(rect.y / project.output.height) * 100}%`, width: `${(rect.width / project.output.width) * 100}%`, height: `${(rect.height / project.output.height) * 100}%`, transform: source.kind === 'group' ? undefined : `rotate(${source.transform.rotation ?? 0}deg)`, transformOrigin: 'center' }}>{canResizeSelectedSource && source.id === sources.selectedSourceId && selectionHandles.map((handle) => <span key={handle} className={`resize-handle resize-${handle}`} data-resize-handle={handle} title={`Drag to resize · Shift: preserve aspect · ${platform === 'darwin' ? '⌘' : 'Ctrl'}: crop · Alt: ignore snapping`} />)}</div>)}
              </div>
            </div>}
            <div key="program-panel" className="stage-panel program-panel">
              <div className="stage-label"><span><StatusDot tone="error" />PROGRAM</span><b>{liveScene.name}</b>{!project.studioMode && browserInteractionControl}</div>
              <div className="stage-surface" style={programPreviewSize} onPointerDown={!project.studioMode ? (event) => sources.handleStagePointerDown(event, liveScene) : undefined} onPointerMove={!project.studioMode ? sources.handleStagePointerMove : undefined} onPointerUp={!project.studioMode ? sources.handleStagePointerUp : undefined} onPointerCancel={!project.studioMode ? sources.handleStagePointerUp : undefined}>
                <CanvasComposition ref={programCanvasRef} project={runtimeProgramProject!} scene={runtimeProgramScene} outgoingProject={runtimeOutgoingProject ?? undefined} outgoingScene={runtimeOutgoingScene} videoElements={videoElements.current} imageElements={imageElements.current} transition={scenes.transition} onTransitionEnd={scenes.finishTransition} />
                {!project.studioMode && stageSnapGuides}
                {!project.studioMode && browserInteract && <BrowserInteractionOverlay scene={runtimeProgramScene} output={project.output} selectedSourceId={browserInteractionSourceId}
                  imageElements={imageElements.current} sendBrowserSourceInput={api.sendBrowserSourceInput} onExit={exitBrowserInteraction}
                  onError={(error) => setActionError(`Browser interaction failed: ${friendlyError(error)}`)} />}
                {!project.studioMode && selectedSourceFrames.map(({ source, rect }) => <div key={source.id} className={`selection-frame ${source.locked ? 'locked' : ''}`} style={{ left: `${(rect.x / project.output.width) * 100}%`, top: `${(rect.y / project.output.height) * 100}%`, width: `${(rect.width / project.output.width) * 100}%`, height: `${(rect.height / project.output.height) * 100}%`, transform: source.kind === 'group' ? undefined : `rotate(${source.transform.rotation ?? 0}deg)`, transformOrigin: 'center' }}>{canResizeSelectedSource && source.id === sources.selectedSourceId && selectionHandles.map((handle) => <span key={handle} className={`resize-handle resize-${handle}`} data-resize-handle={handle} title={`Drag to resize · Shift: preserve aspect · ${platform === 'darwin' ? '⌘' : 'Ctrl'}: crop · Alt: ignore snapping`} />)}</div>)}
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
            <MediaControls sources={runtimeSources} programSourceIds={programSourceIds} previewSourceIds={previewMediaSourceIds}
              elements={mediaElements.current} playbackStates={capture.mediaPlaybackStates} resourceStatuses={resourceStatuses} onError={setActionError} />
            <Toolbar.Spacer />
            {availableSlideSources.length > 0 && <Toolbar.Group label="Slide source">
              <Select size="sm" className="w-40" label="Slide source" labelPlacement="hidden" placeholder="Choose slides" value={slideControlSource ? getSourceRuntimeId(slideControlSource) : ''} onValueChange={setSlideTargetSessionId}
                options={availableSlideSources.map((source) => ({ value: getSourceRuntimeId(source), label: source.name }))} />
            </Toolbar.Group>}
            <SlideControls source={slideControlSource} onNavigate={(action) => {
              if (slideControlSource) navigateSlidePlayback(slideControlSource, action);
            }} />
          </Toolbar>
        </section>

        <WorkbenchDocks
          api={api}
          platform={platform}
          desktopAudioMode={desktopAudioMode}
          applicationAudioSupported={applicationAudioSupported}
          working={working}
          workbench={workbench}
          features={{ workspace, sources, capture, scenes, program, multiview, recording, streaming, replayBuffer, ndi }}
          runtime={{
            project,
            activeScene,
            liveScene,
            allSources,
            runtimeDraftProject: runtimeDraftProject!,
            visibleEditorSources: visibleEditorRuntimeSources,
            visibleDraftSourceIds,
            programSourceIds,
            editorRuntimes: editorRuntimes.current,
            editorMediaElements: editorMediaElements.current,
            editorMeterLevels,
            resourceStatuses,
            videoElements: videoElements.current,
            imageElements: imageElements.current,
            clockNow,
            recordingDuration: duration,
            providerOperationCount,
            onThumbnailVisibilityChange: reportThumbnailVisibility,
          }}
          actions={{
            openSettings,
            openNdiInput: () => setNdiDialog('input'),
            openNdiOutput: () => setNdiDialog('output'),
            openSourceProperties,
            startSelectedDestinations,
            beginProviderOperation,
            setActionError,
          }}
        />
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
        working={working || streaming.isActive() || providerOperationCount > 0}
        settings={streaming.streamServiceSettings}
        onChangeSettings={(next) => {
          if (!streaming.isActive()) streaming.setStreamServiceSettings(next);
        }}
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
        supportsSystemAudio={capture.supportsSystemAudio}
        supportsApplicationAudio={capture.supportsApplicationAudio}
        captureAudioMode={capture.captureAudioMode}
        setCaptureAudioMode={capture.setCaptureAudioMode}
        captureAudioApplications={capture.captureAudioApplications}
        captureAudioApplicationLoading={capture.captureAudioApplicationLoading}
        selectedCaptureAudioApplication={capture.selectedCaptureAudioApplication}
        onLoadCaptureAudioApplications={capture.onLoadCaptureAudioApplications}
        onSelectCaptureAudioApplication={capture.onSelectCaptureAudioApplication}
        captureCursorMode={capture.captureCursorMode}
        setCaptureCursorMode={capture.setCaptureCursorMode}
        onSelect={(option) => void capture.addDesktopCapture(option)}
        onClose={() => { capture.setCaptureOptions(null); capture.setCaptureKind(null); capture.setCaptureTargetSourceId(null); }}
      />}

      {capture.inputDevicePicker && <InputDevicePicker
        kind={capture.inputDevicePicker}
        devices={capture.inputDeviceOptions[capture.inputDevicePicker]}
        audioDevices={capture.inputDeviceOptions.microphone}
        captureAudioEnabled={capture.cameraAudioEnabled}
        setCaptureAudioEnabled={capture.setCameraAudioEnabled}
        audioDeviceId={capture.cameraAudioDeviceId}
        setAudioDeviceId={capture.setCameraAudioDeviceId}
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
          <div className="settings-token-row"><dt>Preserve Aspect Ratio</dt><dd>Shift + resize handle</dd></div>
          <div className="settings-token-row"><dt>Crop Source</dt><dd>{platform === 'darwin' ? '⌘' : 'Ctrl'} + resize handle</dd></div>
          <div className="settings-token-row"><dt>Ignore Snapping</dt><dd>Alt + drag</dd></div>
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
