import type { DeckItem, DeckItemType, Presentation, Lyric, PlaylistEntry, Slide } from './types';

interface DeckItemInput {
  id: string;
  title: string;
  type: DeckItemType;
  themeId?: string | null;
  collectionId: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export function buildDeckItem({ id, title, type, themeId = null, collectionId, order, createdAt, updatedAt }: DeckItemInput): DeckItem {
  if (type === 'lyric') {
    return {
      id,
      title,
      type,
      themeId,
      collectionId,
      order,
      createdAt,
      updatedAt,
    };
  }

  return {
    id,
    title,
    type,
    themeId,
    collectionId,
    order,
    createdAt,
    updatedAt,
  };
}

export function isLyricDeckItem(item: DeckItem | null | undefined): item is Lyric {
  return item?.type === 'lyric';
}

export function isPresentationDeckItem(item: DeckItem | null | undefined): item is Presentation {
  return item?.type === 'presentation';
}

export function getDeckItemLabel(item: Pick<DeckItem, 'type'> | DeckItemType): 'Presentation' | 'Lyric' {
  const type = typeof item === 'string' ? item : item.type;
  return type === 'lyric' ? 'Lyric' : 'Presentation';
}

export function getSlideDeckItemId(slide: Pick<Slide, 'presentationId' | 'lyricId'>): string | null {
  return slide.presentationId ?? slide.lyricId ?? null;
}

export function getSlideDeckItemType(slide: Pick<Slide, 'presentationId' | 'lyricId'>): DeckItemType | null {
  if (slide.presentationId) return 'presentation';
  if (slide.lyricId) return 'lyric';
  return null;
}

export function getPlaylistEntryDeckItemId(entry: Pick<PlaylistEntry, 'presentationId' | 'lyricId'>): string | null {
  return entry.presentationId ?? entry.lyricId ?? null;
}

export function getPlaylistEntryDeckItemType(entry: Pick<PlaylistEntry, 'presentationId' | 'lyricId'>): DeckItemType | null {
  if (entry.presentationId) return 'presentation';
  if (entry.lyricId) return 'lyric';
  return null;
}
