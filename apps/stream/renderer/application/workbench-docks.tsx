import type { MouseEvent as ReactMouseEvent } from 'react';
import type { StreamAPI, StreamProject, StreamScene, StreamSource } from '../../shared/desktop-api';
import { captureAudioModeForSource } from '../../shared/capture-audio';
import { getVisibleSourceIdsForScenes } from '../../shared/scene-reference-graph';
import type { DesktopAudioCaptureMode, StreamPlatform } from '../../shared/platform-capabilities';
import type { RuntimeProject } from '../source-runtime';
import { dockColumnsMinWidth, dockColumnsTemplate, dockGridColumn } from '../workbench-layout';
import { formatElapsed } from '../format-elapsed';
import { getStreamService } from '../../shared/stream-services';
import { friendlyError } from '../shared/friendly-error';
import { ScenesDock } from '../docks/scenes-dock';
import { SceneThumbnail } from '../docks/scene-thumbnail';
import { MixerDock } from '../docks/mixer-dock';
import { SourcesDockContainer } from './sources-dock';
import { YouTubeDock } from '../docks/youtube-dock';
import { ZoomDock } from '../docks/zoom-dock';
import { ControlsDock } from '../docks/controls-dock';
import type { UseCaptureResult } from '../features/capture';
import type { UseSourcesResult } from '../features/sources';
import type { useWorkspace } from '../features/workspace';
import type { useScenes } from '../features/scenes';
import type { useProgram } from '../features/scenes';
import type { useMultiview } from '../features/multiview';
import type { useRecording } from '../features/recording';
import type { useStreaming } from '../features/streaming';
import type { useReplayBuffer } from '../features/replay-buffer';
import type { UseWorkbenchLayoutResult } from '../features/workbench';
import type { useNdi } from './use-ndi';
import type { SourceStatus } from '../source-availability';

export interface WorkbenchDockFeatures {
  workspace: Pick<ReturnType<typeof useWorkspace>, 'activeCollectionId'>;
  sources: UseSourcesResult;
  capture: UseCaptureResult;
  scenes: ReturnType<typeof useScenes>;
  program: ReturnType<typeof useProgram>;
  multiview: ReturnType<typeof useMultiview>;
  recording: ReturnType<typeof useRecording>;
  streaming: ReturnType<typeof useStreaming>;
  replayBuffer: ReturnType<typeof useReplayBuffer>;
  ndi: ReturnType<typeof useNdi>;
}

export interface WorkbenchDockRuntime {
  project: StreamProject;
  activeScene: StreamScene;
  liveScene: StreamScene;
  allSources: StreamSource[];
  runtimeDraftProject: RuntimeProject;
  visibleEditorSources: readonly StreamSource[];
  visibleDraftSourceIds: ReadonlySet<string>;
  programSourceIds: ReadonlySet<string>;
  editorRuntimes: ReadonlyMap<string, MediaStream>;
  editorMediaElements: ReadonlyMap<string, HTMLMediaElement>;
  editorMeterLevels: Record<string, number>;
  resourceStatuses: Readonly<Record<string, SourceStatus>>;
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
  clockNow: number;
  recordingDuration: string;
  providerOperationCount: number;
  onThumbnailVisibilityChange: (sceneId: string, visible: boolean) => void;
}

export interface WorkbenchDockActions {
  openSettings: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  openNdiInput: () => void;
  openNdiOutput: () => void;
  openSourceProperties: (sourceId: string) => void;
  startSelectedDestinations: () => void;
  beginProviderOperation: () => () => void;
  setActionError: (message: string) => void;
}

export interface WorkbenchDocksProps {
  api: StreamAPI;
  platform: StreamPlatform;
  desktopAudioMode: DesktopAudioCaptureMode;
  applicationAudioSupported: boolean;
  working: boolean;
  workbench: UseWorkbenchLayoutResult;
  features: WorkbenchDockFeatures;
  runtime: WorkbenchDockRuntime;
  actions: WorkbenchDockActions;
}

function dockStyle(workbench: UseWorkbenchLayoutResult, dockId: Parameters<typeof dockGridColumn>[1], lastDockId: string | undefined) {
  return {
    gridColumn: dockGridColumn(workbench.workbenchLayout, dockId) ?? undefined,
    opacity: workbench.dockDragOpacity(dockId),
    borderRight: lastDockId === dockId ? 0 : undefined,
  };
}

