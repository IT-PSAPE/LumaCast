import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, LocateFixed, Trash2 } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, Slide } from '@lumacast/composition';
import { createAudioSlideMarker, roundToMs, type AudioSlideMarker, type PlaybackSchedule } from '@lumacast/automation';
import { ReacstButton } from '@renderer/components/controls/button';
import { Field } from '@renderer/components/form/field';
import { Dropdown } from '@renderer/components/form/dropdown';
import { useAudio } from '../../contexts/playback/playback-context';
import { usePlaybackSchedules } from '../../contexts/playback-schedules-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { formatPlaybackTime } from './format-playback-time';

// Audio sync records markers at the playhead into one stable schedule per
// audio asset (`audio:<assetId>`). The schedule borrows content — an optional
// bound lyric/presentation item whose slides the markers advance through — but
// the record itself is independent and starts before any binding.

export function buildAudioSyncScheduleId(assetId: Id): string {
  return `audio:${assetId}`;
}

/**
 * Assign unassigned markers by chronological position in the sorted list, so
 * each new record advances to the next slide instead of restarting at the
 * first one. Markers with an explicit `slideId` are never overwritten.
 * Callers must pass markers sorted by `timeMs`.
 */
export function assignUnassignedMarkers(
  markers: readonly AudioSlideMarker[],
  slideIds: readonly Id[],
): AudioSlideMarker[] {
  if (slideIds.length === 0) return markers.map((marker) => ({ ...marker }));
  return markers.map((marker, index) => {
    if (marker.slideId !== null) return marker;
    return { ...marker, slideId: slideIds[index % slideIds.length] };
  });
}

/**
 * Rebind all markers to a new item's slides by chronological position. Old
 * slide ids belong to the previous item and are never valid for the new one,
 * so every marker is reassigned (explicit bindings included).
 */
export function reassignMarkersForSlides(
  markers: readonly AudioSlideMarker[],
  slideIds: readonly Id[],
): AudioSlideMarker[] {
  if (slideIds.length === 0) return markers.map((marker) => ({ ...marker, slideId: null }));
  return markers.map((marker, index) => ({
    ...marker,
    slideId: slideIds[index % slideIds.length],
  }));
}

export interface AudioSyncDraft {
  enabled: boolean;
  itemRef: ItemRef | null;
  markers: AudioSlideMarker[];
}

/** Enabling requires a bound item, at least one marker, and every marker on a valid bound slide. */
export function canEnableAudioSync(draft: AudioSyncDraft, boundSlides: readonly Slide[]): boolean {
  if (!draft.itemRef) return false;
  if (draft.markers.length === 0) return false;
  if (boundSlides.length === 0) return false;
  const valid = new Set<Id>(boundSlides.map((slide) => slide.id));
  return draft.markers.every((marker) => marker.slideId !== null && valid.has(marker.slideId));
}

const EMPTY_DRAFT: AudioSyncDraft = { enabled: false, itemRef: null, markers: [] };

function buildSchedule(assetId: Id, draft: AudioSyncDraft): PlaybackSchedule {
  return {
    id: buildAudioSyncScheduleId(assetId),
    itemRef: draft.itemRef,
    enabled: draft.enabled,
    kind: 'audio-sync',
    audioAssetId: assetId,
    markers: draft.markers,
  };
}

function byMarkerTime(left: AudioSlideMarker, right: AudioSlideMarker): number {
  return left.timeMs - right.timeMs;
}

function toErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : 'Could not save audio sync.';
  if (message.includes('No handler registered') && message.includes('PlaybackSchedule')) {
    return 'Restart LumaCast to finish updating audio sync. This change has not been saved.';
  }
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

function draftSignature(draft: AudioSyncDraft): string {
  return JSON.stringify(draft);
}

export interface AudioSyncCandidateItem {
  itemRef: ItemRef;
  title: string;
}

