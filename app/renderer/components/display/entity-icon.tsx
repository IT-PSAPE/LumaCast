import type { MediaAsset, MediaAssetType, DeckItem, DeckItemType } from '@core/types';
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

interface DeckItemIconProps {
  entity: Pick<DeckItem, 'type'> | DeckItemType;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function DeckItemIcon({ entity, size = 14, strokeWidth = 1.75, className = '' }: DeckItemIconProps) {
  const entityType = typeof entity === 'string' ? entity : entity.type;

  if (entityType === 'lyric') {
    return <Music size={size} strokeWidth={strokeWidth} className={className} />;
  }
  if (entityType === 'talk') {
    return <FileText size={size} strokeWidth={strokeWidth} className={className} />;
  }

  return <Presentation size={size} strokeWidth={strokeWidth} className={className} />;
}
