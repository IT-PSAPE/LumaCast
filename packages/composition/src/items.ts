// Item helpers (#219 item-model refactor decision D1). The old deck-items.ts
// dissolved along with the DeckItem union: buildDeckItem and the
// is*DeckItem guards existed only to construct/narrow that union, and both
// die with it (a Presentation, Lyric, or Talk is just constructed directly
// wherever it's needed now). What survives is the small set of helpers that
// still earn their place once Presentation/Lyric/Talk are independent: ways
// to recover a typed ItemRef from the tri-column owner encoding that Slide
// and PlaylistItemEntry carry, and a label lookup keyed on ItemType alone.
import type { ItemRef, ItemType } from './domain/items';
import type { PlaylistItemEntry } from './domain/playlists';
import type { Slide } from './domain/slides';

/**
 * Resolves a slide's owning item from its exclusive-arc owner columns.
 * Deliberately an explicit if-chain, not a `??` chain: a `??` chain here
 * would silently prefer presentationId over a stray talkId, which is
 * exactly the class of bug parsePlaylistItemReference's owner-column
 * validation exists to catch on the playlist-entry side.
 */
export function getSlideItemRef(slide: Pick<Slide, 'presentationId' | 'lyricId' | 'talkId'>): ItemRef | null {
  if (slide.presentationId) return { type: 'presentation', id: slide.presentationId };
  if (slide.lyricId) return { type: 'lyric', id: slide.lyricId };
  if (slide.talkId) return { type: 'talk', id: slide.talkId };
  return null;
}

/** Resolves a playlist item entry's referenced item as a typed ItemRef. */
export function getPlaylistEntryItemRef(entry: Pick<PlaylistItemEntry, 'reference'>): ItemRef {
  return { type: entry.reference.type, id: entry.reference.itemId };
}

export function getItemTypeLabel(type: ItemType): 'Presentation' | 'Lyric' | 'Talk' {
  if (type === 'talk') return 'Talk';
  return type === 'lyric' ? 'Lyric' : 'Presentation';
}
