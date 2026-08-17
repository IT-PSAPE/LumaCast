// Domain primitives (#153, split from app/core/types.ts): deck item family
// (presentation / lyric / talk) and its shared kind discriminant.
import type { Id } from './ids';

export type DeckItemType = 'presentation' | 'lyric' | 'talk';

interface DeckItemBase {
  id: Id;
  title: string;
  themeId?: Id | null;
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Presentation extends DeckItemBase {
  type: 'presentation';
}

export interface Lyric extends DeckItemBase {
  type: 'lyric';
}

export interface Talk extends DeckItemBase {
  type: 'talk';
}

export type DeckItem = Presentation | Lyric | Talk;
