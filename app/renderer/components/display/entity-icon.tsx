import type { MediaAsset, MediaAssetType } from '@lumacast/composition';
import { Film, Image, Mic } from 'lucide-react';

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

export { ItemIcon } from './item-icon';
