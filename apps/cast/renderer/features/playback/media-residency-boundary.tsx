import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buildVideoBackgroundClaimKey,
  buildVideoNodeClaimKey,
  warmImage,
  warmVideoClaim,
  warmVideoSource,
  type WarmImageHandle,
  type WarmImageTier,
  type WarmVideoHandle,
} from '@lumacast/canvas';
import type { ItemRef, MediaAsset, Overlay, PlaylistRow, SceneSurface, Slide, SlideElement, Stage } from '@lumacast/composition';
import { resolveMediaResidencyPlan } from '@lumacast/playback';
import { useNavigation } from '../../contexts/navigation-context';
import { usePresentationRenderLayer, useStagePlayback } from '../../contexts/playback/playback-context';
import { useSlides } from '../../contexts/slide-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { itemRefsEqual, nextItemRow } from '../../utils/navigation-context-utils';
import {
  buildMediaAssetsBySource,
  collectMediaSourcesFromOverlay,
  collectMediaSourcesFromSlide,
  collectMediaSourcesFromStage,
  mediaKeysOf,
  type CollectedMediaSource,
} from '../../utils/media-residency';

const T1_GRACE_MS = 3_000;
const MAX_ACTIVE_IMAGE_WARMS = 3;
const MAX_ACTIVE_VIDEO_WARMS = 2;
const IMAGE_EVICTION_RETRY_BASE_MS = 250;
const IMAGE_EVICTION_RETRY_MAX_ATTEMPTS = 4;
const SHOW_SURFACES: readonly SceneSurface[] = ['show', 'monitor', 'ndi-show'];
const STAGE_SURFACES: readonly SceneSurface[] = ['stage', 'ndi-stage'];
const SURFACE_PRIORITY: ReadonlyMap<SceneSurface, number> = new Map([
  ['show', 0],
  ['ndi-show', 1],
  ['monitor', 2],
  ['stage', 3],
  ['ndi-stage', 4],
  ['deck-editor', 5],
  ['list', 6],
]);

export interface PlannedWarmImageEntry {
  mediaKey: string;
  tier: WarmImageTier;
}

interface PlannedWarmVideoEntry {
  claimKey: string;
  mediaKey: string;
  tier: WarmImageTier;
  surface: SceneSurface;
  candidatePriority: number;
  ownerPriority: number;
}

interface ImageRetryState {
  attempts: number;
  retryAtMs: number | null;
  blockedUntilPlanChange: boolean;
  planKey: string;
}

function strongestSourceKinds(...sourceGroups: readonly CollectedMediaSource[][]): ReadonlyMap<string, CollectedMediaSource['kind']> {
  const kinds = new Map<string, CollectedMediaSource['kind']>();
  for (const sources of sourceGroups) {
    for (const source of sources) {
      if (!kinds.has(source.mediaKey)) {
        kinds.set(source.mediaKey, source.kind);
      }
    }
  }
  return kinds;
}

function collectDisplayedSources(params: {
  liveSlide: Slide | null;
  liveElements: readonly SlideElement[];
  contentLayerVisible: boolean;
  mediaLayerAsset: MediaAsset | null;
  videoLayerAsset: MediaAsset | null;
  activeOverlays: ReadonlyArray<{ overlay: Overlay }>;
}): CollectedMediaSource[] {
  const sink = new Map<string, CollectedMediaSource>();
  const liveSources = params.liveSlide
    ? collectMediaSourcesFromSlide(
      params.liveSlide,
      params.contentLayerVisible ? params.liveElements : [],
    )
    : [];
  for (const source of liveSources) sink.set(source.mediaKey, source);
  if (params.mediaLayerAsset) {
    sink.set(params.mediaLayerAsset.src, {
      mediaKey: params.mediaLayerAsset.src,
      kind: params.mediaLayerAsset.type === 'video' ? 'video' : 'image',
    });
  }
  if (params.videoLayerAsset) {
    sink.set(params.videoLayerAsset.src, {
      mediaKey: params.videoLayerAsset.src,
      kind: 'video',
    });
  }
  for (const overlayEntry of params.activeOverlays) {
    for (const source of collectMediaSourcesFromOverlay(overlayEntry.overlay)) {
      sink.set(source.mediaKey, source);
    }
  }
  return [...sink.values()];
}

