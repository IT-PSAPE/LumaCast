import { useMemo } from 'react';
import { useProjectContent } from '../contexts/use-project-content';
import { buildMediaProxyBySource } from '../utils/media-residency';

export function useMediaProxyMap(): ReadonlyMap<string, string> {
  const { mediaAssets } = useProjectContent();
  const proxyVersion = mediaAssets.map((asset) => `${asset.src}:${asset.thumbnailSrc ?? ''}`).join('|');
  return useMemo(() => buildMediaProxyBySource(mediaAssets), [mediaAssets, proxyVersion]);
}
