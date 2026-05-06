import { useMemo } from 'react';
import type { DeckItem, Id, PlaylistTree, Slide } from '@core/types';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';

export interface PlaylistDeckSequenceItem {
  entryId: Id;
  item: DeckItem;
  slides: Slide[];
  occurrenceIndex: number;
}

interface PlaylistDeckSequence {
  selectedTree: PlaylistTree | null;
  items: PlaylistDeckSequenceItem[];
}

export function flattenPlaylistDeckSequence(
  selectedTree: PlaylistTree | null,
  slidesByDeckItemId: ReadonlyMap<Id, Slide[]>,
): PlaylistDeckSequenceItem[] {
  if (!selectedTree) return [];
  const countsByDeckItemId = new Map<Id, number>();
  const flattened: PlaylistDeckSequenceItem[] = [];

  for (const group of selectedTree.groups) {
    for (const entry of group.entries) {
      const currentCount = countsByDeckItemId.get(entry.item.id) ?? 0;
      const occurrenceIndex = currentCount + 1;
      countsByDeckItemId.set(entry.item.id, occurrenceIndex);
      flattened.push({
        entryId: entry.entry.id,
        item: entry.item,
        slides: slidesByDeckItemId.get(entry.item.id) ?? [],
        occurrenceIndex,
      });
    }
  }

  return flattened;
}

export function usePlaylistDeckSequence(): PlaylistDeckSequence {
  const { currentLibraryBundle, currentPlaylistId } = useNavigation();
  const { slidesByDeckItemId } = useProjectContent();

  const selectedTree = useMemo(() => {
    if (!currentLibraryBundle || !currentPlaylistId) return null;
    return currentLibraryBundle.playlists.find((tree) => tree.playlist.id === currentPlaylistId) ?? null;
  }, [currentLibraryBundle, currentPlaylistId]);

  const items = useMemo(() => flattenPlaylistDeckSequence(selectedTree, slidesByDeckItemId), [selectedTree, slidesByDeckItemId]);

  return { selectedTree, items };
}