export function resolvePlannedWarmImages(params: {
  currentItemRef: ItemRef | null;
  currentPlaylistEntryId: string | null;
  currentOutputItemRef: ItemRef | null;
  currentOutputPlaylistEntryId: string | null;
  currentSlideIndex: number;
  liveSlideIndex: number;
  liveSlide: Slide | null;
  liveElements: readonly SlideElement[];
  contentLayerVisible: boolean;
  mediaLayerAsset: MediaAsset | null;
  videoLayerAsset: MediaAsset | null;
  activeOverlays: ReadonlyArray<{ overlay: Overlay }>;
  currentStage: Stage | null;
  currentPlaylistRows: PlaylistRow[];
  slidesForItemRef: (ref: ItemRef | null | undefined) => Slide[];
  slideElementsBySlideId: ReadonlyMap<string, SlideElement[]>;
  mediaAssets: readonly MediaAsset[];
}): PlannedWarmImageEntry[] {
  const planItemRef = params.currentOutputItemRef ?? params.currentItemRef;
  const planSlides = params.slidesForItemRef(planItemRef);
  const liveSlideIndex = itemRefsEqual(planItemRef, params.currentOutputItemRef) ? params.liveSlideIndex : -1;
  const selectedSlideIndex = itemRefsEqual(planItemRef, params.currentItemRef) ? params.currentSlideIndex : liveSlideIndex;
  const displayedSources = collectDisplayedSources({
    liveSlide: params.liveSlide,
    liveElements: params.liveElements,
    contentLayerVisible: params.contentLayerVisible,
    mediaLayerAsset: params.mediaLayerAsset,
    videoLayerAsset: params.videoLayerAsset,
    activeOverlays: params.activeOverlays,
  });
  const slideSources = planSlides.map((slide) => collectMediaSourcesFromSlide(
    slide,
    params.slideElementsBySlideId.get(slide.id) ?? [],
  ));
  const nextPlaylistRow = nextItemRow(
    params.currentPlaylistRows,
    params.currentOutputPlaylistEntryId ?? params.currentPlaylistEntryId,
  );
  const nextPlaylistFirstSlide = nextPlaylistRow
    ? params.slidesForItemRef(nextPlaylistRow.itemRef)[0] ?? null
    : null;
  const nextPlaylistFirstSlideSources = nextPlaylistFirstSlide
    ? collectMediaSourcesFromSlide(nextPlaylistFirstSlide, params.slideElementsBySlideId.get(nextPlaylistFirstSlide.id) ?? [])
    : [];
  const stageSources = collectMediaSourcesFromStage(params.currentStage);
  const sourceKinds = strongestSourceKinds(
    displayedSources,
    ...slideSources,
    nextPlaylistFirstSlideSources,
    stageSources,
  );
  const mediaAssetsBySource = buildMediaAssetsBySource(params.mediaAssets);

  const plan = resolveMediaResidencyPlan({
    displayedMediaKeys: mediaKeysOf(displayedSources),
    slides: planSlides.map((slide, index) => ({
      id: slide.id,
      mediaKeys: mediaKeysOf(slideSources[index] ?? []),
    })),
    liveSlideIndex,
    selectedSlideIndex,
    nextPlaylistFirstSlide: nextPlaylistFirstSlide
      ? { id: nextPlaylistFirstSlide.id, mediaKeys: mediaKeysOf(nextPlaylistFirstSlideSources) }
      : null,
    armedStage: params.currentStage ? { id: params.currentStage.id, mediaKeys: mediaKeysOf(stageSources) } : null,
  });

  return plan.entries
    .filter((entry) => entry.tier === 'T1' || entry.tier === 'T2')
    .filter((entry) => sourceKinds.get(entry.mediaKey) === 'image')
    .filter((entry) => {
      const asset = mediaAssetsBySource.get(entry.mediaKey);
      return !asset || asset.type === 'image';
    })
    .map<PlannedWarmImageEntry>((entry) => ({
      mediaKey: entry.mediaKey,
      tier: entry.tier === 'T1' ? 'T1' : 'T2',
    }))
    .sort(comparePlannedWarmEntries);
}

