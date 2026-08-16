import type {
  DeckBundleItem,
  DeckBundleManifest,
  DeckBundleMediaReference,
  DeckBundleOverlay,
  DeckBundlePlaylist,
  DeckBundlePlaylistEntry,
  DeckBundleStage,
  DeckBundleTheme,
  Id,
  SlideElement,
} from './types';
import {
  parsePlaylistItemReference,
  type PlaylistItemReference,
} from './playlist-item-reference';

interface MediaReferenceAccumulator {
  elementTypes: Set<'image' | 'video'>;
  occurrenceCount: number;
}

export function cloneDeckBundleManifest(manifest: DeckBundleManifest): DeckBundleManifest {
  return JSON.parse(JSON.stringify(manifest)) as DeckBundleManifest;
}

export function readElementMediaReference(element: SlideElement): { source: string; elementType: 'image' | 'video' } | null {
  if (element.type !== 'image' && element.type !== 'video') return null;
  const source = typeof (element.payload as { src?: string })?.src === 'string'
    ? (element.payload as { src: string }).src
    : '';
  if (!source) return null;
  return { source, elementType: element.type };
}

export function collectDeckBundleMediaReferences(
  items: DeckBundleItem[],
  themes: DeckBundleTheme[],
  overlays: DeckBundleOverlay[] = [],
  stages: DeckBundleStage[] = [],
): DeckBundleMediaReference[] {
  const references = new Map<string, MediaReferenceAccumulator>();

  function collect(elements: SlideElement[]) {
    for (const element of elements) {
      const reference = readElementMediaReference(element);
      if (!reference) continue;
      const current = references.get(reference.source) ?? {
        elementTypes: new Set<'image' | 'video'>(),
        occurrenceCount: 0,
      };
      current.elementTypes.add(reference.elementType);
      current.occurrenceCount += 1;
      references.set(reference.source, current);
    }
  }

  for (const item of items) {
    for (const slide of item.slides) {
      collect(slide.elements);
    }
  }

  for (const theme of themes) {
    collect(theme.elements);
  }

  for (const overlay of overlays) {
    collect(overlay.elements);
  }

  for (const stage of stages) {
    collect(stage.elements);
  }

  return Array.from(references.entries())
    .map(([source, reference]) => ({
      source,
      elementTypes: Array.from(reference.elementTypes).sort(),
      occurrenceCount: reference.occurrenceCount,
    }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

export function normalizeDeckBundleManifest(manifest: DeckBundleManifest): DeckBundleManifest {
  return {
    ...manifest,
    mediaReferences: collectDeckBundleMediaReferences(
      manifest.items,
      manifest.themes,
      manifest.overlays ?? [],
      manifest.stages ?? [],
    ),
  };
}

/**
 * Parses a bundle playlist entry's legacy owner columns into the canonical
 * reference, rejecting entries with zero or multiple populated owners. This
 * is the single interpretation point for `DeckBundlePlaylistEntry` — callers
 * must not re-derive the referenced item id with an inline `??` chain, which
 * previously dropped Talk entries whenever the chain stopped short of
 * `talkId`.
 */
export function getDeckBundlePlaylistEntryReference(entry: DeckBundlePlaylistEntry): PlaylistItemReference {
  return parsePlaylistItemReference(
    { presentationId: entry.presentationId, lyricId: entry.lyricId, talkId: entry.talkId ?? null },
    `playlist entry ${entry.id}`,
  );
}

/** Collects every distinct item id referenced by any entry across the given playlists. */
export function collectDeckBundlePlaylistItemIds(playlists: DeckBundlePlaylist[]): Set<Id> {
  const ids = new Set<Id>();
  for (const playlist of playlists) {
    for (const group of playlist.groups) {
      for (const entry of group.entries) {
        ids.add(getDeckBundlePlaylistEntryReference(entry).itemId);
      }
    }
  }
  return ids;
}

/** Filters each playlist's entries down to those referencing an included item id, preserving entry and group identity/order. */
export function filterDeckBundlePlaylistsToIncludedItems(
  playlists: DeckBundlePlaylist[],
  includedItemIds: ReadonlySet<Id>,
): DeckBundlePlaylist[] {
  return playlists.map((playlist) => ({
    ...playlist,
    groups: playlist.groups.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) =>
        includedItemIds.has(getDeckBundlePlaylistEntryReference(entry).itemId),
      ),
    })),
  }));
}