export interface AudioSyncController {
  assetId: Id | null;
  enabled: boolean;
  itemRef: ItemRef | null;
  markers: AudioSlideMarker[];
  error: string | null;
  syncSuspended: boolean;
  candidateItems: AudioSyncCandidateItem[];
  boundSlides: Slide[];
  hasSavedSchedule: boolean;
  record: () => void;
  setEnabled: (next: boolean) => void;
  setItemRef: (ref: ItemRef | null) => void;
  setMarkerSlide: (markerId: Id, slideId: Id) => void;
  setMarkerTime: (markerId: Id, seconds: number) => void;
  removeMarker: (markerId: Id) => void;
  seekToMarker: (timeMs: number) => void;
  removeSchedule: () => void;
  resumeSync: () => void;
}

export function useAudioSync(): AudioSyncController {
  const { currentAudioAsset, getCurrentTime, seekTo: seekAudio } = useAudio();
  const { schedules, saveSchedule, deleteSchedule, syncSuspended, resumeSync } = usePlaybackSchedules();
  const { lyrics, presentations, slidesForItemRef } = useProjectContent();

  const assetId = currentAudioAsset?.id ?? null;
  const assetIdRef = useRef<Id | null>(assetId);
  assetIdRef.current = assetId;
  const [draft, setDraft] = useState<AudioSyncDraft>(EMPTY_DRAFT);
  // Synchronous mirror of the draft: every mutation commits through this ref
  // first, so two records before a rerender both apply instead of the second
  // one clobbering the first via a stale `draft` closure.
  const draftRef = useRef<AudioSyncDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  // Which asset a visible error belongs to; switching assets clears errors
  // queued for the previous asset.
  const errorAssetRef = useRef<Id | null>(null);
  const [loadedForAssetId, setLoadedForAssetId] = useState<Id | null>(null);
  // In-flight saves. While > 0 the draft is ahead of the snapshot and must
  // not be overwritten by external (undo/redo/snapshot) updates.
  const pendingSavesRef = useRef(0);
  // Serializes rapid saves: each mutation enqueues one write of the snapshot
  // it captured at commit time, so interleaved records never drop markers.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  function readPersistedDraft(forAssetId: Id): AudioSyncDraft {
    const id = buildAudioSyncScheduleId(forAssetId);
    const existing = schedules.find((schedule) => schedule.id === id && schedule.kind === 'audio-sync');
    if (existing && existing.kind === 'audio-sync') {
      return {
        enabled: existing.enabled,
        itemRef: existing.itemRef,
        markers: existing.markers.map((marker) => ({ ...marker })),
      };
    }
    return { enabled: false, itemRef: null, markers: [] };
  }

  // Load on asset switch, then follow external undo/redo/snapshot changes
  // only while no saves are pending. Saves capture their target asset id at
  // commit time, so a queued write for the old asset can never land on the
  // newly loaded draft.
  useEffect(() => {
    if (!assetId) {
      draftRef.current = EMPTY_DRAFT;
      setDraft(EMPTY_DRAFT);
      setLoadedForAssetId(null);
      errorAssetRef.current = null;
      setError(null);
      return;
    }
    if (loadedForAssetId !== assetId) {
      const next = readPersistedDraft(assetId);
      draftRef.current = next;
      setDraft(next);
      setLoadedForAssetId(assetId);
      if (errorAssetRef.current !== null && errorAssetRef.current !== assetId) {
        errorAssetRef.current = null;
        setError(null);
      }
      return;
    }
    if (pendingSavesRef.current > 0 || errorAssetRef.current === assetId) return;
    const next = readPersistedDraft(assetId);
    if (draftSignature(draftRef.current) !== draftSignature(next)) {
      draftRef.current = next;
      setDraft(next);
    }
    if (errorAssetRef.current !== null && errorAssetRef.current !== assetId) {
      errorAssetRef.current = null;
      setError(null);
    }
    // `readPersistedDraft` closes over `schedules`; listing it keeps the
    // effect in sync with snapshot updates (undo/redo included).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, loadedForAssetId, schedules]);

  const enqueueSave = useCallback((target: Id, schedule: PlaybackSchedule) => {
    pendingSavesRef.current += 1;
    saveChainRef.current = saveChainRef.current
      .then(async () => {
        await saveSchedule(schedule);
        pendingSavesRef.current -= 1;
        if (assetIdRef.current === target) {
          errorAssetRef.current = null;
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        pendingSavesRef.current -= 1;
        if (assetIdRef.current === target) {
          errorAssetRef.current = target;
          setError(toErrorMessage(cause));
        }
      });
  }, [saveSchedule]);

  // Single commit path: derive the next draft from the synchronous ref,
  // publish it immediately, and persist the captured snapshot under the
  // asset that owned it at commit time.
  const commit = useCallback((updater: (prev: AudioSyncDraft) => AudioSyncDraft) => {
    const target = assetIdRef.current;
    if (!target || loadedForAssetId !== target) return;
    const next = updater(draftRef.current);
    if (next === draftRef.current) {
      if (errorAssetRef.current === target) enqueueSave(target, buildSchedule(target, next));
      return;
    }
    draftRef.current = next;
    setDraft(next);
    enqueueSave(target, buildSchedule(target, next));
  }, [enqueueSave, loadedForAssetId]);

  const record = useCallback(() => {
    if (!assetIdRef.current) return;
    const recorded = createAudioSlideMarker(roundToMs(getCurrentTime()));
    commit((prev) => {
      if (prev.markers.some((marker) => marker.timeMs === recorded.timeMs)) return prev;
      const merged = [...prev.markers, recorded].sort(byMarkerTime);
      let markers = merged;
      if (prev.itemRef) {
        const slides = slidesForItemRef(prev.itemRef);
        if (slides.length > 0) {
          markers = assignUnassignedMarkers(merged, slides.map((slide) => slide.id));
        }
      }
      return { ...prev, markers };
    });
  }, [commit, getCurrentTime, slidesForItemRef]);

  const setEnabled = useCallback((next: boolean) => {
    if (!assetIdRef.current) return;
    if (!next) {
      commit((prev) => ({ ...prev, enabled: false }));
      return;
    }
    const prev = draftRef.current;
    const slides = prev.itemRef ? slidesForItemRef(prev.itemRef) : [];
    if (!canEnableAudioSync(prev, slides)) {
      errorAssetRef.current = assetIdRef.current;
      setError('Bind an item with slides and assign every marker a slide before enabling.');
      return;
    }
    commit((previous) => ({ ...previous, enabled: true }));
  }, [commit, slidesForItemRef]);

  const setItemRef = useCallback((next: ItemRef | null) => {
    if (!assetIdRef.current) return;
    if (!next) {
      // The repository rejects enabled unbound schedules, so unbinding
      // always disables.
      commit((prev) => ({ ...prev, itemRef: null, enabled: false }));
      return;
    }
    const slides = slidesForItemRef(next);
    const slideIds = slides.map((slide) => slide.id);
    commit((prev) => {
      if (prev.itemRef?.id === next.id && prev.itemRef.type === next.type) return prev;
      const ordered = [...prev.markers].sort(byMarkerTime);
      const markers = reassignMarkersForSlides(ordered, slideIds);
      const keepEnabled = prev.enabled && slideIds.length > 0 && markers.every((marker) => marker.slideId !== null);
      return { ...prev, itemRef: next, markers, enabled: keepEnabled };
    });
  }, [commit, slidesForItemRef]);

  const setMarkerTime = useCallback((markerId: Id, seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const timeMs = roundToMs(seconds);
    if (draftRef.current.markers.some((marker) => marker.id !== markerId && marker.timeMs === timeMs)) {
      errorAssetRef.current = assetIdRef.current;
      setError('A marker already exists at this time.');
      return;
    }
    commit((prev) => ({
      ...prev,
      markers: prev.markers
        .map((marker) => (marker.id === markerId ? { ...marker, timeMs } : marker))
        .sort(byMarkerTime),
    }));
  }, [commit]);

  const setMarkerSlide = useCallback((markerId: Id, slideId: Id) => {
    commit((prev) => ({
      ...prev,
      markers: prev.markers.map((marker) => (marker.id === markerId ? { ...marker, slideId } : marker)),
    }));
  }, [commit]);

  const removeMarker = useCallback((markerId: Id) => {
    commit((prev) => {
      const markers = prev.markers.filter((marker) => marker.id !== markerId);
      return { ...prev, markers, enabled: prev.enabled && markers.length > 0 };
    });
  }, [commit]);

  const seekToMarker = useCallback((timeMs: number) => {
    seekAudio(timeMs / 1000);
  }, [seekAudio]);

  const removeSchedule = useCallback(() => {
    const target = assetIdRef.current;
    if (!target) return;
    const id = buildAudioSyncScheduleId(target);
    draftRef.current = EMPTY_DRAFT;
    setDraft(EMPTY_DRAFT);
    pendingSavesRef.current += 1;
    saveChainRef.current = saveChainRef.current
      .then(async () => {
        await deleteSchedule(id);
        pendingSavesRef.current -= 1;
        if (assetIdRef.current === target) {
          errorAssetRef.current = null;
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        pendingSavesRef.current -= 1;
        if (assetIdRef.current === target) {
          errorAssetRef.current = target;
          setError(toErrorMessage(cause));
        }
      });
  }, [deleteSchedule]);

  const candidateItems = useMemo<AudioSyncCandidateItem[]>(() => [
    ...lyrics.map((lyric) => ({ itemRef: { type: 'lyric' as const, id: lyric.id }, title: lyric.title })),
    ...presentations.map((presentation) => ({ itemRef: { type: 'presentation' as const, id: presentation.id }, title: presentation.title })),
  ], [lyrics, presentations]);

  const boundSlides = useMemo(() => (draft.itemRef ? slidesForItemRef(draft.itemRef) : []), [draft.itemRef, slidesForItemRef]);

  // Persisted truth only: the draft is ahead while saves are queued, so
  // deriving this from the draft would make a failed save still look saved.
  const hasSavedSchedule = useMemo(() => {
    if (!assetId) return false;
    return schedules.some((schedule) => schedule.id === buildAudioSyncScheduleId(assetId) && schedule.kind === 'audio-sync');
  }, [assetId, schedules]);

  return useMemo(() => ({
    assetId: loadedForAssetId === assetId ? assetId : null,
    enabled: draft.enabled,
    itemRef: draft.itemRef,
    markers: draft.markers,
    error,
    syncSuspended,
    candidateItems,
    boundSlides,
    hasSavedSchedule,
    record,
    setEnabled,
    setItemRef,
    setMarkerSlide,
    setMarkerTime,
    removeMarker,
    seekToMarker,
    removeSchedule,
    resumeSync,
  }), [
    assetId,
    loadedForAssetId,
    boundSlides,
    candidateItems,
    draft.enabled,
    draft.itemRef,
    draft.markers,
    error,
    hasSavedSchedule,
    record,
    removeMarker,
    removeSchedule,
    resumeSync,
    seekToMarker,
    setEnabled,
    setItemRef,
    setMarkerSlide,
    setMarkerTime,
    syncSuspended,
  ]);
}

function itemTriggerLabel(controller: AudioSyncController): string {
  if (!controller.itemRef) return 'No item';
  const match = controller.candidateItems.find(
    (candidate) => candidate.itemRef.type === controller.itemRef!.type && candidate.itemRef.id === controller.itemRef!.id,
  );
  return match ? match.title : 'Unknown item';
}

function markerSlideLabel(marker: AudioSlideMarker, slides: Slide[]): string {
  const index = slides.findIndex((slide) => slide.id === marker.slideId);
  return index >= 0 ? `Slide ${index + 1}` : 'Unassigned';
}

interface MarkerRowProps {
  marker: AudioSlideMarker;
  index: number;
  controller: AudioSyncController;
}

export function MarkerRow({ marker, index, controller }: MarkerRowProps) {
  const label = markerSlideLabel(marker, controller.boundSlides);
  const seconds = marker.timeMs / 1000;
  const hasSlides = Boolean(controller.itemRef) && controller.boundSlides.length > 0;
  // Raw editable text: while typing the input shows exactly what the user
  // typed, so clearing the field or typing a decimal never snaps back to a
  // formatted zero mid-keystroke. Commits happen for valid values only.
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => {
    setRaw(null);
  }, [marker.id, marker.timeMs]);

  const display = raw ?? String(Number(seconds.toFixed(2)));

  function handleChange(next: string) {
    setRaw(next);
    if (next.trim() === '') return;
    const parsed = Number(next);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    controller.setMarkerTime(marker.id, parsed);
  }

  function handleBlur() {
    if (raw === null) return;
    // The valid prefix (if any) already committed via onChange; resync to
    // the formatted persisted value, discarding empty/invalid text.
    setRaw(null);
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-sm bg-primary/60 px-1.5 py-1">
      <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-tertiary">{index + 1}</span>
      <Field.Input
        type="number"
        min={0}
        step={0.01}
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'Escape') setRaw(null);
        }}
        wrapperClassName="w-20"
        inputClassName="text-right"
        ariaLabel={`Marker ${index + 1} time in seconds`}
      />
      <span className="shrink-0 text-[10px] tabular-nums text-tertiary">{formatPlaybackTime(seconds)}</span>
      <div className="min-w-0 flex-1">
        {hasSlides ? (
          <Dropdown className="w-full">
            <Dropdown.Trigger
              aria-label={`Marker ${index + 1} slide`}
              className="flex h-7 w-full min-w-0 items-center gap-1 rounded bg-tertiary px-1.5 text-xs text-secondary"
            >
              <span className="flex-1 truncate text-left">{label}</span>
              <ChevronDown className="size-3 shrink-0 text-tertiary" />
            </Dropdown.Trigger>
            <Dropdown.Panel>
              {controller.boundSlides.map((slide, slideIndex) => (
                <Dropdown.Item key={slide.id} onClick={() => controller.setMarkerSlide(marker.id, slide.id)}>
                  Slide {slideIndex + 1}
                </Dropdown.Item>
              ))}
            </Dropdown.Panel>
          </Dropdown>
        ) : (
          <span className="flex h-7 w-full min-w-0 items-center rounded bg-tertiary px-1.5 text-xs text-tertiary">
            {label}
          </span>
        )}
      </div>
      <ReacstButton.Icon variant="ghost" label="Seek to marker" onClick={() => controller.seekToMarker(marker.timeMs)}>
        <LocateFixed />
      </ReacstButton.Icon>
      <ReacstButton.Icon variant="ghost" label="Remove marker" onClick={() => controller.removeMarker(marker.id)}>
        <Trash2 />
      </ReacstButton.Icon>
    </div>
  );
}

