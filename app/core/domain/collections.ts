// Domain primitives (#153, split from app/core/types.ts): the collection
// entity (a per-bin folder) and the item-type discriminant used to assign
// items into one. Mutation input shapes (CollectionCreateInput and friends)
// are application contracts, not domain primitives, and stay in
// app/core/types.ts pending #154.
import type { Id } from './ids';

export type CollectionBinKind = 'deck' | 'image' | 'video' | 'audio' | 'theme' | 'overlay' | 'stage' | 'macro';

export interface Collection {
  id: Id;
  binKind: CollectionBinKind;
  name: string;
  order: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CollectionItemType =
  | 'presentation'
  | 'lyric'
  | 'talk'
  | 'media_asset'
  | 'theme'
  | 'overlay'
  | 'stage'
  | 'macro';
