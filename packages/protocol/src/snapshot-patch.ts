import type { Id } from '@lumacast/kernel';
import type {
  Lyric,
  LyricTheme,
  MediaAsset,
  Overlay,
  OverlayTheme,
  Playlist,
  PlaylistRow,
  Presentation,
  PresentationTheme,
  Slide,
  SlideElement,
  Stage,
  Talk,
  TalkScriptBlock,
  TalkTheme,
} from '@lumacast/composition';
import type { Cue, Macro, TriggerBinding } from '@lumacast/automation';
import type { AppSnapshot } from './rpc-results';

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Differential update to an AppSnapshot. Emitted by the main process on
 * mutations and applied on the renderer to update local state without
 * paying the IPC cost of a full AppSnapshot round-trip.
 *
 * The `version` field is a monotonically-increasing counter bumped on
 * every mutation; downstream code can use it for ordering / de-dup, or
 * just as a debug hint.
 *
 * Each top-level table present in `upserts` or `deletes` mutates the
 * corresponding array in AppSnapshot. Missing keys mean "no change".
 * Upserts carry full records; deletes carry just the ids.
 *
 * #219 item-model refactor decision D4: `libraries`/`libraryBundles` are
 * gone along with the library concept — `playlists`/`playlistEntries` are
 * ordinary flat tables now, patched with the same upsert/delete semantics
 * as every other table. The special-cased full-replacement
 * `libraryBundles` key (and its six parallel hand-written per-table sites)
 * is deleted outright, not replaced by an equivalent — this is a
 * deliberate simplification of the patch vocabulary; any tree the renderer
 * needs is derived client-side (`use-project-content`), not carried here.
 */
export interface SnapshotPatch {
  version: number;
  upserts: {
    presentations?: Presentation[];
    lyrics?: Lyric[];
    talks?: Talk[];
    slides?: Slide[];
    talkScriptBlocks?: TalkScriptBlock[];
    slideElements?: SlideElement[];
    mediaAssets?: MediaAsset[];
    overlays?: Overlay[];
    presentationThemes?: PresentationTheme[];
    lyricThemes?: LyricTheme[];
    talkThemes?: TalkTheme[];
    overlayThemes?: OverlayTheme[];
    stages?: Stage[];
    playlists?: Playlist[];
    playlistEntries?: PlaylistRow[];
    cues?: Cue[];
    macros?: Macro[];
    triggerBindings?: TriggerBinding[];
  };
  deletes: {
    presentations?: Id[];
    lyrics?: Id[];
    talks?: Id[];
    slides?: Id[];
    talkScriptBlocks?: Id[];
    slideElements?: Id[];
    mediaAssets?: Id[];
    overlays?: Id[];
    presentationThemes?: Id[];
    lyricThemes?: Id[];
    talkThemes?: Id[];
    overlayThemes?: Id[];
    stages?: Id[];
    playlists?: Id[];
    playlistEntries?: Id[];
    cues?: Id[];
    macros?: Id[];
    triggerBindings?: Id[];
  };
}

type SnapshotTableKey =
  | 'presentations'
  | 'lyrics'
  | 'talks'
  | 'slides'
  | 'talkScriptBlocks'
  | 'slideElements'
  | 'mediaAssets'
  | 'overlays'
  | 'presentationThemes'
  | 'lyricThemes'
  | 'talkThemes'
  | 'overlayThemes'
  | 'stages'
  | 'playlists'
  | 'playlistEntries'
  | 'cues'
  | 'macros'
  | 'triggerBindings';

type SnapshotTableRecordMap = {
  presentations: Presentation;
  lyrics: Lyric;
  talks: Talk;
  slides: Slide;
  talkScriptBlocks: TalkScriptBlock;
  slideElements: SlideElement;
  mediaAssets: MediaAsset;
  overlays: Overlay;
  presentationThemes: PresentationTheme;
  lyricThemes: LyricTheme;
  talkThemes: TalkTheme;
  overlayThemes: OverlayTheme;
  stages: Stage;
  playlists: Playlist;
  playlistEntries: PlaylistRow;
  cues: Cue;
  macros: Macro;
  triggerBindings: TriggerBinding;
};

// ─── Utilities ──────────────────────────────────────────────────────

export function createEmptyPatch(version: number): SnapshotPatch {
  return { version, upserts: {}, deletes: {} };
}