interface AudioSyncEditorProps {
  controller: AudioSyncController;
}

export function AudioSyncEditor({ controller }: AudioSyncEditorProps) {
  if (!controller.assetId) return null;
  return (
    <div data-ui-region="audio-sync-editor" className="flex shrink-0 items-center gap-2">
      {controller.syncSuspended ? (
        <ReacstButton variant="ghost" onClick={controller.resumeSync}>Resume sync</ReacstButton>
      ) : null}
      <button type="button" role="switch" aria-label="Audio sync" aria-checked={controller.enabled}
        onClick={() => controller.setEnabled(!controller.enabled)}
        className="flex h-7 items-center gap-1.5 text-xs text-secondary">
        <span>Sync</span>
        <span className={`flex h-4 w-7 items-center rounded-full px-0.5 ${controller.enabled ? 'bg-brand' : 'bg-tertiary'}`}>
          <span className={`size-3 rounded-full bg-white transition-transform ${controller.enabled ? 'translate-x-3' : ''}`} />
        </span>
      </button>
      <Dropdown className="w-44 shrink-0">
        <Dropdown.Trigger aria-label="Bind item" className="flex h-7 w-full min-w-0 items-center gap-1 rounded bg-tertiary px-2 text-xs text-primary">
          <span className="min-w-0 flex-1 truncate text-left">{itemTriggerLabel(controller)}</span>
          <ChevronDown className="size-3 shrink-0 text-tertiary" />
        </Dropdown.Trigger>
        <Dropdown.Panel>
          <Dropdown.Item onClick={() => controller.setItemRef(null)}>No item</Dropdown.Item>
          {controller.hasSavedSchedule ? <Dropdown.Item onClick={controller.removeSchedule}>Remove sync</Dropdown.Item> : null}
          {controller.candidateItems.map((candidate) => (
            <Dropdown.Item key={`${candidate.itemRef.type}:${candidate.itemRef.id}`} onClick={() => controller.setItemRef(candidate.itemRef)}>{candidate.title}</Dropdown.Item>
          ))}
        </Dropdown.Panel>
      </Dropdown>
    </div>
  );
}
