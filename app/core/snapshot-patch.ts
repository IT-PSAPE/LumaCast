import type { AppSnapshot, Collection, Id, LibraryPlaylistBundle, Library, Lyric, MediaAsset, Overlay, Presentation, Slide, SlideElement, Stage, Theme } from './types';

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
 * `libraryBundles` is a derived structure. When it appears in a patch
 * it is a full replacement (rebuilt main-side from the underlying
 * libraries/playlists/segments/entries).
 */
export interface SnapshotPatch {
  version: number;
  upserts: {
    libraries?: Library[];
    presentations?: Presentation[];
    lyrics?: Lyric[];
    slides?: Slide[];
    slideElements?: SlideElement[];
    mediaAssets?: MediaAsset[];
    overlays?: Overlay[];
    themes?: Theme[];
    stages?: Stage[];
    collections?: Collection[];
    libraryBundles?: LibraryPlaylistBundle[];
  };
  deletes: {
    libraries?: Id[];
    presentations?: Id[];
    lyrics?: Id[];
    slides?: Id[];
    slideElements?: Id[];
    mediaAssets?: Id[];
    overlays?: Id[];
    themes?: Id[];
    stages?: Id[];
    collections?: Id[];
  };
}

type SnapshotTableKey =
  | 'libraries'
  | 'presentations'
  | 'lyrics'
  | 'slides'
  | 'slideElements'
  | 'mediaAssets'
  | 'overlays'
  | 'themes'
  | 'stages'
  | 'collections';

type SnapshotTableRecordMap = {
  libraries: Library;
  presentations: Presentation;
  lyrics: Lyric;
  slides: Slide;
  slideElements: SlideElement;
  mediaAssets: MediaAsset;
  overlays: Overlay;
  themes: Theme;
  stages: Stage;
  collections: Collection;
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
    libraries: mergeTable(snapshot.libraries, patch.upserts.libraries, patch.deletes.libraries),
    presentations: mergeTable(snapshot.presentations, patch.upserts.presentations, patch.deletes.presentations),
    lyrics: mergeTable(snapshot.lyrics, patch.upserts.lyrics, patch.deletes.lyrics),
    slides: mergeTable(snapshot.slides, patch.upserts.slides, patch.deletes.slides),
    slideElements: mergeTable(snapshot.slideElements, patch.upserts.slideElements, patch.deletes.slideElements),
    mediaAssets: mergeTable(snapshot.mediaAssets, patch.upserts.mediaAssets, patch.deletes.mediaAssets),
    overlays: mergeTable(snapshot.overlays, patch.upserts.overlays, patch.deletes.overlays),
    themes: mergeTable(snapshot.themes, patch.upserts.themes, patch.deletes.themes),
    stages: mergeTable(snapshot.stages, patch.upserts.stages, patch.deletes.stages),
    collections: mergeTable(snapshot.collections, patch.upserts.collections, patch.deletes.collections),
    libraryBundles: patch.upserts.libraryBundles ?? snapshot.libraryBundles,
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

  invertTable(snapshot.libraries, patch.upserts.libraries, patch.deletes.libraries, inverse, 'libraries');
  invertTable(snapshot.presentations, patch.upserts.presentations, patch.deletes.presentations, inverse, 'presentations');
  invertTable(snapshot.lyrics, patch.upserts.lyrics, patch.deletes.lyrics, inverse, 'lyrics');
  invertTable(snapshot.slides, patch.upserts.slides, patch.deletes.slides, inverse, 'slides');
  invertTable(snapshot.slideElements, patch.upserts.slideElements, patch.deletes.slideElements, inverse, 'slideElements');
  invertTable(snapshot.mediaAssets, patch.upserts.mediaAssets, patch.deletes.mediaAssets, inverse, 'mediaAssets');
  invertTable(snapshot.overlays, patch.upserts.overlays, patch.deletes.overlays, inverse, 'overlays');
  invertTable(snapshot.themes, patch.upserts.themes, patch.deletes.themes, inverse, 'themes');
  invertTable(snapshot.stages, patch.upserts.stages, patch.deletes.stages, inverse, 'stages');
  invertTable(snapshot.collections, patch.upserts.collections, patch.deletes.collections, inverse, 'collections');

  if (patch.upserts.libraryBundles) {
    inverse.upserts.libraryBundles = snapshot.libraryBundles;
  }

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
    case 'libraries':
      inverse.upserts.libraries = [...(inverse.upserts.libraries ?? []), value as Library];
      return;
    case 'presentations':
      inverse.upserts.presentations = [...(inverse.upserts.presentations ?? []), value as Presentation];
      return;
    case 'lyrics':
      inverse.upserts.lyrics = [...(inverse.upserts.lyrics ?? []), value as Lyric];
      return;
    case 'slides':
      inverse.upserts.slides = [...(inverse.upserts.slides ?? []), value as Slide];
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
    case 'themes':
      inverse.upserts.themes = [...(inverse.upserts.themes ?? []), value as Theme];
      return;
    case 'stages':
      inverse.upserts.stages = [...(inverse.upserts.stages ?? []), value as Stage];
      return;
  }
}

function appendInverseDelete(inverse: SnapshotPatch, key: SnapshotTableKey, id: Id): void {
  switch (key) {
    case 'libraries':
      inverse.deletes.libraries = [...(inverse.deletes.libraries ?? []), id];
      return;
    case 'presentations':
      inverse.deletes.presentations = [...(inverse.deletes.presentations ?? []), id];
      return;
    case 'lyrics':
      inverse.deletes.lyrics = [...(inverse.deletes.lyrics ?? []), id];
      return;
    case 'slides':
      inverse.deletes.slides = [...(inverse.deletes.slides ?? []), id];
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
    case 'themes':
      inverse.deletes.themes = [...(inverse.deletes.themes ?? []), id];
      return;
    case 'stages':
      inverse.deletes.stages = [...(inverse.deletes.stages ?? []), id];
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
