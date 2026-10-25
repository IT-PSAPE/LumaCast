import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Badge, Modal, ReacstButton, StatusBar, StatusDot, TooltipProvider } from '@lumacast/ui';
import { Clapperboard, ExternalLink, Radio } from 'lucide-react';
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
import { getRenderedSourceIds } from './scene-render-scope';
import { canTransformSource } from './source-transform';
import { formatElapsed } from './format-elapsed';
import { recordingElapsedTime } from './recording-controls';
import { flattenSourceNodes } from '../shared/source-tree';
import { canReferenceScene, getVisibleSourceIdsForScenes } from '../shared/scene-reference-graph';
import { dockColumnsTemplate, dockGridColumn, workbenchRowsTemplate } from './workbench-layout';
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
import { useMultiview } from './features/multiview/use-multiview';
import { useRecording } from './features/recording/use-recording';
import { useStreaming } from './features/streaming/use-streaming';
import { useReplayBuffer } from './features/replay-buffer/use-replay-buffer';
import { useWorkbenchLayout } from './features/workbench/use-workbench-layout';
import { useHotkeys } from './features/hotkeys/use-hotkeys';
import { useRuntimeStats } from './features/status/use-runtime-stats';
import { useAppMenu } from './features/chrome/use-app-menu';
import { useNativeMenu } from './features/chrome/use-native-menu';

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

  const [actionError, setActionError] = useState('');
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
  // Mirrors `activeSourceIds` below every render, plus a temporary override
  // while the Multiview window is opening/closing (see useMultiview) so
  // runtime-restore logic always sees the current scope even mid-transition.
  const activeSourceIdsRef = useRef<Set<string>>(new Set());

  const [multiviewWindowOpen, setMultiviewWindowOpen] = useState(false);

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
      sources.resetForWorkspaceChange();
      scenes.resetForWorkspaceChange();
      streaming.setStreamDialogOpen(false);
    },
  });
  const { project, setProjectValue, allSources, allSourcesRef, projectRef } = workspace;

  const activeScene = project?.scenes.find((scene) => scene.id === project.activeSceneId) ?? null;
  const liveScene = project?.scenes.find((scene) => scene.id === project.liveSceneId) ?? null;

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

  // `activeSourceIds` must be computed before `useCapture` (it needs the
  // widened-while-Multiview-is-open render scope), but `useMultiview` needs
  // `useCapture`'s `runtimes`/`stopRuntime` — so `multiviewWindowOpen` is
  // owned here rather than inside `useMultiview` to break the cycle.
  const activeSourceIds = useMemo(
    () => getRenderedSourceIds(project?.scenes ?? [], project?.activeSceneId ?? null, project?.liveSceneId ?? null, multiviewWindowOpen),
    [project?.scenes, project?.activeSceneId, project?.liveSceneId, multiviewWindowOpen],
  );
  activeSourceIdsRef.current = activeSourceIds;

  const capture = useCapture({
    api, project, projectRef, allSources, allSourcesRef, liveScene, activeSourceIds, activeSourceIdsRef,
    setActionError, working, setWorking, displayCaptureSystemAudio, imageElements,
    closeSourceMenu: () => sources.setSourceMenuOpen(false),
    addToActiveScene: (source) => sources.addToActiveScene(source),
    updateSource: (sourceId, update) => sources.updateSource(sourceId, update),
  });

  const sources = useSources({
    api, project, projectRef, allSources, activeScene, liveScene, setProjectValue, setActionError, working, setWorking,
    videoElements, imageElements, mediaElements,
    runtimes: capture.runtimes, mixer: capture.mixer, applicationAudioInputs: capture.applicationAudioInputs,
    applicationAudioSessions: capture.applicationAudioSessions, attachRuntime: capture.attachRuntime, stopRuntime: capture.stopRuntime,
    startApplicationAudioRuntime: capture.startApplicationAudioRuntime, startSystemAudioRuntime: capture.startSystemAudioRuntime,
    clearNoiseSuppressionPreference: capture.clearNoiseSuppressionPreference,
  });

  const scenes = useScenes({
    project, setProjectValue, setActionError, working, setWorking, selectSource: sources.selectSource,
    runtimes: capture.runtimes, applicationAudioInputs: capture.applicationAudioInputs, applicationAudioSessions: capture.applicationAudioSessions,
    attachRuntime: capture.attachRuntime, stopRuntime: capture.stopRuntime,
    startApplicationAudioRuntime: capture.startApplicationAudioRuntime, startSystemAudioRuntime: capture.startSystemAudioRuntime,
  });

  const multiview = useMultiview({
    project, projectRef, allSourcesRef, activeSourceIdsRef, runtimes: capture.runtimes, stopRuntime: capture.stopRuntime,
    previewCanvasRef, programCanvasRef, chooseScene: scenes.chooseScene, transitionToScene: scenes.transitionToScene, setActionError,
    multiviewWindowOpen, setMultiviewWindowOpen,
  });

  const referenceableScenes = useMemo(() => project && activeScene
    ? project.scenes.filter((scene) => canReferenceScene(project.scenes, activeScene.id, scene.id))
    : [], [project?.scenes, activeScene?.id]);

  const recording = useRecording({ api, project, programCanvasRef, ensureMixer: capture.ensureMixer, setActionError, working, setWorking });
  const streaming = useStreaming({ api, project, programCanvasRef, ensureMixer: capture.ensureMixer, setActionError });
  const replayBuffer = useReplayBuffer({ api, project, programCanvasRef, ensureMixer: capture.ensureMixer, setActionError, working, setWorking });

  const workbench = useWorkbenchLayout();
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
  const streamServiceLabel = streaming.streamServiceLabel;


  return (
    <TooltipProvider>
    <main className="app-shell">
      <RuntimeVideoBank sources={allSources} runtimes={capture.runtimesSnapshot} elements={videoElements.current} mediaElements={mediaElements.current} images={imageElements.current} activeSourceIds={activeSourceIds} onMediaElement={capture.connectMediaElement} onMediaPlaybackState={capture.onMediaPlaybackState} onBrowserElement={capture.onBrowserElement} />
      {multiviewWindowOpen && <div className="multiview-offscreen" aria-hidden="true">
        {project.scenes.slice(0, multiviewTileCapacityFor(project.scenes.length)).map((scene) => <CanvasComposition
          key={scene.id}
          ref={(canvas) => {
            if (canvas) multiview.multiviewCanvasesRef.current.set(scene.id, canvas);
            else multiview.multiviewCanvasesRef.current.delete(scene.id);
          }}
          project={project}
          scene={scene}
          videoElements={videoElements.current}
          imageElements={imageElements.current}
          renderScale={0.2}
        />)}
      </div>}
      <TitleBar platform={platform} menuMode={platform === 'darwin' ? 'native' : 'hamburger'} title="LumaStream" menus={appMenus}>
        {(streaming.streamStatus.state === 'live' || streaming.streamStatus.state === 'connecting') && <Badge tone="error" shape="rounded" dot>{streaming.streamStatus.state === 'connecting' ? 'CONNECTING' : 'LIVE'} · {streamDuration}</Badge>}
        {(recording.recordingStartedAt !== null || recording.recordingFinalizing) && <Badge tone="error" shape="rounded" dot>REC · {recording.recordingFinalizing ? 'Finalizing' : duration}</Badge>}
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
        style={{ gridTemplateColumns: dockColumnsTemplate(workbench.workbenchLayout) ?? undefined, gridTemplateRows: workbenchRowsTemplate(workbench.workbenchLayout.bottomPanelHeight, visibleDockIds.length) ?? undefined }}
        onPointerDown={workbench.handleWorkbenchTitlePointerDown}
        onPointerMove={workbench.handleWorkbenchTitlePointerMove}
        onPointerUp={workbench.endDockDrag}
        onPointerCancel={workbench.endDockDrag}
      >
        {visibleDockIds.includes('scenes') && <ScenesDock
          style={{ gridColumn: dockGridColumn(workbench.workbenchLayout, 'scenes') ?? undefined, opacity: workbench.dockDragOpacity('scenes'), borderRight: lastDockId === 'scenes' ? 0 : undefined }}
          resizer={workbench.resizerForDock('scenes')}
          onHide={() => workbench.toggleDock('scenes')}
          platform={platform}
          scenes={project.scenes}
          activeSceneId={project.activeSceneId}
          liveSceneId={project.liveSceneId}
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
          onTakeScene={scenes.takeScene}
          onOpenProjector={multiview.openProjector}
          onRenameScene={scenes.renameScene}
          onReorderScenes={scenes.reorderScenes}
        />}

        <section className="monitor-dock">
          <div
            className="panel-resizer"
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
                <CanvasComposition ref={previewCanvasRef} project={project} scene={previewScene} videoElements={videoElements.current} imageElements={imageElements.current} />
                {previewOutputRect && <div className={`selection-frame ${sourceInScene?.locked ? 'locked' : ''}`} style={{ left: `${(previewOutputRect.x / project.output.width) * 100}%`, top: `${(previewOutputRect.y / project.output.height) * 100}%`, width: `${(previewOutputRect.width / project.output.width) * 100}%`, height: `${(previewOutputRect.height / project.output.height) * 100}%`, transform: sourceInScene?.kind === 'group' ? undefined : `rotate(${sourceInScene?.transform.rotation ?? 0}deg)`, transformOrigin: 'center' }}>{canTransformSource(sourceInScene?.locked) && selectionHandles.map((handle) => <span key={handle} className={`resize-handle resize-${handle}`} data-resize-handle={handle} />)}</div>}
              </div>
            </div>}
            <div key="program-panel" className="stage-panel program-panel">
              <div className="stage-label"><span><StatusDot tone="error" />PROGRAM</span><b>{liveScene.name}</b></div>
              <div className="stage-surface" style={previewSize} onPointerDown={!project.studioMode ? (event) => sources.handleStagePointerDown(event, liveScene) : undefined} onPointerMove={!project.studioMode ? sources.handleStagePointerMove : undefined} onPointerUp={!project.studioMode ? sources.handleStagePointerUp : undefined} onPointerCancel={!project.studioMode ? sources.handleStagePointerUp : undefined}>
                <CanvasComposition ref={programCanvasRef} project={project} scene={liveScene} videoElements={videoElements.current} imageElements={imageElements.current} transition={scenes.transition} onTransitionEnd={scenes.finishTransition} />
                {!project.studioMode && previewOutputRect && <div className={`selection-frame ${sourceInScene?.locked ? 'locked' : ''}`} style={{ left: `${(previewOutputRect.x / project.output.width) * 100}%`, top: `${(previewOutputRect.y / project.output.height) * 100}%`, width: `${(previewOutputRect.width / project.output.width) * 100}%`, height: `${(previewOutputRect.height / project.output.height) * 100}%`, transform: sourceInScene?.kind === 'group' ? undefined : `rotate(${sourceInScene?.transform.rotation ?? 0}deg)`, transformOrigin: 'center' }}>{canTransformSource(sourceInScene?.locked) && selectionHandles.map((handle) => <span key={handle} className={`resize-handle resize-${handle}`} data-resize-handle={handle} />)}</div>}
              </div>
            </div>
          </div>
          <div className="monitor-status">
            <div className="monitor-status-actions">
              <div className="monitor-transition-controls">
                <label className="transition-inline"><span>Transition</span><select aria-label="Scene transition" value={scenes.transitionType} onChange={(event) => scenes.setTransitionType(event.target.value as SceneTransitionType)}><option value="Fade">Fade</option><option value="Cut">Cut</option><option value="Swipe">Swipe</option><option value="Slide">Slide</option><option value="FadeToColor">Fade to Color</option></select></label>
                {scenes.transitionType === 'FadeToColor' && <label className="transition-color-inline"><span>Color</span><input aria-label="Transition color" type="color" value={scenes.transitionColor} onChange={(event) => scenes.setTransitionColor(event.target.value)} /></label>}
                <label className="transition-duration-inline"><input aria-label="Transition duration in milliseconds" type="number" min="50" max="5000" step="50" value={scenes.transitionMs} onChange={(event) => scenes.setTransitionMs(Math.max(50, Math.min(5000, Number(event.target.value) || 50)))} /><span>ms</span></label>
                {project.studioMode && <ReacstButton variant="take" size="sm" disabled={project.activeSceneId === project.liveSceneId} onClick={scenes.takeScene}>Take <Clapperboard size={13} /></ReacstButton>}
              </div>
              <div className="monitor-status-tools">
                <ReacstButton pressed={project.studioMode} onClick={scenes.toggleStudioMode}><Clapperboard size={14} />Studio Mode</ReacstButton>
                <ReacstButton.Icon variant="ghost" label="Open program projector" tooltip="Open program projector" onClick={() => multiview.openProjector('program')}><ExternalLink /></ReacstButton.Icon>
              </div>
            </div>
            <span className="monitor-zoom">{project.output.width ? Math.round((previewSize.width / project.output.width) * 100) : 0}%</span>
          </div>
        </section>

        {visibleDockIds.includes('sources') && <SourcesDock
          style={{ gridColumn: dockGridColumn(workbench.workbenchLayout, 'sources') ?? undefined, opacity: workbench.dockDragOpacity('sources'), borderRight: lastDockId === 'sources' ? 0 : undefined }}
          resizer={workbench.resizerForDock('sources')}
          onHide={() => workbench.toggleDock('sources')}
          sources={activeScene.sources}
          selectedSource={sources.selectedSource}
          selectedSourceIds={sources.selectedSourceIds}
          collapsedGroupIds={sources.collapsedGroupIds}
          setCollapsedGroupIds={sources.setCollapsedGroupIds}
          meterLevels={capture.meterLevels}
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
            runtimesSnapshot: capture.runtimesSnapshot,
            mediaElements: mediaElements.current,
            mediaPlaybackStates: capture.mediaPlaybackStates,
            textStyle: selectedTextStyle,
            filters: selectedFilters,
            crop: selectedCrop,
            chromaKey: selectedChromaKey,
            hasAudioMeter: sources.selectedSource !== null && capture.meterLevels[sources.selectedSource.id] !== undefined,
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
          sources={activeSceneLeafSources}
          meterLevels={capture.meterLevels}
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
          streamingStartedAt={streaming.streamingStartedAt}
          streamServiceLabel={streamServiceLabel}
          onGoLive={streaming.openStreamDialog}
          onStopStreaming={streaming.stopStreaming}
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
          streamStatus={streaming.streamStatus}
          streamDuration={streamDuration}
          recordingDuration={duration}
          onRemuxRecording={() => void recording.remuxRecording()}
          onOpenSettings={openSettings}
        />}

        {workbench.dockDrag && <div className="dock-drop-indicator" style={{ left: workbench.dockDrag.left, top: workbench.dockDrag.top, height: workbench.dockDrag.height }} />}
      </section>

      <StatusBar label="Stream status">
        <StatusBar.Start>
          <StatusBar.Item icon={<StatusDot tone="success" />}>Ready</StatusBar.Item>
          {working && <StatusBar.Item tone="warning">Working…</StatusBar.Item>}
        </StatusBar.Start>
        <StatusBar.Center>
          {actionError && <StatusBar.Item live tone={actionError.startsWith('Saved ') ? 'success' : 'error'} className="truncate">{actionError}</StatusBar.Item>}
        </StatusBar.Center>
        <StatusBar.End>
          {streaming.streamStatus.state === 'live' && <>
            <StatusBar.Item>LIVE {streamDuration} · {streaming.streamStatus.bitrateKbps ?? 0} kb/s</StatusBar.Item>
            <StatusBar.Divider />
          </>}
          {(recording.recordingStartedAt !== null || recording.recordingFinalizing) && <>
            <StatusBar.Item>REC {recording.recordingFinalizing ? 'Finalizing' : duration}</StatusBar.Item>
            <StatusBar.Divider />
          </>}
          {streaming.reconnectCount > 0 && <>
            <StatusBar.Item>Reconnects: {streaming.reconnectCount}</StatusBar.Item>
            <StatusBar.Divider />
          </>}
          <StatusBar.Item>Canvas {project.output.baseWidth} × {project.output.baseHeight}</StatusBar.Item>
          <StatusBar.Divider />
          <StatusBar.Item>Output {project.output.width} × {project.output.height}</StatusBar.Item>
          <StatusBar.Divider />
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
        runtimesSnapshot={capture.runtimesSnapshot}
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
        runtimesSnapshot={capture.runtimesSnapshot}
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
