import { useVideoPoster } from '../../hooks/use-video-poster';
import { Film } from 'lucide-react';
import type { MediaAsset } from '@lumacast/composition';

export function MediaThumbnail({ asset }: { asset: MediaAsset }) {
  const { posterSrc } = useVideoPoster(asset.type === 'video' ? asset.src : null);
  if (asset.type === 'image') {
    return <img src={asset.src} alt={asset.name} loading="lazy" draggable={false} className="block h-full w-full object-cover" />;
  }
  if (asset.type === 'video') {
    if (posterSrc) {
      return <img src={posterSrc} alt={asset.name} loading="lazy" draggable={false} className="block h-full w-full object-cover" />;
    }
    return (
      <div className="flex h-full w-full items-center justify-center bg-secondary/40 text-tertiary">
        <Film className="size-6" />
      </div>
    );
  }
  return <span className="text-sm font-bold uppercase tracking-wider text-tertiary">{asset.type}</span>;
}