function comparePlannedWarmEntries(left: { tier: WarmImageTier; mediaKey: string }, right: { tier: WarmImageTier; mediaKey: string }) {
  if (left.tier !== right.tier) return left.tier.localeCompare(right.tier);
  return left.mediaKey.localeCompare(right.mediaKey);
}

function buildSelectedCrossItemPlan(params: {
  currentItemRef: ItemRef | null;
  planItemRef: ItemRef | null;
  currentSlideIndex: number;
  slidesForItemRef: (ref: ItemRef | null | undefined) => Slide[];
  slideElementsBySlideId: ReadonlyMap<string, SlideElement[]>;
}): CollectedMediaSource[] {
  if (!params.currentItemRef || itemRefsEqual(params.currentItemRef, params.planItemRef)) return [];
  const selectedSlide = params.slidesForItemRef(params.currentItemRef)[params.currentSlideIndex] ?? null;
  if (!selectedSlide) return [];
  return collectMediaSourcesFromSlide(selectedSlide, params.slideElementsBySlideId.get(selectedSlide.id) ?? []);
}

function pushWarmImageEntries(
  sink: Map<string, PlannedWarmImageEntry>,
  sources: readonly CollectedMediaSource[],
  tier: WarmImageTier,
  mediaAssetsBySource: ReadonlyMap<string, MediaAsset>,
) {
  for (const source of sources) {
    if (source.kind !== 'image') continue;
    const asset = mediaAssetsBySource.get(source.mediaKey);
    if (asset && asset.type !== 'image') continue;
    const current = sink.get(source.mediaKey);
    if (!current || (tier === 'T1' && current.tier === 'T2')) {
      sink.set(source.mediaKey, { mediaKey: source.mediaKey, tier });
    }
  }
}

function appendCrossItemSelectedWarmImages(
  plannedWarmImages: PlannedWarmImageEntry[],
  params: {
    currentItemRef: ItemRef | null;
    planItemRef: ItemRef | null;
    currentSlideIndex: number;
    slidesForItemRef: (ref: ItemRef | null | undefined) => Slide[];
    slideElementsBySlideId: ReadonlyMap<string, SlideElement[]>;
    mediaAssets: readonly MediaAsset[];
  },
): PlannedWarmImageEntry[] {
  const selectedSources = buildSelectedCrossItemPlan(params);
  if (selectedSources.length === 0) return plannedWarmImages;
  const sink = new Map(plannedWarmImages.map((entry) => [entry.mediaKey, entry]));
  pushWarmImageEntries(sink, selectedSources, 'T1', buildMediaAssetsBySource(params.mediaAssets));
  return [...sink.values()].sort(comparePlannedWarmEntries);
}

interface PlannedVideoTarget {
  claimKeyBuilder: (surface: SceneSurface) => string;
  mediaKey: string;
  ownerPriority: number;
}

function collectSlideVideoTargets(ownerId: string, slide: Pick<Slide, 'background'> | null | undefined, elements: readonly SlideElement[]): PlannedVideoTarget[] {
  const targets: PlannedVideoTarget[] = [];
  let ownerPriority = 0;

  if (slide?.background && slide.background.type === 'video' && slide.background.src) {
    targets.push({
      claimKeyBuilder: (surface) => buildVideoBackgroundClaimKey(surface, ownerId),
      mediaKey: slide.background.src,
      ownerPriority,
    });
    ownerPriority += 1;
  }

  const visit = (element: SlideElement) => {
    if (element.type === 'video') {
      const mediaKey = (element.payload as { src?: string }).src ?? null;
      if (mediaKey) {
        targets.push({
          claimKeyBuilder: (surface) => buildVideoNodeClaimKey(surface, element.id),
          mediaKey,
          ownerPriority,
        });
        ownerPriority += 1;
      }
      return;
    }
    if (element.type !== 'group') return;
    for (const child of ((element.payload as { children?: SlideElement[] }).children ?? [])) {
      visit(child);
    }
  };

  for (const element of elements) {
    visit(element);
  }

  return targets;
}