/**
 * Apply a patch to an AppSnapshot, returning a new AppSnapshot.
 * Arrays are never mutated in place — a fresh AppSnapshot and fresh
 * arrays are produced for every changed key, so React consumers can
 * rely on reference-equality for change detection.
 */
export function applyPatch(snapshot: AppSnapshot, patch: SnapshotPatch): AppSnapshot {
  const next: AppSnapshot = {
    ...snapshot,
    presentations: mergeTable(snapshot.presentations, patch.upserts.presentations, patch.deletes.presentations),
    lyrics: mergeTable(snapshot.lyrics, patch.upserts.lyrics, patch.deletes.lyrics),
    talks: mergeTable(snapshot.talks, patch.upserts.talks, patch.deletes.talks),
    slides: mergeTable(snapshot.slides, patch.upserts.slides, patch.deletes.slides),
    talkScriptBlocks: mergeTable(snapshot.talkScriptBlocks, patch.upserts.talkScriptBlocks, patch.deletes.talkScriptBlocks),
    slideElements: mergeTable(snapshot.slideElements, patch.upserts.slideElements, patch.deletes.slideElements),
    mediaAssets: mergeTable(snapshot.mediaAssets, patch.upserts.mediaAssets, patch.deletes.mediaAssets),
    overlays: mergeTable(snapshot.overlays, patch.upserts.overlays, patch.deletes.overlays),
    presentationThemes: mergeTable(snapshot.presentationThemes, patch.upserts.presentationThemes, patch.deletes.presentationThemes),
    lyricThemes: mergeTable(snapshot.lyricThemes, patch.upserts.lyricThemes, patch.deletes.lyricThemes),
    talkThemes: mergeTable(snapshot.talkThemes, patch.upserts.talkThemes, patch.deletes.talkThemes),
    overlayThemes: mergeTable(snapshot.overlayThemes, patch.upserts.overlayThemes, patch.deletes.overlayThemes),
    stages: mergeTable(snapshot.stages, patch.upserts.stages, patch.deletes.stages),
    playlists: mergeTable(snapshot.playlists, patch.upserts.playlists, patch.deletes.playlists),
    playlistEntries: mergeTable(snapshot.playlistEntries, patch.upserts.playlistEntries, patch.deletes.playlistEntries),
    cues: mergeTable(snapshot.cues, patch.upserts.cues, patch.deletes.cues),
    macros: mergeTable(snapshot.macros, patch.upserts.macros, patch.deletes.macros),
    triggerBindings: mergeTable(snapshot.triggerBindings, patch.upserts.triggerBindings, patch.deletes.triggerBindings),
  };
  return next;
}

/**
 * Build the inverse of a SnapshotPatch relative to the pre-patch snapshot.
 * The returned patch restores the previous state when applied to the post-patch
 * snapshot. This lets the renderer keep compact undo history entries instead of
 * retaining entire AppSnapshot objects for patch-based mutations.
 */
export function invertPatch(snapshot: AppSnapshot, patch: SnapshotPatch): SnapshotPatch {
  const inverse: SnapshotPatch = createEmptyPatch(patch.version);

  invertTable(snapshot.presentations, patch.upserts.presentations, patch.deletes.presentations, inverse, 'presentations');
  invertTable(snapshot.lyrics, patch.upserts.lyrics, patch.deletes.lyrics, inverse, 'lyrics');
  invertTable(snapshot.talks, patch.upserts.talks, patch.deletes.talks, inverse, 'talks');
  invertTable(snapshot.slides, patch.upserts.slides, patch.deletes.slides, inverse, 'slides');
  invertTable(snapshot.talkScriptBlocks, patch.upserts.talkScriptBlocks, patch.deletes.talkScriptBlocks, inverse, 'talkScriptBlocks');
  invertTable(snapshot.slideElements, patch.upserts.slideElements, patch.deletes.slideElements, inverse, 'slideElements');
  invertTable(snapshot.mediaAssets, patch.upserts.mediaAssets, patch.deletes.mediaAssets, inverse, 'mediaAssets');
  invertTable(snapshot.overlays, patch.upserts.overlays, patch.deletes.overlays, inverse, 'overlays');
  invertTable(snapshot.presentationThemes, patch.upserts.presentationThemes, patch.deletes.presentationThemes, inverse, 'presentationThemes');
  invertTable(snapshot.lyricThemes, patch.upserts.lyricThemes, patch.deletes.lyricThemes, inverse, 'lyricThemes');
  invertTable(snapshot.talkThemes, patch.upserts.talkThemes, patch.deletes.talkThemes, inverse, 'talkThemes');
  invertTable(snapshot.overlayThemes, patch.upserts.overlayThemes, patch.deletes.overlayThemes, inverse, 'overlayThemes');
  invertTable(snapshot.stages, patch.upserts.stages, patch.deletes.stages, inverse, 'stages');
  invertTable(snapshot.playlists, patch.upserts.playlists, patch.deletes.playlists, inverse, 'playlists');
  invertTable(snapshot.playlistEntries, patch.upserts.playlistEntries, patch.deletes.playlistEntries, inverse, 'playlistEntries');
  invertTable(snapshot.cues, patch.upserts.cues, patch.deletes.cues, inverse, 'cues');
  invertTable(snapshot.macros, patch.upserts.macros, patch.deletes.macros, inverse, 'macros');
  invertTable(snapshot.triggerBindings, patch.upserts.triggerBindings, patch.deletes.triggerBindings, inverse, 'triggerBindings');

  return inverse;
}

