import { SourcesDock, type SourcesDockProps } from '../docks/sources-dock';
import { canReferenceScene } from '../../shared/scene-reference-graph';
import type { DesktopAudioCaptureMode, StreamPlatform } from '../../shared/platform-capabilities';
import type { StreamProject, StreamScene, StreamSource } from '../../shared/desktop-api';
import { DEFAULT_CHROMA_KEY, DEFAULT_SOURCE_CROP, DEFAULT_SOURCE_FILTERS } from '../shared/source-factory';
import { createDefaultTextStyle } from '../../shared/desktop-api';
import { getSourceRuntimeId, toRuntimeSource } from '../source-runtime';
import { projectRuntimeRecord } from '../runtime-projection';
import { mergeSourceStatuses, type SourceStatus } from '../source-availability';
import { dockGridColumn } from '../workbench-layout';
import type { UseCaptureResult } from '../features/capture';
import type { UseSourcesResult } from '../features/sources';
import type { useNdi } from './use-ndi';
import type { useWorkbenchLayout } from '../features/workbench';
import type { CSSProperties } from 'react';

type CaptureDockActions = Pick<UseCaptureResult,
  | 'inputDeviceOptions'
  | 'openCapturePicker'
  | 'addSystemAudioCapture'
  | 'openApplicationAudioPicker'
  | 'openInputDevicePicker'
  | 'switchInputDevice'
  | 'updateCameraAudioSettings'
  | 'toggleDesktopCaptureAudio'
  | 'updateCameraCaptureSettings'
>;

type NdiDockState = Pick<ReturnType<typeof useNdi>, 'retrySource' | 'sourceErrors'>;
type WorkbenchDockState = Pick<ReturnType<typeof useWorkbenchLayout>,
  'workbenchLayout' | 'visibleDockIds' | 'toggleDock' | 'resizerForDock' | 'dockDragOpacity'
>;

export interface SourcesDockRuntimeView {
  visibleEditorSources: readonly StreamSource[];
  visibleDraftSourceIds: ReadonlySet<string>;
  programSourceIds: ReadonlySet<string>;
  runtimes: ReadonlyMap<string, MediaStream>;
  mediaElements: ReadonlyMap<string, HTMLMediaElement>;
  meterLevels: Record<string, number>;
  mediaPlaybackStates: Record<string, { paused: boolean; ended: boolean }>;
  captureStatuses: Readonly<Record<string, SourceStatus>>;
  resourceStatuses: Readonly<Record<string, SourceStatus>>;
}

export interface SourcesDockContainerProps {
  project: StreamProject;
  activeScene: StreamScene;
  platform: StreamPlatform;
  desktopAudioMode: DesktopAudioCaptureMode;
  applicationAudioSupported: boolean;
  working: boolean;
  sourceFeature: UseSourcesResult;
  capture: CaptureDockActions;
  ndi: NdiDockState;
  runtime: SourcesDockRuntimeView;
  workbench: WorkbenchDockState;
  onOpenNdiInput: () => void;
  onOpenSourceProperties: (sourceId: string) => void;
}

