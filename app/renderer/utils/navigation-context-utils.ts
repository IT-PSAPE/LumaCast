import { getPlaylistEntryItemRef } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, PlaylistItemEntry, PlaylistRow } from '@lumacast/composition';

// #219 item-model refactor decision D9: no `PlaylistTree.groups` to walk —
// a playlist's `rows` are already a flat, ordered list. These helpers walk
// that flat list directly (separators included), discriminating on
// `row.kind` before ever touching item-only fields — never after.

export function itemRefsEqual(left: ItemRef | null, right: ItemRef | null): boolean {
  if (!left || !right) return left === right;
  return left.type === right.type && left.id === right.id;
}

interface PlaylistRowLookup {
  rowId: Id;
  itemRef: ItemRef;
}

function isItemRow(row: PlaylistRow): row is PlaylistItemEntry {
  return row.kind === 'item';
}

export function findPlaylistRowById(rows: PlaylistRow[], rowId: Id | null): PlaylistRowLookup | null {
  if (!rowId) return null;

  for (const row of rows) {
    if (row.id !== rowId || !isItemRow(row)) continue;
    return { rowId: row.id, itemRef: getPlaylistEntryItemRef(row) };
  }

  return null;
}

export function findFirstPlaylistRowByItemRef(rows: PlaylistRow[], itemRef: ItemRef | null): PlaylistRowLookup | null {
  if (!itemRef) return null;

  for (const row of rows) {
    if (!isItemRow(row)) continue;
    const rowRef = getPlaylistEntryItemRef(row);
    if (rowRef.type === itemRef.type && rowRef.id === itemRef.id) return { rowId: row.id, itemRef: rowRef };
  }

  return null;
}

export function resolveCurrentItemRef(currentItemRef: ItemRef | null, itemExists: (ref: ItemRef) => boolean): ItemRef | null {
  if (!currentItemRef) return null;
  return itemExists(currentItemRef) ? currentItemRef : null;
}

export function resolveCurrentPlaylistItemRef(currentItemRef: ItemRef | null, rows: PlaylistRow[]): ItemRef | null {
  if (!currentItemRef) return null;
  return findFirstPlaylistRowByItemRef(rows, currentItemRef) ? currentItemRef : null;
}

export function resolveCurrentPlaylistRowId(
  currentRowId: Id | null,
  rows: PlaylistRow[],
  currentItemRef: ItemRef | null,
): Id | null {
  const matchingRow = findPlaylistRowById(rows, currentRowId);
  if (matchingRow && itemRefsEqual(matchingRow.itemRef, currentItemRef)) return matchingRow.rowId;
  return findFirstPlaylistRowByItemRef(rows, currentItemRef)?.rowId ?? null;
}

/**
 * Pins a lyric selection across playlist changes (a lyric can be browsed
 * independent of which playlist row currently references it); any other
 * item type must resolve against the current playlist's own rows.
 */
export function resolvePinnedLyricItemRef(
  currentItemRef: ItemRef | null,
  rows: PlaylistRow[],
  itemExists: (ref: ItemRef) => boolean,
): ItemRef | null {
  if (currentItemRef && currentItemRef.type === 'lyric' && itemExists(currentItemRef)) {
    return currentItemRef;
  }

  return resolveCurrentPlaylistItemRef(currentItemRef, rows);
}

export function extractPlaylistItemRefs(rows: PlaylistRow[]): ItemRef[] {
  const refs: ItemRef[] = [];
  for (const row of rows) {
    if (!isItemRow(row)) continue;
    refs.push(getPlaylistEntryItemRef(row));
  }
  return refs;
}

/** Item rows only, in playlist order — separators never count as a "next"/"previous" stop for output advance. */
function itemRowsOf(rows: PlaylistRow[]): PlaylistItemEntry[] {
  return rows.filter(isItemRow);
}

export function nextItemRow(rows: PlaylistRow[], currentRowId: Id | null): PlaylistRowLookup | null {
  const itemRows = itemRowsOf(rows);
  if (itemRows.length === 0) return null;

  if (!currentRowId) {
    const first = itemRows[0];
    return { rowId: first.id, itemRef: getPlaylistEntryItemRef(first) };
  }

  const index = itemRows.findIndex((row) => row.id === currentRowId);
  if (index === -1 || index >= itemRows.length - 1) return null;
  const next = itemRows[index + 1];
  return { rowId: next.id, itemRef: getPlaylistEntryItemRef(next) };
}

export function previousItemRow(rows: PlaylistRow[], currentRowId: Id | null): PlaylistRowLookup | null {
  const itemRows = itemRowsOf(rows);
  if (itemRows.length === 0 || !currentRowId) return null;

  const index = itemRows.findIndex((row) => row.id === currentRowId);
  if (index <= 0) return null;
  const previous = itemRows[index - 1];
  return { rowId: previous.id, itemRef: getPlaylistEntryItemRef(previous) };
}

export function findCreatedId(previousIds: Set<Id>, currentIds: Id[]): Id | null {
  for (const id of currentIds) {
    if (!previousIds.has(id)) return id;
  }

  return null;
}
