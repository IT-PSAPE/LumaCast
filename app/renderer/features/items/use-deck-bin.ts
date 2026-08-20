import { useMemo, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, ItemType, Lyric, Presentation, Talk } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { itemRefKey, useProjectContent } from '../../contexts/use-project-content';
import { filterByText } from '../../utils/filter-by-text';
import { useDeckBinSort, compareByKey, type BinSort, type DeckBinSortKey } from '../workbench/use-bin-sort';
import { useBinControls } from '@renderer/components/controls/bin-controls';

// #219 item-model refactor decision D9: the bin shows three independently-
// ordered sections (Presentations / Lyrics / Talks), each filtered/sorted
// from its own per-type array — there is no merged deckItems list to sort
// across types, and each section's own manual order comes straight from its
// table's order_index (movePresentation/moveLyric/moveTalk act within it).
export interface ItemBinSection<T> {
  type: ItemType;
  label: string;
  items: T[];
}

export function useDeckBin() {
  const {
    currentDrawerItemRef,
    browseItem,
    isDetachedDeckBrowser,
    renameItem,
    moveItem,
  } = useNavigation();
  const { presentations, lyrics, talks, slidesByItem } = useProjectContent();
  const [editingItemRef, setEditingItemRef] = useState<ItemRef | null>(null);
  const { sort } = useDeckBinSort();
  const { state: { searchValue } } = useBinControls();

  const filteredPresentations = useMemo(
    () => filterAndSort(presentations, 'presentation', searchValue, sort, slidesByItem),
    [presentations, searchValue, slidesByItem, sort],
  );
  const filteredLyrics = useMemo(
    () => filterAndSort(lyrics, 'lyric', searchValue, sort, slidesByItem),
    [lyrics, searchValue, slidesByItem, sort],
  );
  const filteredTalks = useMemo(
    () => filterAndSort(talks, 'talk', searchValue, sort, slidesByItem),
    [talks, searchValue, slidesByItem, sort],
  );

  const sections = useMemo<[ItemBinSection<Presentation>, ItemBinSection<Lyric>, ItemBinSection<Talk>]>(() => [
    { type: 'presentation', label: 'Presentations', items: filteredPresentations },
    { type: 'lyric', label: 'Lyrics', items: filteredLyrics },
    { type: 'talk', label: 'Talks', items: filteredTalks },
  ], [filteredPresentations, filteredLyrics, filteredTalks]);

  function handleRename(itemRef: ItemRef, title: string) {
    // renameItem rejects when the item no longer exists (#214), which a
    // rename field commit can race with a concurrent delete. mutatePatch has
    // already reported the failure, so absorb the rethrow here.
    void renameItem(itemRef, title).catch(() => undefined);
    setEditingItemRef(null);
  }

  function handleMove(itemRef: ItemRef, direction: 'up' | 'down') {
    // moveItem → movePresentation/moveLyric/moveTalk rejects when the item no
    // longer exists (#214), which a context-menu action can race with a
    // concurrent delete. mutatePatch has already reported the failure, so
    // absorb the rethrow here.
    void moveItem(itemRef, direction).catch(() => undefined);
  }

  return {
    sections,
    editingItemRef,
    browseItem,
    isDetachedDeckBrowser,
    currentDrawerItemRef,
    handleRename,
    handleMove,
    slidesByItem,
  };
}

function filterAndSort<T extends { id: Id; title: string; createdAt: string; updatedAt: string }>(
  items: T[],
  type: ItemType,
  searchValue: string,
  sort: BinSort<DeckBinSortKey>,
  slidesByItem: ReadonlyMap<string, unknown[]>,
): T[] {
  const filtered = filterByText(items, searchValue, (item) => {
    const slides = slidesByItem.get(itemRefKey({ type, id: item.id })) ?? [];
    const slideLabels = slides.map((_slide, index) => `slide ${index + 1}`);
    return [item.title, type, ...slideLabels];
  });

  const direction = sort.direction === 'asc' ? 1 : -1;
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (sort.key === 'slides') {
      const aCount = slidesByItem.get(itemRefKey({ type, id: a.id }))?.length ?? 0;
      const bCount = slidesByItem.get(itemRefKey({ type, id: b.id }))?.length ?? 0;
      return direction * (aCount - bCount);
    }
    return direction * compareByKey(a, b, sort.key, (item) => item.title);
  });
  return sorted;
}
