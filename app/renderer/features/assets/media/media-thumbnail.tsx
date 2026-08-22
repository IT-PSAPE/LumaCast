import { useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '@lumacast/composition';
import { AlertTriangle } from 'lucide-react';
import { useBinScrollRoot } from '@renderer/components/layout/bin-shell';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { useMediaDerivative } from '../../../hooks/use-media-derivative';

export function MediaThumbnail({ asset }: { asset: MediaAsset }) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRootRef = useBinScrollRoot();
  const { asset: resolvedAsset, displaySrc, status } = useMediaDerivative(asset, visible);
  const isBroken = brokenSrc !== null && brokenSrc === displaySrc;
  const showMissingSource = isBroken || status === 'missing';

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

  useEffect(() => {
    if (brokenSrc !== null && brokenSrc !== displaySrc) {
      setBrokenSrc(null);
    }
  }, [displaySrc, brokenSrc]);

  useEffect(() => {
    if (status !== 'missing') return;
    setBrokenSrc(displaySrc);
  }, [displaySrc, status]);

  if (showMissingSource) {
    return (
      <div ref={hostRef} className="absolute inset-0">
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-tertiary/80 text-tertiary">
          <AlertTriangle size={16} strokeWidth={1.75} />
          <span className="px-2 text-center text-xs uppercase tracking-wider">Missing source</span>
        </div>
      </div>
    );
  }

  if (displaySrc) {
    return (
      <div ref={hostRef} className="absolute inset-0">
        <img
          src={displaySrc}
          alt={resolvedAsset.name}
          loading="lazy"
          draggable={false}
          crossOrigin="anonymous"
          onError={() => setBrokenSrc(displaySrc)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    );
  }
  if (resolvedAsset.type === 'video' || resolvedAsset.type === 'image') {
    return (
      <div ref={hostRef} className="absolute inset-0">
        <div className="absolute inset-0 flex items-center justify-center bg-tertiary/45 text-tertiary">
            <MediaAssetIcon
              asset={resolvedAsset}
              size={20}
              strokeWidth={1.75}
              className={status === 'generating' || status === 'uploading' ? 'animate-pulse' : undefined}
            />
          </div>
        </div>
    );
  }
  return (
    <div ref={hostRef} className="absolute inset-0 flex items-center justify-center">
      <span className="text-tertiary text-sm font-bold tracking-wider uppercase">{resolvedAsset.type}</span>
    </div>
  );
}