function collectSlideVideoClaims(
  ownerId: string,
  slide: Pick<Slide, 'background' | 'id'> | null | undefined,
  elements: readonly SlideElement[],
  surfaces: readonly SceneSurface[],
  tier: WarmImageTier,
  candidatePriority: number,
  sink: Map<string, PlannedWarmVideoEntry>,
) {
  if (!slide) return;
  for (const target of collectSlideVideoTargets(ownerId, slide, elements)) {
    for (const surface of surfaces) {
      const claimKey = target.claimKeyBuilder(surface);
      sink.set(claimKey, {
        claimKey,
        mediaKey: target.mediaKey,
        tier,
        surface,
        candidatePriority,
        ownerPriority: target.ownerPriority,
      });
    }
  }
}

function appendPlannedVideoClaims(params: {
  currentItemRef: ItemRef | null;
  currentOutputItemRef: ItemRef | null;
  currentSlideIndex: number;
  liveSlideIndex: number;
  currentStage: Stage | null;
  slidesForItemRef: (ref: ItemRef | null | undefined) => Slide[];
  slideElementsBySlideId: ReadonlyMap<string, SlideElement[]>;
  currentPlaylistRows: PlaylistRow[];
  currentPlaylistEntryId: string | null;
  currentOutputPlaylistEntryId: string | null;
}): PlannedWarmVideoEntry[] {
  const sink = new Map<string, PlannedWarmVideoEntry>();
  const planItemRef = params.currentOutputItemRef ?? params.currentItemRef;
  const planSlides = params.slidesForItemRef(planItemRef);
  const nextSlide = params.liveSlideIndex >= 0 ? planSlides[params.liveSlideIndex + 1] ?? null : null;
  const secondNextSlide = params.liveSlideIndex >= 0 ? planSlides[params.liveSlideIndex + 2] ?? null : null;
  const nextPlaylistRow = nextItemRow(
    params.currentPlaylistRows,
    params.currentOutputPlaylistEntryId ?? params.currentPlaylistEntryId,
  );
  const crossItemFirstSlide = nextPlaylistRow ? params.slidesForItemRef(nextPlaylistRow.itemRef)[0] ?? null : null;
  const selectedCrossItemSlide = (!params.currentItemRef || itemRefsEqual(params.currentItemRef, planItemRef))
    ? null
    : params.slidesForItemRef(params.currentItemRef)[params.currentSlideIndex] ?? null;

  collectSlideVideoClaims(
    nextSlide?.id ?? 'next-slide',
    nextSlide,
    nextSlide ? (params.slideElementsBySlideId.get(nextSlide.id) ?? []) : [],
    SHOW_SURFACES,
    'T1',
    0,
    sink,
  );
  collectSlideVideoClaims(
    secondNextSlide?.id ?? 'second-next-slide',
    secondNextSlide,
    secondNextSlide ? (params.slideElementsBySlideId.get(secondNextSlide.id) ?? []) : [],
    SHOW_SURFACES,
    'T2',
    4,
    sink,
  );
  collectSlideVideoClaims(
    crossItemFirstSlide?.id ?? 'cross-item-first-slide',
    crossItemFirstSlide,
    crossItemFirstSlide ? (params.slideElementsBySlideId.get(crossItemFirstSlide.id) ?? []) : [],
    SHOW_SURFACES,
    'T1',
    2,
    sink,
  );
  collectSlideVideoClaims(
    selectedCrossItemSlide?.id ?? 'selected-cross-item-slide',
    selectedCrossItemSlide,
    selectedCrossItemSlide ? (params.slideElementsBySlideId.get(selectedCrossItemSlide.id) ?? []) : [],
    SHOW_SURFACES,
    'T1',
    1,
    sink,
  );
  if (params.currentStage) {
    collectSlideVideoClaims(
      params.currentStage.id,
      { id: params.currentStage.id, background: params.currentStage.background ?? null },
      params.currentStage.elements,
      STAGE_SURFACES,
      'T1',
      3,
      sink,
    );
  }

  return [...sink.values()].sort((left, right) => {
    if (left.tier !== right.tier) return left.tier.localeCompare(right.tier);
    if (left.candidatePriority !== right.candidatePriority) return left.candidatePriority - right.candidatePriority;
    if (left.ownerPriority !== right.ownerPriority) return left.ownerPriority - right.ownerPriority;
    const leftSurfacePriority = SURFACE_PRIORITY.get(left.surface) ?? Number.MAX_SAFE_INTEGER;
    const rightSurfacePriority = SURFACE_PRIORITY.get(right.surface) ?? Number.MAX_SAFE_INTEGER;
    if (leftSurfacePriority !== rightSurfacePriority) return leftSurfacePriority - rightSurfacePriority;
    return left.claimKey.localeCompare(right.claimKey);
  });
}

