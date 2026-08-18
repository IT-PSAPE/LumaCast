import { useMemo } from 'react';
import { getPlaylistEntryItemRef } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, Lyric, Presentation, PlaylistRow, Slide, Talk } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';

export interface PlaylistDeckSequenceItem {
  entryId: Id;
  itemRef: ItemRef;
  item: Presentation | Lyric | Talk;
  slides: Slide[];
  occurrenceIndex: number;
}

// #219 item-model refactor decision D5/D9: a playlist's rows are already
// flat — this walks them directly, skipping separator rows (they are never
// an output-advance stop and never occupy a slot in the continuous browser's
// sequence), instead of flattening PlaylistTree.groups.
export function flattenPlaylistDeckSequence(
  rows: PlaylistRow[],
  resolveItemRef: (ref: ItemRef) => Presentation | Lyric | Talk | null,
  slidesForItemRef: (ref: ItemRef) => Slide[],
): PlaylistDeckSequenceItem[] {
  const countsByKey = new Map<string, number>();
  const flattened: PlaylistDeckSequenceItem[] = [];

  for (const row of rows) {
    if (row.kind !== 'item') continue;
    const itemRef = getPlaylistEntryItemRef(row);
    const item = resolveItemRef(itemRef);
    if (!item) continue;

    const key = `${itemRef.type}:${itemRef.id}`;
    const occurrenceIndex = (countsByKey.get(key) ?? 0) + 1;
    countsByKey.set(key, occurrenceIndex);

    flattened.push({
      entryId: row.id,
      itemRef,
      item,
      slides: slidesForItemRef(itemRef),
      occurrenceIndex,
    });
  }

  return flattened;
}

export function usePlaylistDeckSequence(): { items: PlaylistDeckSequenceItem[] } {
  const { currentPlaylistRows } = useNavigation();
  const { resolveItemRef, slidesForItemRef } = useProjectContent();

  const items = useMemo(
    () => flattenPlaylistDeckSequence(currentPlaylistRows, resolveItemRef, slidesForItemRef),
    [currentPlaylistRows, resolveItemRef, slidesForItemRef],
  );

  return { items };
}