function mergeTable<T extends { id: Id }>(current: T[], upserts: T[] | undefined, deletes: Id[] | undefined): T[] {
  if (!upserts && !deletes) return current;
  const deletedIds = deletes && deletes.length > 0 ? new Set(deletes) : null;
  const upsertsById = upserts && upserts.length > 0
    ? new Map(upserts.map((record) => [record.id, record] as const))
    : null;

  const next: T[] = [];
  const seenUpserts = upsertsById ? new Set<Id>() : null;

  for (const record of current) {
    if (deletedIds?.has(record.id)) continue;
    const replacement = upsertsById?.get(record.id);
    if (replacement) {
      next.push(replacement);
      seenUpserts?.add(record.id);
    } else {
      next.push(record);
    }
  }

  if (upsertsById) {
    for (const [id, record] of upsertsById) {
      if (!seenUpserts?.has(id)) next.push(record);
    }
  }

  return next;
}

function invertTable<K extends SnapshotTableKey>(
  current: SnapshotTableRecordMap[K][],
  upserts: SnapshotTableRecordMap[K][] | undefined,
  deletes: Id[] | undefined,
  inverse: SnapshotPatch,
  key: K,
): void {
  const currentById = new Map(current.map((record) => [record.id, record] as const));

  if (upserts) {
    for (const record of upserts) {
      const previous = currentById.get(record.id);
      if (previous) {
        appendInverseUpsert(inverse, key, previous);
      } else {
        appendInverseDelete(inverse, key, record.id);
      }
    }
  }

  if (deletes) {
    for (const id of deletes) {
      const previous = currentById.get(id);
      if (!previous) continue;
      appendInverseUpsert(inverse, key, previous);
    }
  }
}

