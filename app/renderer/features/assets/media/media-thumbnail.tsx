import { useEffect, useState } from 'react';
import type { MediaAsset } from '@lumacast/composition';
import { AlertTriangle } from 'lucide-react';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { useVideoPoster } from '../../../hooks/use-video-poster';

export function MediaThumbnail({ asset }: { asset: MediaAsset }) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const { posterSrc, status: posterStatus } = useVideoPoster(asset.type === 'video' ? asset.src : null);
  const isBroken = brokenSrc === asset.src;

  useEffect(() => {
    if (brokenSrc !== null && brokenSrc !== asset.src) {
      setBrokenSrc(null);
    }
  }, [asset.src, brokenSrc]);

  useEffect(() => {
    if (asset.type !== 'video' || posterStatus !== 'error') return;
    setBrokenSrc(asset.src);
  }, [asset.src, asset.type, posterStatus]);

  if (isBroken) {
    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-tertiary/80 text-tertiary">
        <AlertTriangle size={16} strokeWidth={1.75} />
        <span className="px-2 text-center text-xs uppercase tracking-wider">Missing source</span>
      </div>
    );
  }

  if (asset.type === 'image') {
    return (
      <img
        src={asset.src}
        alt={asset.name}
        loading="lazy"
        draggable={false}
        onError={() => setBrokenSrc(asset.src)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  if (asset.type === 'video') {
    if (posterSrc) {
      return (
        <img
          src={posterSrc}
          alt={asset.name}
          loading="lazy"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      );
    }
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-tertiary/45 text-tertiary">
        <MediaAssetIcon asset={asset} size={20} strokeWidth={1.75} />
      </div>
    );
  }
  return <span className="text-tertiary text-sm font-bold tracking-wider uppercase">{asset.type}</span>;
}
