import { isLyricDeckItem } from '@core/deck-items';
import type { DeckItem, Id, PlaylistTree } from '@core/types';

interface PlaylistEntryLookup {
  entryId: Id;
  itemId: Id;
}

export function resolveCurrentDeckItemId(currentDeckItemId: Id | null, itemIds: Iterable<Id>): Id | null {
  if (!currentDeckItemId) return null;

  for (const itemId of itemIds) {
    if (itemId === currentDeckItemId) return currentDeckItemId;
  }

  return null;
}

export function resolveCurrentPlaylistDeckItemId(currentDeckItemId: Id | null, selectedTree: PlaylistTree | null): Id | null {
  const itemIds = extractPlaylistDeckItemIds(selectedTree);
  if (!currentDeckItemId) return null;
  if (itemIds.includes(currentDeckItemId)) return currentDeckItemId;
  return null;
}

export function findPlaylistEntryById(selectedTree: PlaylistTree | null, entryId: Id | null): PlaylistEntryLookup | null {
  if (!selectedTree || !entryId) return null;

  for (const group of selectedTree.groups) {
    for (const entry of group.entries) {
      if (entry.entry.id === entryId) {
        return { entryId: entry.entry.id, itemId: entry.item.id };
      }
    }
  }

  return null;
}

export function findFirstPlaylistEntryByDeckItemId(selectedTree: PlaylistTree | null, deckItemId: Id | null): PlaylistEntryLookup | null {
  if (!selectedTree || !deckItemId) return null;

  for (const group of selectedTree.groups) {
    for (const entry of group.entries) {
      if (entry.item.id === deckItemId) {
        return { entryId: entry.entry.id, itemId: entry.item.id };
      }
    }
  }

  return null;
}

export function resolveCurrentPlaylistEntryId(
  currentEntryId: Id | null,
  selectedTree: PlaylistTree | null,
  currentDeckItemId: Id | null,
): Id | null {
  const matchingEntry = findPlaylistEntryById(selectedTree, currentEntryId);
  if (matchingEntry && matchingEntry.itemId === currentDeckItemId) return matchingEntry.entryId;
  return findFirstPlaylistEntryByDeckItemId(selectedTree, currentDeckItemId)?.entryId ?? null;
}

export function resolvePinnedLyricDeckItemId(
  currentDeckItemId: Id | null,
  selectedTree: PlaylistTree | null,
  deckItemsById: ReadonlyMap<Id, DeckItem>,
): Id | null {
  if (currentDeckItemId && isLyricDeckItem(deckItemsById.get(currentDeckItemId) ?? null)) {
    return resolveCurrentDeckItemId(currentDeckItemId, deckItemsById.keys());
  }

  return resolveCurrentPlaylistDeckItemId(currentDeckItemId, selectedTree);
}

export function extractPlaylistDeckItemIds(selectedTree: PlaylistTree | null): Id[] {
  if (!selectedTree) return [];

  const itemIds: Id[] = [];
  for (const group of selectedTree.groups) {
    for (const entry of group.entries) {
      itemIds.push(entry.item.id);
    }
  }

  return itemIds;
}

export function findCreatedId(previousIds: Set<Id>, currentIds: Id[]): Id | null {
  for (const id of currentIds) {
    if (!previousIds.has(id)) return id;
  }

  return null;
}