function appendInverseUpsert<K extends SnapshotTableKey>(
  inverse: SnapshotPatch,
  key: K,
  value: SnapshotTableRecordMap[K],
): void {
  switch (key) {
    case 'presentations':
      inverse.upserts.presentations = [...(inverse.upserts.presentations ?? []), value as Presentation];
      return;
    case 'lyrics':
      inverse.upserts.lyrics = [...(inverse.upserts.lyrics ?? []), value as Lyric];
      return;
    case 'talks':
      inverse.upserts.talks = [...(inverse.upserts.talks ?? []), value as Talk];
      return;
    case 'slides':
      inverse.upserts.slides = [...(inverse.upserts.slides ?? []), value as Slide];
      return;
    case 'talkScriptBlocks':
      inverse.upserts.talkScriptBlocks = [...(inverse.upserts.talkScriptBlocks ?? []), value as TalkScriptBlock];
      return;
    case 'slideElements':
      inverse.upserts.slideElements = [...(inverse.upserts.slideElements ?? []), value as SlideElement];
      return;
    case 'mediaAssets':
      inverse.upserts.mediaAssets = [...(inverse.upserts.mediaAssets ?? []), value as MediaAsset];
      return;
    case 'overlays':
      inverse.upserts.overlays = [...(inverse.upserts.overlays ?? []), value as Overlay];
      return;
    case 'presentationThemes':
      inverse.upserts.presentationThemes = [...(inverse.upserts.presentationThemes ?? []), value as PresentationTheme];
      return;
    case 'lyricThemes':
      inverse.upserts.lyricThemes = [...(inverse.upserts.lyricThemes ?? []), value as LyricTheme];
      return;
    case 'talkThemes':
      inverse.upserts.talkThemes = [...(inverse.upserts.talkThemes ?? []), value as TalkTheme];
      return;
    case 'overlayThemes':
      inverse.upserts.overlayThemes = [...(inverse.upserts.overlayThemes ?? []), value as OverlayTheme];
      return;
    case 'stages':
      inverse.upserts.stages = [...(inverse.upserts.stages ?? []), value as Stage];
      return;
    case 'playlists':
      inverse.upserts.playlists = [...(inverse.upserts.playlists ?? []), value as Playlist];
      return;
    case 'playlistEntries':
      inverse.upserts.playlistEntries = [...(inverse.upserts.playlistEntries ?? []), value as PlaylistRow];
      return;
    case 'cues':
      inverse.upserts.cues = [...(inverse.upserts.cues ?? []), value as Cue];
      return;
    case 'macros':
      inverse.upserts.macros = [...(inverse.upserts.macros ?? []), value as Macro];
      return;
    case 'triggerBindings':
      inverse.upserts.triggerBindings = [...(inverse.upserts.triggerBindings ?? []), value as TriggerBinding];
      return;
  }
}

function appendInverseDelete(inverse: SnapshotPatch, key: SnapshotTableKey, id: Id): void {
  switch (key) {
    case 'presentations':
      inverse.deletes.presentations = [...(inverse.deletes.presentations ?? []), id];
      return;
    case 'lyrics':
      inverse.deletes.lyrics = [...(inverse.deletes.lyrics ?? []), id];
      return;
    case 'talks':
      inverse.deletes.talks = [...(inverse.deletes.talks ?? []), id];
      return;
    case 'slides':
      inverse.deletes.slides = [...(inverse.deletes.slides ?? []), id];
      return;
    case 'talkScriptBlocks':
      inverse.deletes.talkScriptBlocks = [...(inverse.deletes.talkScriptBlocks ?? []), id];
      return;
    case 'slideElements':
      inverse.deletes.slideElements = [...(inverse.deletes.slideElements ?? []), id];
      return;
    case 'mediaAssets':
      inverse.deletes.mediaAssets = [...(inverse.deletes.mediaAssets ?? []), id];
      return;
    case 'overlays':
      inverse.deletes.overlays = [...(inverse.deletes.overlays ?? []), id];
      return;
    case 'presentationThemes':
      inverse.deletes.presentationThemes = [...(inverse.deletes.presentationThemes ?? []), id];
      return;
    case 'lyricThemes':
      inverse.deletes.lyricThemes = [...(inverse.deletes.lyricThemes ?? []), id];
      return;
    case 'talkThemes':
      inverse.deletes.talkThemes = [...(inverse.deletes.talkThemes ?? []), id];
      return;
    case 'overlayThemes':
      inverse.deletes.overlayThemes = [...(inverse.deletes.overlayThemes ?? []), id];
      return;
    case 'stages':
      inverse.deletes.stages = [...(inverse.deletes.stages ?? []), id];
      return;
    case 'playlists':
      inverse.deletes.playlists = [...(inverse.deletes.playlists ?? []), id];
      return;
    case 'playlistEntries':
      inverse.deletes.playlistEntries = [...(inverse.deletes.playlistEntries ?? []), id];
      return;
    case 'cues':
      inverse.deletes.cues = [...(inverse.deletes.cues ?? []), id];
      return;
    case 'macros':
      inverse.deletes.macros = [...(inverse.deletes.macros ?? []), id];
      return;
    case 'triggerBindings':
      inverse.deletes.triggerBindings = [...(inverse.deletes.triggerBindings ?? []), id];
      return;
  }
}

export function isSnapshotPatch(value: unknown): value is SnapshotPatch {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as SnapshotPatch;
  return typeof candidate.version === 'number'
    && typeof candidate.upserts === 'object'
    && typeof candidate.deletes === 'object';
}