function buildImagePlanKey(entries: readonly PlannedWarmImageEntry[]): string {
  return entries.map((entry) => `${entry.mediaKey}:${entry.tier}`).join('|');
}

function buildPlannedSharedVideoSources(plannedWarmVideos: readonly PlannedWarmVideoEntry[], videoLayerAsset: MediaAsset | null): string[] {
  const ordered = new Set<string>();
  if (videoLayerAsset?.src) {
    ordered.add(videoLayerAsset.src);
  }
  for (const entry of plannedWarmVideos) {
    ordered.add(entry.mediaKey);
    if (ordered.size >= MAX_ACTIVE_VIDEO_WARMS) break;
  }
  return [...ordered];
}

export function MediaResidencyBoundary({ children }: { children: ReactNode }) {
  const {
    currentItemRef,
    currentPlaylistEntryId,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    currentPlaylistRows,
  } = useNavigation();
  const {
    currentSlideIndex,
    liveSlide,
    liveSlideIndex,
    liveElements,
  } = useSlides();
  const { contentLayerVisible, mediaLayerAsset, videoLayerAsset, activeOverlays } = usePresentationRenderLayer();
  const { currentStageId } = useStagePlayback();
  const { slidesForItemRef, slideElementsBySlideId, stagesById, mediaAssets } = useProjectContent();
  const currentStage = currentStageId ? stagesById.get(currentStageId) ?? null : null;
  const planItemRef = currentOutputItemRef ?? currentItemRef;
  const plannedWarmImages = useMemo(() => appendCrossItemSelectedWarmImages(resolvePlannedWarmImages({
    currentItemRef,
    currentPlaylistEntryId,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    currentSlideIndex,
    liveSlideIndex,
    liveSlide,
    liveElements,
    contentLayerVisible,
    mediaLayerAsset,
    videoLayerAsset,
    activeOverlays,
    currentStage,
    currentPlaylistRows,
    slidesForItemRef,
    slideElementsBySlideId,
    mediaAssets,
  }), {
    currentItemRef,
    planItemRef,
    currentSlideIndex,
    slidesForItemRef,
    slideElementsBySlideId,
    mediaAssets,
  }), [
    activeOverlays,
    contentLayerVisible,
    currentItemRef,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    currentPlaylistEntryId,
    currentPlaylistRows,
    currentSlideIndex,
    currentStage,
    liveElements,
    liveSlide,
    liveSlideIndex,
    mediaAssets,
    mediaLayerAsset,
    slideElementsBySlideId,
    slidesForItemRef,
    videoLayerAsset,
  ]);
  const plannedWarmVideos = useMemo(() => appendPlannedVideoClaims({
    currentItemRef,
    currentOutputItemRef,
    currentSlideIndex,
    liveSlideIndex,
    currentStage,
    slidesForItemRef,
    slideElementsBySlideId,
    currentPlaylistRows,
    currentPlaylistEntryId,
    currentOutputPlaylistEntryId,
  }), [
    currentItemRef,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    currentPlaylistEntryId,
    currentPlaylistRows,
    currentSlideIndex,
    currentStage,
    liveSlideIndex,
    slideElementsBySlideId,
    slidesForItemRef,
  ]);
  const warmHandlesRef = useRef(new Map<string, { tier: WarmImageTier; handle: WarmImageHandle; unsubscribe: () => void }>());
  const warmVideoHandlesRef = useRef(new Map<string, { tier: WarmImageTier; handle: WarmVideoHandle }>());
  const warmSharedVideoHandlesRef = useRef(new Map<string, WarmVideoHandle>());
  const imageRetryStateRef = useRef(new Map<string, ImageRetryState>());
  const imageRetryTimerIdRef = useRef<number | null>(null);
  const [imagePlanEpoch, setImagePlanEpoch] = useState(0);
  const imagePlanKey = useMemo(() => buildImagePlanKey(plannedWarmImages), [plannedWarmImages]);
  const plannedSharedVideoSources = useMemo(
    () => buildPlannedSharedVideoSources(plannedWarmVideos, videoLayerAsset),
    [plannedWarmVideos, videoLayerAsset],
  );
  const previousImagePlanKeyRef = useRef(imagePlanKey);

  useEffect(() => {
    if (previousImagePlanKeyRef.current === imagePlanKey) return;
    previousImagePlanKeyRef.current = imagePlanKey;
    imageRetryStateRef.current.clear();
  }, [imagePlanKey]);

  useEffect(() => {
    const nextPlan = new Map(plannedWarmImages.map((entry) => [entry.mediaKey, entry]));
    const nowMs = Date.now();

    for (const [mediaKey, warmed] of warmHandlesRef.current) {
      const next = nextPlan.get(mediaKey);
      if (next) {
        if (warmed.handle.getStatus() === 'evicted') continue;
        if (warmed.tier !== next.tier) {
          warmed.handle.setOptions({
            tier: next.tier,
            graceMs: next.tier === 'T1' ? T1_GRACE_MS : undefined,
          });
          warmed.tier = next.tier;
        }
        continue;
      }
      warmed.unsubscribe();
      warmed.handle.release();
      warmHandlesRef.current.delete(mediaKey);
      imageRetryStateRef.current.delete(mediaKey);
    }

    const activeLoadingCount = [...warmHandlesRef.current.values()].filter((entry) => entry.handle.getStatus() === 'loading').length;
    let remainingAdmissions = Math.max(0, MAX_ACTIVE_IMAGE_WARMS - activeLoadingCount);
    let nextRetryWakeMs: number | null = null;

    for (const entry of plannedWarmImages) {
      if (!nextPlan.has(entry.mediaKey)) continue;
      if (warmHandlesRef.current.has(entry.mediaKey)) continue;
      const retryState = imageRetryStateRef.current.get(entry.mediaKey);
      if (retryState?.planKey === imagePlanKey && retryState.blockedUntilPlanChange) {
        continue;
      }
      const retryUntilMs = retryState?.planKey === imagePlanKey ? retryState.retryAtMs : null;
      if (retryUntilMs != null && retryUntilMs > nowMs) {
        if (nextRetryWakeMs == null || retryUntilMs < nextRetryWakeMs) nextRetryWakeMs = retryUntilMs;
        continue;
      }
      if (remainingAdmissions <= 0) continue;
      const handle = warmImage(entry.mediaKey, {
        tier: entry.tier,
        graceMs: entry.tier === 'T1' ? T1_GRACE_MS : undefined,
      });
      if (handle.getStatus() === 'loading') {
        remainingAdmissions -= 1;
      }
      const unsubscribe = handle.subscribe(() => {
        const status = handle.getStatus();
        if (status === 'loaded' || status === 'broken') {
          imageRetryStateRef.current.delete(entry.mediaKey);
          setImagePlanEpoch((currentEpoch) => currentEpoch + 1);
          return;
        }
        if (status !== 'evicted') return;
        const current = warmHandlesRef.current.get(entry.mediaKey);
        if (!current || current.handle !== handle) return;
        current.unsubscribe();
        warmHandlesRef.current.delete(entry.mediaKey);
        handle.release();
        const previous = imageRetryStateRef.current.get(entry.mediaKey);
        const attempts = previous?.planKey === imagePlanKey ? previous.attempts + 1 : 1;
        if (attempts >= IMAGE_EVICTION_RETRY_MAX_ATTEMPTS) {
          imageRetryStateRef.current.set(entry.mediaKey, {
            attempts,
            retryAtMs: null,
            blockedUntilPlanChange: true,
            planKey: imagePlanKey,
          });
        } else {
          imageRetryStateRef.current.set(entry.mediaKey, {
            attempts,
            retryAtMs: Date.now() + (IMAGE_EVICTION_RETRY_BASE_MS * (2 ** (attempts - 1))),
            blockedUntilPlanChange: false,
            planKey: imagePlanKey,
          });
        }
        setImagePlanEpoch((currentEpoch) => currentEpoch + 1);
      });
      warmHandlesRef.current.set(entry.mediaKey, {
        tier: entry.tier,
        handle,
        unsubscribe,
      });
    }

    if (imageRetryTimerIdRef.current !== null) {
      window.clearTimeout(imageRetryTimerIdRef.current);
      imageRetryTimerIdRef.current = null;
    }
    if (nextRetryWakeMs != null) {
      imageRetryTimerIdRef.current = window.setTimeout(() => {
        imageRetryTimerIdRef.current = null;
        setImagePlanEpoch((currentEpoch) => currentEpoch + 1);
      }, Math.max(0, nextRetryWakeMs - nowMs));
    }
  }, [imagePlanEpoch, imagePlanKey, plannedWarmImages]);

  useEffect(() => {
    const nextPlan = new Map(plannedWarmVideos.slice(0, MAX_ACTIVE_VIDEO_WARMS).map((entry) => [entry.claimKey, entry]));

    for (const [claimKey, warmed] of warmVideoHandlesRef.current) {
      const next = nextPlan.get(claimKey);
      if (next && next.tier === warmed.tier && next.mediaKey === warmed.handle.mediaKey) continue;
      warmed.handle.release();
      warmVideoHandlesRef.current.delete(claimKey);
    }

    for (const entry of plannedWarmVideos.slice(0, MAX_ACTIVE_VIDEO_WARMS)) {
      const existing = warmVideoHandlesRef.current.get(entry.claimKey);
      if (existing) continue;
      warmVideoHandlesRef.current.set(entry.claimKey, {
        tier: entry.tier,
        handle: warmVideoClaim(entry.claimKey, entry.mediaKey),
      });
    }
  }, [plannedWarmVideos]);

  useEffect(() => {
    const nextWarmSources = new Set(plannedSharedVideoSources);

    for (const [mediaKey, handle] of warmSharedVideoHandlesRef.current) {
      if (nextWarmSources.has(mediaKey)) continue;
      handle.release();
      warmSharedVideoHandlesRef.current.delete(mediaKey);
    }

    for (const mediaKey of nextWarmSources) {
      if (warmSharedVideoHandlesRef.current.has(mediaKey)) continue;
      warmSharedVideoHandlesRef.current.set(mediaKey, warmVideoSource(mediaKey));
    }
  }, [plannedSharedVideoSources]);

  useEffect(() => () => {
    for (const warmed of warmHandlesRef.current.values()) {
      warmed.unsubscribe();
      warmed.handle.release();
    }
    warmHandlesRef.current.clear();
    for (const warmed of warmVideoHandlesRef.current.values()) {
      warmed.handle.release();
    }
    warmVideoHandlesRef.current.clear();
    for (const warmed of warmSharedVideoHandlesRef.current.values()) {
      warmed.release();
    }
    warmSharedVideoHandlesRef.current.clear();
    if (imageRetryTimerIdRef.current !== null) {
      window.clearTimeout(imageRetryTimerIdRef.current);
      imageRetryTimerIdRef.current = null;
    }
  }, []);

  return <>{children}</>;
}
