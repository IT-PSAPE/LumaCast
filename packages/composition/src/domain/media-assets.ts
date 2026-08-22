// Domain primitive (#153, split from app/core/types.ts): the media-asset
// entity (image / video / audio) owned by the media bins.
import type { Id } from '@lumacast/kernel';

export type MediaAssetType = 'image' | 'video' | 'audio';

export interface MediaAsset {
  id: Id;
  name: string;
  type: MediaAssetType;
  src: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
  thumbnailSrc?: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}
