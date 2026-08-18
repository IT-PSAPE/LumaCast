import type { ItemRef, ItemType, MediaAsset, MediaAssetType } from '@lumacast/composition';
import { FileText, Film, Image, Mic, Music, Presentation } from 'lucide-react';

// ─── Media Asset Icon ────────────────────────────────

interface MediaAssetIconProps {
  asset: Pick<MediaAsset, 'type'> | MediaAssetType;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function MediaAssetIcon({ asset, size = 14, strokeWidth = 1.75, className = '' }: MediaAssetIconProps) {
  const type = typeof asset === 'string' ? asset : asset.type;

  if (type === 'image') {
    return <Image size={size} strokeWidth={strokeWidth} className={className} />;
  }

  if (type === 'audio') {
    return <Mic size={size} strokeWidth={strokeWidth} className={className} />;
  }

  return <Film size={size} strokeWidth={strokeWidth} className={className} />;
}

// ─── Content Item Icon ───────────────────────────────

interface ItemIconProps {
  entity: Pick<ItemRef, 'type'> | ItemType;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function ItemIcon({ entity, size = 14, strokeWidth = 1.75, className = '' }: ItemIconProps) {
  const entityType = typeof entity === 'string' ? entity : entity.type;

  if (entityType === 'lyric') {
    return <Music size={size} strokeWidth={strokeWidth} className={className} />;
  }
  if (entityType === 'talk') {
    return <FileText size={size} strokeWidth={strokeWidth} className={className} />;
  }

  return <Presentation size={size} strokeWidth={strokeWidth} className={className} />;
}