export function createSourcesDockProps({
  project,
  activeScene,
  platform,
  desktopAudioMode,
  applicationAudioSupported,
  working,
  sourceFeature,
  capture,
  ndi,
  runtime,
  workbench,
  onOpenNdiInput,
  onOpenSourceProperties,
}: SourcesDockContainerProps): SourcesDockProps {
  const selectedSource = sourceFeature.selectedSource;
  const referenceableScenes = project.scenes.filter((scene) => canReferenceScene(project.scenes, activeScene.id, scene.id));
  const ndiStatuses = Object.fromEntries(Object.entries(ndi.sourceErrors).map(([id, message]) => [id, { state: 'unavailable' as const, message }]));
  const sourceStatuses = projectRuntimeRecord(runtime.visibleEditorSources,
    mergeSourceStatuses(runtime.visibleEditorSources, runtime.captureStatuses, { ...runtime.resourceStatuses, ...ndiStatuses }));
  const visibleDockIds = workbench.visibleDockIds;
  const lastDockId = visibleDockIds[visibleDockIds.length - 1];
  const selectedFilters = { ...DEFAULT_SOURCE_FILTERS, ...selectedSource?.filters };
  const selectedTextStyle = selectedSource?.kind === 'text' ? selectedSource.textStyle ?? createDefaultTextStyle() : null;
  const selectedCrop = { ...DEFAULT_SOURCE_CROP, ...selectedSource?.crop };
  const selectedChromaKey = { ...DEFAULT_CHROMA_KEY, ...selectedSource?.chromaKey };

  return {
    style: {
      gridColumn: dockGridColumn(workbench.workbenchLayout, 'sources') ?? undefined,
      opacity: workbench.dockDragOpacity('sources'),
      borderRight: lastDockId === 'sources' ? 0 : undefined,
    } satisfies CSSProperties,
    resizer: workbench.resizerForDock('sources'),
    onHide: () => workbench.toggleDock('sources'),
    sources: activeScene.sources,
    selectedSource,
    selectedSourceIds: sourceFeature.selectedSourceIds,
    collapsedGroupIds: sourceFeature.collapsedGroupIds,
    setCollapsedGroupIds: sourceFeature.setCollapsedGroupIds,
    meterLevels: runtime.meterLevels,
    sourceStatuses,
    onSelectSourceRow: sourceFeature.selectSourceRow,
    onSelectAllSources: sourceFeature.selectAllSources,
    onClearSourceSelection: sourceFeature.clearSourceSelection,
    onToggleSourceLock: sourceFeature.toggleSourceLock,
    onMoveSource: sourceFeature.moveSource,
    onUpdateSource: sourceFeature.updateSource,
    platform,
    onOpenSourceProperties,
    onOpenSourceFilters: sourceFeature.selectSource,
    onMoveSourceTo: sourceFeature.moveSourceTo,
    onReorderSources: sourceFeature.onReorderSources,
    sourceMenuTriggerRef: sourceFeature.sourceMenuTriggerRef,
    sourceMenuOpen: sourceFeature.sourceMenuOpen,
    setSourceMenuOpen: sourceFeature.setSourceMenuOpen,
    sourceActionsTriggerRef: sourceFeature.sourceActionsTriggerRef,
    sourceActionsMenuOpen: sourceFeature.sourceActionsMenuOpen,
    setSourceActionsMenuOpen: sourceFeature.setSourceActionsMenuOpen,
    sourceActions: {
      sourceClipboardAvailable: sourceFeature.sourceClipboardAvailable,
      working,
      canGroupSelectedSources: sourceFeature.canGroupSelectedSources,
      onCopySource: sourceFeature.copySelectedSource,
      onPasteSource: () => void sourceFeature.pasteSource(),
      onGroupSources: sourceFeature.groupSelectedSources,
      onUngroupSource: sourceFeature.ungroupSelectedSource,
      onFitSource: sourceFeature.fitSource,
      onCenterSource: sourceFeature.centerSource,
      onStretchSource: sourceFeature.stretchSource,
      onResetTransform: sourceFeature.resetSourceTransform,
      onRemoveSelectedSource: sourceFeature.removeSelectedSource,
    },
    addSourceMenu: {
      onAddNdi: () => { sourceFeature.setSourceMenuOpen(false); onOpenNdiInput(); },
      desktopAudioMode,
      applicationAudioSupported,
      onOpenCapturePicker: (kind, targetSourceId) => void capture.openCapturePicker(kind, targetSourceId),
      onAddSystemAudioCapture: (targetSourceId) => void capture.addSystemAudioCapture(targetSourceId),
      onOpenApplicationAudioPicker: (targetSourceId) => void capture.openApplicationAudioPicker(targetSourceId),
      onAddCamera: () => void capture.openInputDevicePicker('camera'),
      onAddMicrophone: () => void capture.openInputDevicePicker('microphone'),
      onAddMedia: (kind) => void sourceFeature.addMedia(kind),
      onAddSlideshow: () => void sourceFeature.addSlideshow(),
      onAddPresentation: () => void sourceFeature.addPresentation(),
      onOpenBrowserDialog: () => { sourceFeature.setSourceMenuOpen(false); sourceFeature.setBrowserDialogOpen(true); },
      onAddText: sourceFeature.addText,
      onAddColor: sourceFeature.addColor,
      referenceableScenes,
      onAddSceneReference: sourceFeature.addSceneReference,
    },
    properties: {
      onReconnectNdi: (source) => ndi.retrySource(getSourceRuntimeId(toRuntimeSource(source))),
      project,
      activeSceneId: activeScene.id,
      referenceableScenes,
      platform,
      working,
      desktopAudioMode,
      inputDeviceOptions: capture.inputDeviceOptions,
      runtimesSnapshot: runtime.runtimes,
      mediaElements: runtime.mediaElements,
      mediaPlaybackStates: runtime.mediaPlaybackStates,
      playbackInProgram: selectedSource !== null && runtime.visibleDraftSourceIds.has(selectedSource.id)
        && runtime.programSourceIds.has(getSourceRuntimeId(selectedSource)),
      textStyle: selectedTextStyle,
      filters: selectedFilters,
      crop: selectedCrop,
      chromaKey: selectedChromaKey,
      hasAudioMeter: selectedSource !== null && runtime.meterLevels[selectedSource.id] !== undefined,
      onRemove: sourceFeature.removeSelectedSource,
      onUpdateSource: sourceFeature.updateSource,
      onUpdateTextStyle: sourceFeature.updateTextStyle,
      onSwitchInputDevice: (source, deviceId) => void capture.switchInputDevice(source, deviceId),
      onUpdateCameraAudioSettings: (source, settings) => void capture.updateCameraAudioSettings(source, settings),
      onToggleDesktopCaptureAudio: (source, enabled) => void capture.toggleDesktopCaptureAudio(source, enabled),
      onUpdateCameraCaptureSettings: (source, settings) => void capture.updateCameraCaptureSettings(source, settings),
      onAddSystemAudioCapture: (targetSourceId) => void capture.addSystemAudioCapture(targetSourceId),
      onOpenApplicationAudioPicker: (targetSourceId) => void capture.openApplicationAudioPicker(targetSourceId),
      onOpenCapturePicker: (kind, targetSourceId) => void capture.openCapturePicker(kind, targetSourceId),
      onUpdateCaptureCursorMode: sourceFeature.updateCaptureCursorMode,
      onUpdateSourceTransform: sourceFeature.updateSourceTransform,
      onFitSource: sourceFeature.fitSource,
      onCenterSource: sourceFeature.centerSource,
      onResetTransform: sourceFeature.resetSourceTransform,
      onTogglePlayback: sourceFeature.toggleMediaPlayback,
      onRestartPlayback: sourceFeature.restartMediaPlayback,
      onStopPlayback: sourceFeature.stopMediaPlayback,
      onMoveSlideshowImage: sourceFeature.moveSlideshowImage,
      onRemoveSlideshowImage: sourceFeature.removeSlideshowImage,
      onAddSlideshowImage: (sourceId) => void sourceFeature.addSlideshowImage(sourceId),
      onUpdateBrowserAudio: sourceFeature.updateBrowserAudio,
      onUpdateSourceSettings: sourceFeature.updateSourceSettings,
      onUpdateSourceMonitoring: sourceFeature.updateSourceMonitoring,
      onUpdateSourceAudioTrack: sourceFeature.updateSourceAudioTrack,
      onUpdateSourceAudioFilters: sourceFeature.updateSourceAudioFilters,
      onUpdateSourceFilters: sourceFeature.updateSourceFilters,
      onUpdateSourceCrop: sourceFeature.updateSourceCrop,
      onUpdateSourceChromaKey: sourceFeature.updateSourceChromaKey,
    },
  };
}

export function SourcesDockContainer(props: SourcesDockContainerProps) {
  return <SourcesDock {...createSourcesDockProps(props)} />;
}
