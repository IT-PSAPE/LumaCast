import type { Id } from '@lumacast/kernel';
import type { Playlist } from '@lumacast/composition';
import type { ExportableItem } from './use-deck-import-export';

export interface ItemRow {
  kind: 'item';
  id: Id;
  title: string;
  item: ExportableItem;
}

export interface PlaylistRow {
  kind: 'playlist';
  id: Id;
  title: string;
  playlist: Playlist;
}

export type Row = ItemRow | PlaylistRow;

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
