import { useEffect, useRef, useState } from 'react';
import { Film } from 'lucide-react';
import type { MediaAsset } from '@lumacast/composition';
import { useBinScrollRoot } from '@renderer/components/layout/bin-shell';
import { useMediaDerivative } from '../../hooks/use-media-derivative';

export function MediaThumbnail({ asset }: { asset: MediaAsset }) {
  const [visible, setVisible] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRootRef = useBinScrollRoot();
  const { asset: resolvedAsset, displaySrc, status } = useMediaDerivative(asset, visible);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const mountObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '240px' },
    );
    const releaseObserver = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => !entry.isIntersecting)) setVisible(false);
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '1200px' },
    );

    mountObserver.observe(host);
    releaseObserver.observe(host);

    return () => {
      mountObserver.disconnect();
      releaseObserver.disconnect();
    };
  }, [scrollRootRef]);

  if (displaySrc) {
    return (
      <div ref={hostRef} className="block h-full w-full">
        <img
          src={displaySrc}
          alt={resolvedAsset.name}
          loading="lazy"
          draggable={false}
          crossOrigin="anonymous"
          className="block h-full w-full object-cover"
        />
      </div>
    );
  }
  if (resolvedAsset.type === 'video' || resolvedAsset.type === 'image') {
    return (
      <div ref={hostRef} className="block h-full w-full">
        <div className="flex h-full w-full items-center justify-center bg-secondary/40 text-tertiary">
          <Film className={status === 'generating' || status === 'uploading' ? 'size-6 animate-pulse' : 'size-6'} />
        </div>
      </div>
    );
  }
  return (
    <div ref={hostRef} className="flex h-full w-full items-center justify-center">
      <span className="text-sm font-bold uppercase tracking-wider text-tertiary">{resolvedAsset.type}</span>
    </div>
  );
}