export function WorkbenchDocks({ api, platform, desktopAudioMode, applicationAudioSupported, working, workbench, features, runtime, actions }: WorkbenchDocksProps) {
  const { project, activeScene, liveScene, allSources, runtimeDraftProject, visibleEditorSources, visibleDraftSourceIds,
    programSourceIds, editorRuntimes, editorMediaElements, editorMeterLevels, resourceStatuses, videoElements, imageElements,
    clockNow, recordingDuration, providerOperationCount, onThumbnailVisibilityChange } = runtime;
  const { workspace, sources, capture, scenes, program, multiview, recording, streaming, replayBuffer, ndi } = features;
  const visibleDockIds = workbench.visibleDockIds;
  const lastDockId = visibleDockIds[visibleDockIds.length - 1];
  const activeSceneVisibleSourceIds = getVisibleSourceIdsForScenes(project.scenes, [activeScene.id]);
  const activeSceneLeafSources = allSources.filter((source) => activeSceneVisibleSourceIds.has(source.id)
    && source.kind !== 'group' && source.kind !== 'scene');
  const allAudioSources = allSources.filter((source) => visibleDraftSourceIds.has(source.id) && (source.kind === 'microphone'
    || source.kind === 'desktop-audio'
    || source.kind === 'application-audio'
    || source.kind === 'media'
    || (source.kind === 'camera' && source.captureAudioEnabled === true)
    || ((source.kind === 'display' || source.kind === 'window') && captureAudioModeForSource(source, platform) !== 'off')
    || (source.kind === 'ndi' && source.captureAudioEnabled !== false)
    || (source.kind === 'browser' && source.browserAudioEnabled === true)));

  return <>
    <div className="workbench-docks">
      <div className="workbench-docks-grid" style={{ gridTemplateColumns: dockColumnsTemplate(workbench.workbenchLayout) ?? undefined, minWidth: dockColumnsMinWidth(workbench.workbenchLayout) }}>
        {visibleDockIds.includes('scenes') && <ScenesDock
          style={dockStyle(workbench, 'scenes', lastDockId)}
          resizer={workbench.resizerForDock('scenes')}
          onHide={() => workbench.toggleDock('scenes')}
          platform={platform}
          scenes={project.scenes}
          activeSceneId={project.activeSceneId}
          liveSceneId={liveScene.id}
          selectionScopeKey={workspace.activeCollectionId}
          onAddScene={scenes.addScene}
          onChooseScene={scenes.chooseScene}
          setSceneNameDraft={scenes.setSceneNameDraft}
          setSceneDialog={scenes.setSceneDialog}
          working={working}
          onDuplicateScene={(sceneId) => void scenes.duplicateActiveScene(sceneId)}
          studioMode={project.studioMode}
          onTransitionScene={scenes.transitionScene}
          canTransitionScene={program.canTransition}
          renderThumbnail={(scene) => <SceneThumbnail
            onVisibilityChange={onThumbnailVisibilityChange}
            project={runtimeDraftProject}
            scene={runtimeDraftProject.scenes.find((item) => item.id === scene.id)!}
            videoElements={videoElements}
            imageElements={imageElements}
            meterLevels={capture.meterLevels}
          />}
          onOpenProjector={multiview.openProjector}
          onRenameScene={scenes.renameScene}
          onReorderScenes={scenes.reorderScenes}
          onRequestDeleteScenes={scenes.deleteScenes}
        />}

        {visibleDockIds.includes('sources') && <SourcesDockContainer
          project={project}
          activeScene={activeScene}
          platform={platform}
          desktopAudioMode={desktopAudioMode}
          applicationAudioSupported={applicationAudioSupported}
          working={working}
          sourceFeature={sources}
          capture={capture}
          ndi={ndi}
          runtime={{
            visibleEditorSources: visibleEditorSources,
            visibleDraftSourceIds,
            programSourceIds,
            runtimes: editorRuntimes,
            mediaElements: editorMediaElements,
            meterLevels: editorMeterLevels,
            mediaPlaybackStates: capture.mediaPlaybackStates,
            captureStatuses: capture.sourceStatuses,
            resourceStatuses,
          }}
          workbench={workbench}
          onOpenNdiInput={actions.openNdiInput}
          onOpenSourceProperties={actions.openSourceProperties}
        />}

        {visibleDockIds.includes('mixer') && <MixerDock
          style={dockStyle(workbench, 'mixer', lastDockId)}
          resizer={workbench.resizerForDock('mixer')}
          onHide={() => workbench.toggleDock('mixer')}
          onOpenSettings={actions.openSettings}
          staged={project.studioMode}
          sources={activeSceneLeafSources}
          meterLevels={editorMeterLevels}
          onUpdateSourceSettings={sources.updateSourceSettings}
          allAudioSources={allAudioSources}
          onUpdateSourceAudio={sources.updateSourceAudio}
          onOpenSourceProperties={actions.openSourceProperties}
        />}

        {visibleDockIds.includes('youtube') && <YouTubeDock
          api={api}
          style={dockStyle(workbench, 'youtube', lastDockId)}
          resizer={workbench.resizerForDock('youtube')}
          onHide={() => workbench.toggleDock('youtube')}
          settings={streaming.streamServiceSettings}
          onChange={(next) => {
            if (!streaming.isActive()) streaming.setStreamServiceSettings((current) => ({ ...next, zoom: current.zoom }));
          }}
          status={streaming.outputStatuses.youtube ?? { state: 'stopped' }}
          selectionLocked={streaming.isActive()}
          onOperationStart={actions.beginProviderOperation}
          activeOutputs={streaming.activeOutputIds.map((id) => ({ id, status: streaming.outputStatuses[id] ?? { state: 'connecting' } }))}
          streamingStartedAt={streaming.outputStartedAt.youtube ?? null}
          now={clockNow}
          onGoLive={() => streaming.goLiveForService('youtube')}
          onStopStreaming={streaming.stopStreaming}
          onOpenDashboard={() => {
            const dashboardUrl = getStreamService('youtube').dashboardUrl;
            if (dashboardUrl) void api.openExternal(dashboardUrl).catch((error) => actions.setActionError(`Could not open YouTube Studio: ${friendlyError(error)}`));
          }}
        />}

        {visibleDockIds.includes('zoom') && <ZoomDock
          api={api}
          style={dockStyle(workbench, 'zoom', lastDockId)}
          resizer={workbench.resizerForDock('zoom')}
          onHide={() => workbench.toggleDock('zoom')}
          settings={streaming.streamServiceSettings}
          onChange={(next) => {
            if (!streaming.isActive()) streaming.setStreamServiceSettings((current) => ({ ...current, zoom: next.zoom }));
          }}
          status={streaming.outputStatuses.zoom ?? { state: 'stopped' }}
          selectionLocked={streaming.isActive()}
          onOperationStart={actions.beginProviderOperation}
          streamingStartedAt={streaming.outputStartedAt.zoom ?? null}
          now={clockNow}
          onGoLive={() => streaming.goLiveForService('zoom')}
          onStopStreaming={() => streaming.stopStreaming('zoom')}
        />}

        {visibleDockIds.includes('controls') && <ControlsDock
          ndiSending={ndi.sending}
          ndiStarting={ndi.starting}
          ndiStopping={ndi.stopping}
          onOpenNdiOutput={actions.openNdiOutput}
          style={dockStyle(workbench, 'controls', lastDockId)}
          resizer={workbench.resizerForDock('controls')}
          onHide={() => workbench.toggleDock('controls')}
          working={working}
          streamingStartDisabled={providerOperationCount > 0}
          streamOutputs={Object.entries(streaming.outputStatuses)
            .filter(([, status]) => status.state !== 'stopped')
            .map(([id, status]) => ({
              id,
              label: id === 'youtube' ? 'YouTube' : id === 'zoom' ? 'Zoom' : 'Output',
              status,
              duration: formatElapsed(streaming.outputStartedAt[id] === undefined ? 0 : clockNow - streaming.outputStartedAt[id], 'full'),
            }))}
          onGoLive={actions.startSelectedDestinations}
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
          recordingDuration={recordingDuration}
        />}
      </div>
    </div>
    {workbench.dockDrag && <div className="dock-drop-indicator" style={{ left: workbench.dockDrag.left, top: workbench.dockDrag.top, height: workbench.dockDrag.height }} />}
  </>;
}
