import type { DeckItem, DeckItemType, Presentation, Lyric, Talk, PlaylistEntry, Slide } from './types';

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

export function isTalkDeckItem(item: DeckItem | null | undefined): item is Talk {
  return item?.type === 'talk';
}

export function isPresentationLikeDeckItem(item: DeckItem | null | undefined): item is Presentation | Talk {
  return item?.type === 'presentation' || item?.type === 'talk';
}

export function getDeckItemLabel(item: Pick<DeckItem, 'type'> | DeckItemType): 'Presentation' | 'Lyric' | 'Talk' {
  const type = typeof item === 'string' ? item : item.type;
  if (type === 'talk') return 'Talk';
  return type === 'lyric' ? 'Lyric' : 'Presentation';
}

export function getSlideDeckItemId(slide: Pick<Slide, 'presentationId' | 'lyricId' | 'talkId'>): string | null {
  return slide.presentationId ?? slide.lyricId ?? slide.talkId ?? null;
}

export function getSlideDeckItemType(slide: Pick<Slide, 'presentationId' | 'lyricId' | 'talkId'>): DeckItemType | null {
  if (slide.presentationId) return 'presentation';
  if (slide.lyricId) return 'lyric';
  if (slide.talkId) return 'talk';
  return null;
}

export function getPlaylistEntryDeckItemId(entry: Pick<PlaylistEntry, 'presentationId' | 'lyricId' | 'talkId'>): string | null {
  return entry.presentationId ?? entry.lyricId ?? entry.talkId ?? null;
}

export function getPlaylistEntryDeckItemType(entry: Pick<PlaylistEntry, 'presentationId' | 'lyricId' | 'talkId'>): DeckItemType | null {
  if (entry.presentationId) return 'presentation';
  if (entry.lyricId) return 'lyric';
  if (entry.talkId) return 'talk';
  return null;
}
