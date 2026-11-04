import { useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from 'react';
import { resolveSelection, type SelectionModifiers } from '@lumacast/selection';
import { hitTestSource } from '../../canvas-composition';
import { runMediaPlaybackCommand, type MediaPlaybackCommand } from '../../media-playback';
import { canvasPointFromOutputPoint, fitCanvasToOutput } from '../../output-scaling';
import {
  canTransformSource, fitSourceToCanvas, resizeSourceFromPointer, snapResizePointerDelta, snapSourceTranslation,
  sourceBounds, sourceBoundsForSelection, sourceContainsPoint, sourceCropFromPointer, sourceResizeHandlePosition,
  type SourceBounds, type SourceSnapGuide, type SourceSnapTargets, type SourceSnapTolerance,
} from '../../source-transform';
import { duplicateSource } from '../../source-clipboard';
import { currentSourceSlideIndex, slideshowImageElementKey, sourceSlideImages } from '../../slideshow';
import { removeSourceVisibilityHotkeys } from '../../scene-hotkeys';
import {
  canGroupSourceSiblings, computeGroupBoundingTransform, findSourceSiblingSelection, flattenSourceLeaves,
  flattenSourceNodes, groupSourceSiblings, mapSourceTreeById, moveSourceTreeNode, removeSourceTreeById,
  reorderSourceTreeSiblings, ungroupSourceNode,
} from '../../../shared/source-tree';
import { canReferenceScene } from '../../../shared/scene-reference-graph';
import { normalizeSourceRotation } from '../../../shared/source-geometry';
import { AUDIO_TRACKS, type AudioFilters, type AudioMonitoring, type AudioTrack, type ChromaKeyFilter, type MediaKind, type SourceCrop, type SourceFilters, type StreamProject, type StreamScene, type StreamSource, type StreamTextStyle, createDefaultTextStyle } from '../../../shared/desktop-api';
import type { StreamAPI } from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';
import { getOriginSourceId, toRuntimeSource } from '../../source-runtime';
import { createSource, DEFAULT_AUDIO_FILTERS, DEFAULT_CHROMA_KEY, DEFAULT_SOURCE_CROP, DEFAULT_SOURCE_FILTERS, defaultTransform } from './helpers';
import { canResizeSourceTree, isSourceTransformableInTree, selectedSourceRoots, sourceCanvasSelectionOrder, sourceRowOrder, translateSourceSelection } from '../../source-selection';

export type SourceSelectionEvent = Pick<SelectionModifiers, 'shiftKey' | 'metaKey' | 'ctrlKey'> & { type?: string };

const SNAP_TOLERANCE_CSS_PX = 6;

interface SourceCanvasDrag {
  pointerId: number;
  sourceId: string;
  sourceIds: string[];
  movableSourceIds: string[];
  sceneId: string;
  startX: number;
  startY: number;
  appliedMoveX: number;
  appliedMoveY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
  originRotation: number;
  originCrop: SourceCrop;
  cropSize: { width: number; height: number } | null;
  originBounds: SourceBounds | null;
  snapExcludedSourceIds: string[];
  originIsGroup: boolean;
  resizeHandle: string | null;
  aspectLocked: boolean;
  cropMode: boolean;
}

function sourceIdsAffectedBySelection(sources: readonly StreamSource[], selectedIds: readonly string[]): Set<string> {
  const rootIds = new Set(selectedSourceRoots(sources, selectedIds).map((source) => source.id));
  const affected = new Set<string>();
  const visit = (nodes: readonly StreamSource[], selectedAncestor: boolean): boolean => {
    let containsSelection = false;
    for (const source of nodes) {
      const selected = rootIds.has(source.id);
      const childContainsSelection = source.kind === 'group'
        ? visit(source.children ?? [], selectedAncestor || selected)
        : false;
      const isAffected = selectedAncestor || selected || childContainsSelection;
      if (isAffected) affected.add(source.id);
      containsSelection ||= selected || childContainsSelection;
    }
    return containsSelection;
  };
  visit(sources, false);
  return affected;
}

function selectedMovableTransforms(
  sources: readonly StreamSource[],
  selectedIds: readonly string[],
  movableIds: readonly string[],
): StreamSource['transform'][] {
  const roots = selectedSourceRoots(sources, selectedIds);
  const movable = new Set(movableIds);
  const transforms: StreamSource['transform'][] = [];
  const visit = (source: StreamSource) => {
    if (source.kind === 'group') {
      for (const child of source.children ?? []) visit(child);
    } else if (movable.has(source.id)) transforms.push(source.transform);
  };
  roots.forEach(visit);
  return transforms;
}

function snapTargetsForScene(scene: StreamScene, excludedIds: ReadonlySet<string>, canvas: { width: number; height: number }): SourceSnapTargets {
  const byId = new Map(flattenSourceNodes(scene.sources).map((source) => [source.id, source] as const));
  const x = [0, canvas.width / 2, canvas.width];
  const y = [0, canvas.height / 2, canvas.height];
  for (const sourceId of sourceCanvasSelectionOrder(scene.sources)) {
    if (excludedIds.has(sourceId)) continue;
    const source = byId.get(sourceId);
    if (!source) continue;
    const bounds = sourceBounds(source.transform);
    x.push(bounds.left, (bounds.left + bounds.right) / 2, bounds.right);
    y.push(bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom);
  }
  return {
    x: [...new Set(x)].sort((left, right) => left - right),
    y: [...new Set(y)].sort((top, bottom) => top - bottom),
  };
}

function cropDimensionsForSource(
  source: StreamSource,
  videoElements: Map<string, HTMLVideoElement>,
  imageElements: Map<string, HTMLImageElement>,
): { width: number; height: number } | null {
  let width = 0;
  let height = 0;
  if (source.kind === 'image' || source.kind === 'browser') {
    const image = imageElements.get(source.id);
    width = image?.naturalWidth ?? 0;
    height = image?.naturalHeight ?? 0;
  } else if (source.kind === 'slideshow' || source.kind === 'presentation') {
    const slides = sourceSlideImages(source);
    const index = currentSourceSlideIndex(source);
    const image = imageElements.get(slideshowImageElementKey(source.id, slides, index));
    width = image?.naturalWidth ?? 0;
    height = image?.naturalHeight ?? 0;
  } else if (source.kind === 'display' || source.kind === 'window' || source.kind === 'camera' || source.kind === 'ndi'
    || (source.kind === 'media' && source.mediaKind === 'video')) {
    const video = videoElements.get(source.id);
    width = video?.videoWidth ?? 0;
    height = video?.videoHeight ?? 0;
  }
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

function sameSnapGuides(left: readonly SourceSnapGuide[], right: readonly SourceSnapGuide[]): boolean {
  return left.length === right.length && left.every((guide, index) => guide.axis === right[index]?.axis
    && guide.position === right[index]?.position);
}

export interface UseSourcesParams {
  api: StreamAPI;
  project: StreamProject | null;
  projectRef: RefObject<StreamProject | null>;
  allSources: StreamSource[];
  activeScene: StreamScene | null;
  liveScene: StreamScene | null;
  /** Runtime IDs visible in the committed Program snapshot. */
  programSourceIds?: ReadonlySet<string>;
  setProjectValue: (update: (current: StreamProject) => StreamProject) => void;
  setActionError: (message: string) => void;
  working: boolean;
  setWorking: Dispatch<SetStateAction<boolean>>;

  // DOM element maps rendered by App.tsx (RuntimeVideoBank / CanvasComposition).
  videoElements: RefObject<Map<string, HTMLVideoElement>>;
  imageElements: RefObject<Map<string, HTMLImageElement>>;
  mediaElements: RefObject<Map<string, HTMLMediaElement>>;

  // Capture primitives this feature needs to keep a source's live runtime in sync with edits.
  runtimes: RefObject<Map<string, MediaStream>>;
  mixer: RefObject<{ setSettings(id: string, settings: { volume: number; muted: boolean }): void; setProgramActive(id: string, active: boolean): void; setAudioMonitoring(id: string, monitoring: AudioMonitoring): void; setAudioTracks(id: string, tracks: AudioTrack[]): void; setAudioFilters(id: string, filters: AudioFilters | undefined): boolean | void; setNoiseSuppression(id: string, enabled: boolean): Promise<boolean> | void } | null>;
  /** Only checked for key membership here (`.has(id)`) — the value type is capture's concern. */
  applicationAudioInputs: RefObject<Map<string, unknown>>;
  applicationAudioSessions: RefObject<Map<string, { pid: number; path: string }>>;
  attachRuntime: (source: StreamSource, stream: MediaStream, programActiveOverride?: boolean) => Promise<void>;
  stopRuntime: (sourceId: string) => void;
  startApplicationAudioRuntime: (source: StreamSource, application: { pid: number; path: string; name: string }) => Promise<void>;
  startSystemAudioRuntime: (source: StreamSource) => Promise<void>;
  clearNoiseSuppressionPreference: (sourceId: string) => void;
}

export interface UseSourcesResult {
  selectedSourceId: string | null;
  selectedSourceIds: string[];
  selectedSource: StreamSource | null;
  snapGuides: SourceSnapGuide[];
  selectSource: (sourceId: string | null) => void;
  selectSourceRow: (event: SourceSelectionEvent, sourceId: string) => void;
  selectAllSources: () => void;
  clearSourceSelection: () => void;
  collapsedGroupIds: string[];
  setCollapsedGroupIds: Dispatch<SetStateAction<string[]>>;
  canGroupSelectedSources: boolean;

  sourceMenuOpen: boolean;
  setSourceMenuOpen: Dispatch<SetStateAction<boolean>>;
  sourceActionsMenuOpen: boolean;
  setSourceActionsMenuOpen: Dispatch<SetStateAction<boolean>>;
  sourceMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  sourceActionsTriggerRef: RefObject<HTMLButtonElement | null>;
  sourceClipboardAvailable: boolean;

  browserDialogOpen: boolean;
  setBrowserDialogOpen: Dispatch<SetStateAction<boolean>>;
  browserUrl: string;
  setBrowserUrl: Dispatch<SetStateAction<string>>;
  addBrowserSource: () => void;

  addToActiveScene: (source: StreamSource) => StreamSource;
  addSceneReference: (referencedScene: StreamScene) => void;
  addText: () => void;
  addColor: () => void;
  addMedia: (kind: MediaKind) => Promise<void>;
  addSlideshow: () => Promise<void>;
  addPresentation: () => Promise<void>;
  addSlideshowImage: (sourceId: string) => Promise<void>;
  moveSlideshowImage: (sourceId: string, index: number, direction: -1 | 1) => void;
  removeSlideshowImage: (sourceId: string, index: number) => void;

  updateSource: (sourceId: string, update: (source: StreamSource) => StreamSource) => void;
  updateTextStyle: (sourceId: string, update: (style: StreamTextStyle) => StreamTextStyle) => void;
  toggleSourceLock: (sourceId: string) => void;
  updateSourceTransform: (sourceId: string, key: keyof StreamSource['transform'], rawValue: string) => void;
  fitSource: (source: StreamSource) => void;
  centerSource: (source: StreamSource) => void;
  resetSourceTransform: (source: StreamSource) => void;
  stretchSource: (source: StreamSource) => void;
  updateCaptureCursorMode: (sourceId: string, cursorMode: StreamSource['cursorMode']) => Promise<void>;
  updateSourceSettings: (sourceId: string, settings: Pick<StreamSource, 'volume' | 'muted'>) => void;
  updateSourceMonitoring: (sourceId: string, audioMonitoring: AudioMonitoring) => void;
  updateSourceAudioTrack: (sourceId: string, track: AudioTrack, enabled: boolean) => void;
  updateSourceAudio: (sourceId: string, patch: Partial<Pick<StreamSource, 'volume' | 'muted' | 'balance' | 'audioMonitoring' | 'audioTracks'>>) => void;
  updateBrowserAudio: (sourceId: string, enabled: boolean) => void;
  updateSourceFilters: (sourceId: string, filters: Partial<SourceFilters>) => void;
  updateSourceChromaKey: (sourceId: string, chromaKey: Partial<ChromaKeyFilter>) => void;
  updateSourceCrop: (sourceId: string, crop: Partial<SourceCrop>) => void;
  updateSourceAudioFilters: (sourceId: string, filters: Partial<AudioFilters>) => void;

  toggleMediaPlayback: (sourceId: string) => void;
  restartMediaPlayback: (sourceId: string) => void;
  stopMediaPlayback: (sourceId: string) => void;

  removeSelectedSource: () => void;
  nudgeSelectedSources: (dx: number, dy: number) => void;
  copySelectedSource: (sourceId?: string) => void;
  pasteSource: () => Promise<void>;
  moveSource: (sourceId: string, direction: -1 | 1) => void;
  moveSourceTo: (sourceId: string, position: 'top' | 'bottom') => void;
  onReorderSources: (parentId: string | null, orderedIds: string[]) => void;
  groupSelectedSources: () => void;
  ungroupSelectedSource: (sourceId?: string) => void;

  handleStagePointerDown: (event: ReactPointerEvent<HTMLDivElement>, scene: StreamScene) => void;
  handleStagePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleStagePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;

  /** Resets selection, dialogs and the clipboard — called when the active scene collection changes. */
  resetForWorkspaceChange: () => void;
}

/**
 * Source selection, creation, editing (transform/filters/audio/crop/chroma
 * key), grouping, clipboard, reordering and the monitor-stage pointer
 * interactions that drive drag/resize. Mirrors the former inline App.tsx
 * implementation exactly.
 */
export function useSources(params: UseSourcesParams): UseSourcesResult {
  const {
    api, project, projectRef, allSources, activeScene, setProjectValue, setActionError, working, setWorking,
    videoElements, imageElements, mediaElements,
    runtimes, applicationAudioInputs, applicationAudioSessions, attachRuntime, stopRuntime,
    startApplicationAudioRuntime, startSystemAudioRuntime,
  } = params;

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [snapGuides, setSnapGuides] = useState<SourceSnapGuide[]>([]);
  const selectionAnchorId = useRef<string | null>(null);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceActionsMenuOpen, setSourceActionsMenuOpen] = useState(false);
  const [sourceClipboardAvailable, setSourceClipboardAvailable] = useState(false);
  const [browserDialogOpen, setBrowserDialogOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const sourceMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const sourceActionsTriggerRef = useRef<HTMLButtonElement>(null);
  const sourceClipboardRef = useRef<StreamSource | null>(null);
  const dragging = useRef<SourceCanvasDrag | null>(null);

  const publishSnapGuides = (guides: SourceSnapGuide[]) => {
    setSnapGuides((current) => sameSnapGuides(current, guides) ? current : guides);
  };

  const commitSelection = (ids: string[], primaryId: string | null, anchorId: string | null) => {
    setSelectedSourceIds(ids);
    setSelectedSourceId(primaryId && ids.includes(primaryId) ? primaryId : ids.at(-1) ?? null);
    selectionAnchorId.current = anchorId;
    publishSnapGuides([]);
  };

  const selectSource = (sourceId: string | null) => {
    commitSelection(sourceId ? [sourceId] : [], sourceId, sourceId);
  };

  const selectSourceRow = (event: SourceSelectionEvent, sourceId: string) => {
    if (!activeScene) return;
    const visibleIds = sourceRowOrder(activeScene.sources, collapsedGroupIds);
    const selectableIds = sourceRowOrder(activeScene.sources);
    const next = resolveSelection(visibleIds, selectedSourceIds, selectionAnchorId.current, sourceId,
      event.type === 'contextmenu' ? {} : event, selectableIds);
    commitSelection(next.selectedIds, next.selectedIds.includes(sourceId) ? sourceId : null, next.anchorId);
  };

  const selectAllSources = () => {
    if (!activeScene) return;
    const visibleIds = sourceRowOrder(activeScene.sources, collapsedGroupIds);
    const visible = new Set(visibleIds);
    const selectableIds = new Set(sourceRowOrder(activeScene.sources));
    const hiddenSelected = selectedSourceIds.filter((id) => !visible.has(id) && selectableIds.has(id));
    const next = [...visibleIds, ...hiddenSelected];
    commitSelection(next, visibleIds.at(-1) ?? hiddenSelected.at(-1) ?? null, visibleIds[0] ?? null);
  };

  const clearSourceSelection = () => selectSource(null);

  const selectedSource = activeScene ? flattenSourceNodes(activeScene.sources).find((source) => source.id === selectedSourceId) ?? null : null;
  const canGroupSelectedSources = activeScene ? canGroupSourceSiblings(activeScene.sources, selectedSourceIds) : false;

  const isCurrentSourceProgram = (sourceId: string) => {
    const source = projectRef.current?.scenes
      .flatMap((scene) => flattenSourceNodes(scene.sources))
      .find((candidate) => getOriginSourceId(candidate) === sourceId);
    return source ? params.programSourceIds?.has(toRuntimeSource(source).id) === true : false;
  };

  const addToActiveScene = (source: StreamSource) => {
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === current.activeSceneId ? { ...scene, sources: [...scene.sources, source] } : scene),
    }));
    selectSource(source.id);
    setSourceMenuOpen(false);
    setActionError('');
    return source;
  };

  const addSceneReference = (referencedScene: StreamScene) => {
    if (!activeScene || !project || !canReferenceScene(project.scenes, activeScene.id, referencedScene.id)) return;
    addToActiveScene(createSource('scene', project.output, referencedScene.name, { referencedSceneId: referencedScene.id }));
  };

  const addText = () => {
    if (!project) return;
    addToActiveScene(createSource('text', project.output));
  };

  const addColor = () => {
    if (!project) return;
    addToActiveScene(createSource('color', project.output));
  };

  const addBrowserSource = () => {
    if (!project) return;
    let url: URL;
    try { url = new URL(browserUrl.trim()); } catch { setActionError('Enter a valid browser source URL.'); return; }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
      setActionError('Browser sources support HTTP and HTTPS URLs.');
      return;
    }
    addToActiveScene(createSource('browser', project.output, url.hostname, { url: url.toString() }));
    setBrowserDialogOpen(false);
    setBrowserUrl('');
  };

  const addMedia = async (kind: MediaKind) => {
    if (!project || working) return;
    setWorking(true);
    setSourceMenuOpen(false);
    setActionError('');
    try {
      const asset = await api.importMedia(kind);
      if (!asset) return;
      const sourceKind = asset.kind === 'image' ? 'image' : 'media';
      const source = createSource(sourceKind, project.output, asset.name.slice(0, 120), {
        assetId: asset.id,
        assetExtension: asset.extension,
        mediaKind: asset.kind,
        ...(asset.kind !== 'image' ? {
          loop: false,
          restartPlaybackWhenActive: false,
          showNothingWhenPlaybackEnds: true,
        } : {}),
        ...(asset.kind === 'audio' ? { transform: defaultTransform('media', project.output, 'audio') } : {}),
      });
      addToActiveScene(source);
    } catch (error) {
      setActionError(`Could not import ${kind}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const addSlideshow = async () => {
    if (!project || working) return;
    setWorking(true);
    setSourceMenuOpen(false);
    setActionError('');
    try {
      const assets = await api.importSlideshowImages(100);
      if (assets.length === 0) return;
      addToActiveScene(createSource('slideshow', project.output, 'Image Slideshow', {
        slideshowImages: assets.map((asset) => ({ assetId: asset.id, assetExtension: asset.extension, name: asset.name.slice(0, 120) })),
        slideshowIntervalSeconds: 5,
        slideshowLoop: true,
        slideshowAutoAdvance: false,
      }));
    } catch (error) {
      setActionError(`Could not import slideshow images: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const addPresentation = async () => {
    if (!project || working) return;
    setWorking(true);
    setSourceMenuOpen(false);
    setActionError('');
    try {
      const presentation = await api.importPresentation();
      if (!presentation) return;
      addToActiveScene(createSource('presentation', project.output, presentation.name.slice(0, 120), {
        presentationSlides: presentation.slides,
        slideIndex: 0,
      }));
    } catch (error) {
      setActionError(`Could not import presentation: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const updateSource = (sourceId: string, update: (source: StreamSource) => StreamSource) => {
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => ({ ...scene, sources: mapSourceTreeById(scene.sources, sourceId, update) })),
    }));
  };

  const addSlideshowImage = async (sourceId: string) => {
    if (working) return;
    const source = allSources.find((item) => item.id === sourceId);
    if (source?.kind !== 'slideshow') return;
    const remaining = 100 - (source.slideshowImages?.length ?? 0);
    if (remaining < 1) return;
    setWorking(true);
    setActionError('');
    try {
      const assets = await api.importSlideshowImages(remaining);
      if (assets.length === 0) return;
      updateSource(sourceId, (source) => source.kind === 'slideshow' && (source.slideshowImages?.length ?? 0) < 100
        ? { ...source, slideshowImages: [...(source.slideshowImages ?? []), ...assets.map((asset) => ({ assetId: asset.id, assetExtension: asset.extension, name: asset.name.slice(0, 120) }))] }
        : source);
    } catch (error) {
      setActionError(`Could not import slideshow images: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const moveSlideshowImage = (sourceId: string, index: number, direction: -1 | 1) => updateSource(sourceId, (source) => {
    if (source.kind !== 'slideshow' || !source.slideshowImages) return source;
    const target = index + direction;
    if (target < 0 || target >= source.slideshowImages.length) return source;
    const slideshowImages = [...source.slideshowImages];
    const currentIndex = currentSourceSlideIndex(source);
    [slideshowImages[index], slideshowImages[target]] = [slideshowImages[target]!, slideshowImages[index]!];
    const slideIndex = currentIndex === index ? target : currentIndex === target ? index : currentIndex;
    return { ...source, slideshowImages, slideIndex };
  });

  const removeSlideshowImage = (sourceId: string, index: number) => updateSource(sourceId, (source) => {
    if (source.kind !== 'slideshow' || !source.slideshowImages || source.slideshowImages.length <= 1) return source;
    const currentIndex = currentSourceSlideIndex(source);
    const slideshowImages = source.slideshowImages.filter((_, itemIndex) => itemIndex !== index);
    return { ...source, slideshowImages, slideIndex: Math.min(slideshowImages.length - 1, currentIndex - (index < currentIndex ? 1 : 0)) };
  });

  const updateTextStyle = (sourceId: string, update: (style: StreamTextStyle) => StreamTextStyle) => updateSource(sourceId, (source) => source.kind === 'text'
    ? { ...source, textStyle: update(source.textStyle ?? createDefaultTextStyle()) }
    : source);

  const toggleSourceLock = (sourceId: string) => {
    updateSource(sourceId, (source) => ({ ...source, locked: !source.locked }));
  };

  const updateSourceTransform = (sourceId: string, key: keyof StreamSource['transform'], rawValue: string) => {
    const entered = Number(rawValue);
    if (!Number.isFinite(entered) || rawValue.trim() === '') return;
    const value = key === 'rotation'
      ? normalizeSourceRotation(entered)
      : key === 'x' || key === 'y'
        ? Math.max(-32768, Math.min(32768, Math.round(entered)))
        : Math.max(1, Math.min(32768, Math.round(entered)));
    updateSource(sourceId, (source) => ({ ...source, transform: { ...source.transform, [key]: value } }));
  };

  const fitSource = (source: StreamSource) => {
    if (!project) return;
    const video = videoElements.current.get(source.id);
    const slideshowImages = sourceSlideImages(source);
    const slideshowIndex = currentSourceSlideIndex(source);
    const imageKey = source.kind === 'slideshow' || source.kind === 'presentation'
      ? slideshowImageElementKey(source.id, slideshowImages, slideshowIndex)
      : source.id;
    const image = imageElements.current.get(imageKey);
    const sourceSize = {
      width: video?.videoWidth || image?.naturalWidth || source.transform.width,
      height: video?.videoHeight || image?.naturalHeight || source.transform.height,
    };
    const transform = fitSourceToCanvas(sourceSize, { width: project.output.baseWidth, height: project.output.baseHeight });
    updateSource(source.id, (current) => ({ ...current, transform: { ...transform, rotation: current.transform.rotation ?? 0 } }));
  };

  const centerSource = (source: StreamSource) => {
    if (!project) return;
    updateSource(source.id, (current) => ({
      ...current,
      transform: {
        ...current.transform,
        x: Math.round((project.output.baseWidth - current.transform.width) / 2),
        y: Math.round((project.output.baseHeight - current.transform.height) / 2),
      },
    }));
  };

  const resetSourceTransform = (source: StreamSource) => {
    if (!project) return;
    updateSource(source.id, (current) => ({ ...current, transform: defaultTransform(current.kind, project.output, current.mediaKind) }));
  };

  const stretchSource = (source: StreamSource) => {
    if (!project) return;
    updateSource(source.id, (current) => ({ ...current, transform: { ...current.transform, x: 0, y: 0, width: project.output.baseWidth, height: project.output.baseHeight } }));
  };

  const updateCaptureCursorMode = async (sourceId: string, cursorMode: StreamSource['cursorMode']) => {
    setActionError('');
    const track = runtimes.current.get(sourceId)?.getVideoTracks()[0];
    if (track?.readyState === 'live') {
      try {
        await track.applyConstraints({ cursor: cursorMode } as MediaTrackConstraints);
      } catch (error) {
        setActionError(`Cursor capture could not be changed: ${friendlyError(error)}`);
        return;
      }
    }
    updateSource(sourceId, (source) => ({ ...source, cursorMode }));
  };

  const updateSourceSettings = (sourceId: string, settings: Pick<StreamSource, 'volume' | 'muted'>) => {
    updateSource(sourceId, (source) => ({ ...source, ...settings }));
  };

  const updateSourceMonitoring = (sourceId: string, audioMonitoring: AudioMonitoring) => {
    updateSource(sourceId, (source) => ({ ...source, audioMonitoring }));
  };

  const updateSourceAudioTrack = (sourceId: string, track: AudioTrack, enabled: boolean) => {
    const source = allSources.find((item) => item.id === sourceId);
    if (!source) return;
    const tracks = new Set<AudioTrack>(source.audioTracks ?? [1]);
    if (enabled) tracks.add(track); else tracks.delete(track);
    const next: AudioTrack[] = [...tracks].sort((left, right) => left - right);
    updateSource(sourceId, (current) => ({ ...current, audioTracks: next }));
  };

  const updateSourceAudio = (sourceId: string, patch: Partial<Pick<StreamSource, 'volume' | 'muted' | 'balance' | 'audioMonitoring' | 'audioTracks'>>) => {
    const source = allSources.find((item) => item.id === sourceId);
    if (!source) return;
    if (patch.volume !== undefined || patch.muted !== undefined) {
      updateSourceSettings(sourceId, { volume: patch.volume ?? source.volume, muted: patch.muted ?? source.muted });
    }
    if (patch.audioMonitoring !== undefined) updateSourceMonitoring(sourceId, patch.audioMonitoring);
    if (patch.audioTracks !== undefined) {
      const current = new Set(source.audioTracks ?? [1]);
      const next = new Set(patch.audioTracks);
      for (const track of AUDIO_TRACKS) {
        if (current.has(track) !== next.has(track)) updateSourceAudioTrack(sourceId, track, next.has(track));
      }
    }
    if (patch.balance !== undefined) {
      const balance = patch.balance;
      updateSource(sourceId, (current) => ({ ...current, balance }));
    }
  };

  const updateBrowserAudio = (sourceId: string, enabled: boolean) => {
    setActionError('');
    updateSource(sourceId, (source) => ({ ...source, browserAudioEnabled: enabled }));
  };

  const updateSourceFilters = (sourceId: string, filters: Partial<SourceFilters>) => {
    updateSource(sourceId, (source) => ({ ...source, filters: { ...DEFAULT_SOURCE_FILTERS, ...source.filters, ...filters } }));
  };

  const updateSourceChromaKey = (sourceId: string, chromaKey: Partial<ChromaKeyFilter>) => {
    updateSource(sourceId, (source) => ({ ...source, chromaKey: { ...DEFAULT_CHROMA_KEY, ...source.chromaKey, ...chromaKey } }));
  };

  const updateSourceCrop = (sourceId: string, crop: Partial<SourceCrop>) => {
    updateSource(sourceId, (source) => ({ ...source, crop: { ...DEFAULT_SOURCE_CROP, ...source.crop, ...crop } }));
  };

  const updateSourceAudioFilters = (sourceId: string, filters: Partial<AudioFilters>) => {
    const source = allSources.find((item) => item.id === sourceId);
    const nextFilters = { ...DEFAULT_AUDIO_FILTERS, ...source?.audioFilters, ...filters };
    if ('noiseGateOpenThresholdDb' in filters && nextFilters.noiseGateCloseThresholdDb > nextFilters.noiseGateOpenThresholdDb) {
      nextFilters.noiseGateCloseThresholdDb = nextFilters.noiseGateOpenThresholdDb;
    }
    if ('noiseGateCloseThresholdDb' in filters && nextFilters.noiseGateCloseThresholdDb > nextFilters.noiseGateOpenThresholdDb) {
      nextFilters.noiseGateOpenThresholdDb = nextFilters.noiseGateCloseThresholdDb;
    }
    updateSource(sourceId, (current) => ({ ...current, audioFilters: nextFilters }));
  };

  const controlMediaPlayback = (sourceId: string, command: MediaPlaybackCommand) => {
    const element = mediaElements.current.get(sourceId);
    if (!element) return;
    if (command !== 'stop' && !isCurrentSourceProgram(sourceId)) { element.pause(); return; }
    void runMediaPlaybackCommand(element, command, setActionError);
  };

  const toggleMediaPlayback = (sourceId: string) => controlMediaPlayback(sourceId, 'toggle');
  const restartMediaPlayback = (sourceId: string) => controlMediaPlayback(sourceId, 'restart');
  const stopMediaPlayback = (sourceId: string) => controlMediaPlayback(sourceId, 'stop');

  const removeSelectedSource = () => {
    if (selectedSourceIds.length === 0 || !activeScene) return;
    const roots = selectedSourceRoots(activeScene.sources, selectedSourceIds);
    if (roots.length === 0) return;
    const removedIds = roots.flatMap((source) => flattenSourceNodes([source]).map((node) => node.id));
    for (const source of roots.flatMap((root) => flattenSourceLeaves([root]))) stopRuntime(source.id);
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === activeScene.id ? {
        ...scene,
        sources: roots.reduce((sources, source) => removeSourceTreeById(sources, source.id), scene.sources),
      } : scene),
      sourceVisibilityHotkeys: removeSourceVisibilityHotkeys(current.sourceVisibilityHotkeys, removedIds),
    }));
    selectSource(null);
  };

  const nudgeSelectedSources = (dx: number, dy: number) => {
    if (!activeScene || selectedSourceIds.length === 0 || (dx === 0 && dy === 0)) return;
    setProjectValue((current) => {
      let changed = false;
      const scenes = current.scenes.map((scene) => {
        if (scene.id !== activeScene.id) return scene;
        const sources = translateSourceSelection(scene.sources, selectedSourceIds, dx, dy);
        if (sources.every((source, index) => source === scene.sources[index])) return scene;
        changed = true;
        return { ...scene, sources };
      });
      return changed ? { ...current, scenes } : current;
    });
  };

  const copySelectedSource = (sourceId?: string) => {
    const source = sourceId
      ? flattenSourceNodes(activeScene?.sources ?? []).find((item) => item.id === sourceId) ?? null
      : selectedSource;
    if (!source) return;
    sourceClipboardRef.current = structuredClone(source);
    setSourceClipboardAvailable(true);
    setSourceActionsMenuOpen(false);
  };

  const pasteSource = async () => {
    if (!activeScene || !project || !sourceClipboardRef.current) return;
    const source = duplicateSource(sourceClipboardRef.current);
    setSourceActionsMenuOpen(false);
    try {
      const originalLeaves = flattenSourceLeaves([sourceClipboardRef.current]);
      const duplicatedLeaves = flattenSourceLeaves([source]);
      for (let index = 0; index < originalLeaves.length; index += 1) {
        const original = originalLeaves[index]!;
        const duplicate = duplicatedLeaves[index]!;
        const runtime = runtimes.current.get(original.id);
        if (!runtime || duplicate.kind === 'browser') continue;
        if (duplicate.kind === 'application-audio') {
          const session = applicationAudioSessions.current.get(original.id);
          if (!session) throw new Error('The application-audio capture is no longer active.');
          await startApplicationAudioRuntime(duplicate, { ...session, name: duplicate.name });
        } else if (duplicate.kind === 'desktop-audio' && applicationAudioInputs.current.has(original.id)) {
          await startSystemAudioRuntime(duplicate);
        } else await attachRuntime(duplicate, runtime.clone());
      }
    } catch (error) {
      for (const duplicate of flattenSourceLeaves([source])) stopRuntime(duplicate.id);
      setActionError(`Could not duplicate source: ${friendlyError(error)}`);
      return;
    }
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === current.activeSceneId ? { ...scene, sources: [...scene.sources, source] } : scene),
    }));
    selectSource(source.id);
  };

  const moveSource = (sourceId: string, direction: -1 | 1) => {
    if (!activeScene) return;
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === activeScene.id
        ? { ...scene, sources: moveSourceTreeNode(scene.sources, sourceId, direction) }
        : scene),
    }));
  };

  // Moves a source to the top/bottom of its sibling stack in one tree update:
  // `moveSourceTreeNode` only steps one position, so this applies it repeatedly
  // (bounded by the scene's node count) until the id-order stops changing.
  const moveSourceTo = (sourceId: string, position: 'top' | 'bottom') => {
    if (!activeScene) return;
    const direction: -1 | 1 = position === 'top' ? 1 : -1;
    const maxSteps = flattenSourceNodes(activeScene.sources).length;
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => {
        if (scene.id !== activeScene.id) return scene;
        let sources = scene.sources;
        let signature = flattenSourceNodes(sources).map((node) => node.id).join('|');
        for (let step = 0; step < maxSteps; step += 1) {
          const next = moveSourceTreeNode(sources, sourceId, direction);
          const nextSignature = flattenSourceNodes(next).map((node) => node.id).join('|');
          if (nextSignature === signature) break;
          sources = next;
          signature = nextSignature;
        }
        return { ...scene, sources };
      }),
    }));
  };

  /** Persists a pointer-drag reorder from the Sources dock: rewrites the complete sibling order under `parentId` (null = scene root). */
  const onReorderSources = (parentId: string | null, orderedIds: string[]) => {
    if (!activeScene) return;
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === activeScene.id
        ? { ...scene, sources: reorderSourceTreeSiblings(scene.sources, parentId, orderedIds) }
        : scene),
    }));
  };

  const groupSelectedSources = () => {
    if (!canGroupSelectedSources || !activeScene || !project) return;
    const selectedSources = findSourceSiblingSelection(activeScene.sources, selectedSourceIds)?.sources ?? [];
    if (selectedSources.length < 2) return;
    const bounds = computeGroupBoundingTransform(selectedSources) ?? { x: 0, y: 0, width: 1, height: 1 };
    const existingGroupNames = new Set(flattenSourceNodes(activeScene.sources).map((source) => source.name));
    let groupName = 'Group';
    let suffix = 2;
    while (existingGroupNames.has(groupName)) groupName = `Group ${suffix++}`;
    const group = createSource('group', project.output, groupName, { children: selectedSources, transform: bounds });
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => {
        if (scene.id !== current.activeSceneId) return scene;
        const sources = groupSourceSiblings(scene.sources, selectedSourceIds, group);
        return sources ? { ...scene, sources } : scene;
      }),
    }));
    selectSource(group.id);
    setSourceActionsMenuOpen(false);
  };

  const ungroupSelectedSource = (sourceId?: string) => {
    const source = sourceId
      ? flattenSourceNodes(activeScene?.sources ?? []).find((item) => item.id === sourceId) ?? null
      : selectedSource;
    if (!source || source.kind !== 'group' || !activeScene) return;
    const children = source.children ?? [];
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => {
        if (scene.id !== current.activeSceneId) return scene;
        const sources = ungroupSourceNode(scene.sources, source.id);
        return sources ? { ...scene, sources } : scene;
      }),
      sourceVisibilityHotkeys: removeSourceVisibilityHotkeys(current.sourceVisibilityHotkeys, [source.id]),
    }));
    commitSelection(children.map((source) => source.id), children.at(-1)?.id ?? null, children[0]?.id ?? null);
    setSourceActionsMenuOpen(false);
  };

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>, scene: StreamScene) => {
    if (event.button !== 0) return;
    publishSnapGuides([]);
    const rect = event.currentTarget.getBoundingClientRect();
    const output = { width: project?.output.width ?? 1920, height: project?.output.height ?? 1080 };
    const canvas = { width: project?.output.baseWidth ?? 1920, height: project?.output.baseHeight ?? 1080 };
    const point = canvasPointFromOutputPoint({
      x: ((event.clientX - rect.left) / rect.width) * output.width,
      y: ((event.clientY - rect.top) / rect.height) * output.height,
    }, canvas, output);
    const { x, y } = point;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const resizeHandle = target?.closest('[data-resize-handle]')?.getAttribute('data-resize-handle') ?? null;
    const flatSources = flattenSourceNodes(scene.sources);
    const selected = selectedSourceId ? flatSources.find((source) => source.id === selectedSourceId) ?? null : null;
    const withinCanvas = x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height;
    const selectedIsGroupedChild = selected && flatSources.some((source) => source.kind === 'group'
      && flattenSourceNodes(source.children ?? []).some((child) => child.id === selected.id));
    const selectedBounds = selected?.transform;
    const pointInsideSelected = selectedBounds && (selected?.kind === 'group'
      ? x >= selectedBounds.x && x <= selectedBounds.x + selectedBounds.width
        && y >= selectedBounds.y && y <= selectedBounds.y + selectedBounds.height
      : sourceContainsPoint(selectedBounds, x, y));
    const source = resizeHandle ? selected
      : selected && pointInsideSelected && (selected.kind === 'group' || selectedIsGroupedChild)
        ? selected
        : withinCanvas ? hitTestSource(scene, x, y) : null;
    if (!source) {
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) selectSource(null);
      dragging.current = null;
      return;
    }

    const currentSelected = selectedSourceIds;
    let nextSelected = currentSelected;
    let nextAnchor = selectionAnchorId.current;
    if (!resizeHandle) {
      const modifiers: SelectionModifiers = { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
      const clickedAlreadySelected = currentSelected.includes(source.id);
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        const selectableIds = sourceRowOrder(scene.sources);
        const next = resolveSelection(sourceCanvasSelectionOrder(scene.sources), currentSelected, selectionAnchorId.current, source.id, modifiers, selectableIds);
        nextSelected = next.selectedIds;
        nextAnchor = next.anchorId;
        commitSelection(nextSelected, nextSelected.includes(source.id) ? source.id : null, nextAnchor);
      } else if (!clickedAlreadySelected) {
        nextSelected = [source.id];
        nextAnchor = source.id;
        commitSelection(nextSelected, source.id, nextAnchor);
      } else {
        // A plain press on any selected member starts a group drag without
        // collapsing the selection. Make that member the active inspector target.
        commitSelection(currentSelected, source.id, nextAnchor);
      }
    }

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    // Toggling an already selected item off must not immediately re-add it by
    // starting a drag that would implicitly select it again.
    if (!nextSelected.includes(source.id) || !canTransformSource(source.locked) || !isSourceTransformableInTree(scene.sources, source.id)) {
      dragging.current = null;
      return;
    }
    const canResize = resizeHandle !== null && nextSelected.length === 1
      && isSourceTransformableInTree(scene.sources, source.id) && canResizeSourceTree(source);
    const transformSource = source;
    if (!transformSource || !canTransformSource(transformSource.locked)) {
      dragging.current = null;
      return;
    }
    const movableSourceIds = flatSources.filter((item) => isSourceTransformableInTree(scene.sources, item.id)).map((item) => item.id);
    const affectedSnapIds = sourceIdsAffectedBySelection(scene.sources, canResize ? [source.id] : nextSelected);
    const cropRequested = canResize && (api.platform === 'darwin' ? event.metaKey : event.ctrlKey);
    const cropSize = cropRequested ? cropDimensionsForSource(source, videoElements.current, imageElements.current) : null;
    const cropMode = cropRequested && cropSize !== null;
    const movableTransforms = canResize
      ? [source.transform]
      : selectedMovableTransforms(scene.sources, nextSelected, movableSourceIds);
    dragging.current = {
      pointerId: event.pointerId,
      sourceId: source.id,
      sourceIds: nextSelected,
      movableSourceIds,
      sceneId: scene.id,
      startX: x,
      startY: y,
      appliedMoveX: 0,
      appliedMoveY: 0,
      originX: source.transform.x,
      originY: source.transform.y,
      originWidth: source.transform.width,
      originHeight: source.transform.height,
      originRotation: source.transform.rotation ?? 0,
      originCrop: { ...DEFAULT_SOURCE_CROP, ...source.crop },
      cropSize,
      originBounds: canResize ? sourceBounds(source.transform) : sourceBoundsForSelection(movableTransforms),
      snapExcludedSourceIds: [...affectedSnapIds],
      originIsGroup: source.kind === 'group',
      resizeHandle: canResize ? resizeHandle : null,
      aspectLocked: canResize && event.shiftKey && !cropMode,
      cropMode,
    };
  };

  const handleStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeDrag = dragging.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const output = { width: project?.output.width ?? 1920, height: project?.output.height ?? 1080 };
    const canvas = { width: project?.output.baseWidth ?? 1920, height: project?.output.baseHeight ?? 1080 };
    const { x, y } = canvasPointFromOutputPoint({
      x: ((event.clientX - rect.left) / rect.width) * output.width,
      y: ((event.clientY - rect.top) / rect.height) * output.height,
    }, canvas, output);
    const dx = x - activeDrag.startX;
    const dy = y - activeDrag.startY;
    const currentScene = projectRef.current?.scenes.find((scene) => scene.id === activeDrag.sceneId);
    const excludedIds = new Set(activeDrag.snapExcludedSourceIds);
    const snapTargets = currentScene ? snapTargetsForScene(currentScene, excludedIds, canvas) : { x: [], y: [] };
    const viewport = fitCanvasToOutput(canvas, output);
    const canvasDisplayWidth = rect.width * (viewport.width / output.width);
    const canvasDisplayHeight = rect.height * (viewport.height / output.height);
    const tolerance: SourceSnapTolerance = {
      x: canvasDisplayWidth > 0 ? SNAP_TOLERANCE_CSS_PX * canvas.width / canvasDisplayWidth : 0,
      y: canvasDisplayHeight > 0 ? SNAP_TOLERANCE_CSS_PX * canvas.height / canvasDisplayHeight : 0,
    };
    if (!activeDrag.resizeHandle) {
      const snap = !event.altKey && activeDrag.originBounds
        ? snapSourceTranslation(activeDrag.originBounds, dx, dy, snapTargets, tolerance)
        : { deltaX: dx, deltaY: dy, guides: [] };
      publishSnapGuides(snap.guides);
      const totalMoveX = Math.round(snap.deltaX);
      const totalMoveY = Math.round(snap.deltaY);
      const moveX = totalMoveX - activeDrag.appliedMoveX;
      const moveY = totalMoveY - activeDrag.appliedMoveY;
      if (moveX === 0 && moveY === 0) return;
      activeDrag.appliedMoveX = totalMoveX;
      activeDrag.appliedMoveY = totalMoveY;
      setProjectValue((current) => {
        let changed = false;
        const scenes = current.scenes.map((scene) => {
          if (scene.id !== activeDrag.sceneId) return scene;
          const sources = translateSourceSelection(scene.sources, activeDrag.sourceIds, moveX, moveY, activeDrag.movableSourceIds);
          if (sources.every((source, index) => source === scene.sources[index])) return scene;
          changed = true;
          return { ...scene, sources };
        });
        return changed ? { ...current, scenes } : current;
      });
      return;
    }
    const originTransform = {
      x: activeDrag.originX,
      y: activeDrag.originY,
      width: activeDrag.originWidth,
      height: activeDrag.originHeight,
      rotation: activeDrag.originIsGroup ? 0 : activeDrag.originRotation,
    };
    const resizeDelta = !event.altKey
      ? snapResizePointerDelta(originTransform, activeDrag.resizeHandle, dx, dy, snapTargets, tolerance,
        activeDrag.aspectLocked, activeDrag.cropMode ? 1 : 16)
      : { deltaX: dx, deltaY: dy, guides: [] };
    let cropResult = activeDrag.cropMode && activeDrag.cropSize
      ? sourceCropFromPointer(originTransform, activeDrag.originCrop, activeDrag.cropSize, activeDrag.resizeHandle, resizeDelta.deltaX, resizeDelta.deltaY)
      : null;
    let guides = resizeDelta.guides;
    if (cropResult && guides.length > 0) {
      const handlePoint = sourceResizeHandlePosition(cropResult.transform, activeDrag.resizeHandle);
      const aligned = guides.every((guide) => Math.abs(handlePoint[guide.axis] - guide.position)
        <= tolerance[guide.axis] / SNAP_TOLERANCE_CSS_PX + 1e-6);
      if (!aligned) {
        cropResult = sourceCropFromPointer(originTransform, activeDrag.originCrop, activeDrag.cropSize!, activeDrag.resizeHandle, dx, dy);
        guides = [];
      }
    }
    publishSnapGuides(guides);
    const resized = cropResult?.transform ?? resizeSourceFromPointer(
      originTransform, activeDrag.resizeHandle, resizeDelta.deltaX, resizeDelta.deltaY, 16, activeDrag.aspectLocked,
    );
    resized.rotation = activeDrag.originRotation;
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === activeDrag.sceneId
        ? { ...scene, sources: mapSourceTreeById(scene.sources, activeDrag.sourceId, (source) => ({
          ...source,
          transform: resized,
          ...(cropResult ? { crop: cropResult.crop } : {}),
        })) }
        : scene),
    }));
  };

  const handleStagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current?.pointerId === event.pointerId) {
      dragging.current = null;
      publishSnapGuides([]);
    }
  };

  const resetForWorkspaceChange = () => {
    selectSource(null);
    setCollapsedGroupIds([]);
    setBrowserDialogOpen(false);
    setSourceMenuOpen(false);
    setSourceActionsMenuOpen(false);
    sourceClipboardRef.current = null;
    setSourceClipboardAvailable(false);
  };

  return {
    selectedSourceId, selectedSourceIds, selectedSource, snapGuides, selectSource, selectSourceRow, selectAllSources, clearSourceSelection,
    collapsedGroupIds, setCollapsedGroupIds, canGroupSelectedSources,
    sourceMenuOpen, setSourceMenuOpen, sourceActionsMenuOpen, setSourceActionsMenuOpen,
    sourceMenuTriggerRef, sourceActionsTriggerRef, sourceClipboardAvailable,
    browserDialogOpen, setBrowserDialogOpen, browserUrl, setBrowserUrl, addBrowserSource,
    addToActiveScene, addSceneReference, addText, addColor, addMedia, addSlideshow, addPresentation, addSlideshowImage,
    moveSlideshowImage, removeSlideshowImage,
    updateSource, updateTextStyle, toggleSourceLock, updateSourceTransform, fitSource, centerSource,
    resetSourceTransform, stretchSource, updateCaptureCursorMode, updateSourceSettings, updateSourceMonitoring,
    updateSourceAudioTrack, updateSourceAudio, updateBrowserAudio, updateSourceFilters, updateSourceChromaKey,
    updateSourceCrop, updateSourceAudioFilters,
    toggleMediaPlayback, restartMediaPlayback, stopMediaPlayback,
    removeSelectedSource, nudgeSelectedSources, copySelectedSource, pasteSource, moveSource, moveSourceTo, onReorderSources,
    groupSelectedSources, ungroupSelectedSource,
    handleStagePointerDown, handleStagePointerMove, handleStagePointerUp,
    resetForWorkspaceChange,
  };
}
