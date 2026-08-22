import { useEffect, useMemo, useState } from 'react';
import type { MediaAsset } from '@lumacast/composition';
import type { EnsureMediaDerivativeResult } from '@lumacast/protocol';
import { useCast } from '../contexts/app-context';
import { useVideoPoster } from './use-video-poster';

export type MediaDerivativeUiStatus = 'idle' | 'generating' | 'uploading' | 'ready' | 'missing' | 'error';

interface EnsureCacheEntry {
  result: EnsureMediaDerivativeResult;
  patchedAsset: MediaAsset | null;
}

interface EnsureTask {
  consumers: number;
  promise: Promise<EnsureCacheEntry>;
  settled: boolean;
}

type FallbackIntent =
  | { mode: 'upload'; generationToken: string; sourceFingerprint: string }
  | { mode: 'local' };

const pendingEnsureTasks = new Map<string, EnsureTask>();

function assetAttemptKey(asset: MediaAsset): string {
  return `${asset.id}\0${asset.src}\0${asset.updatedAt}`;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const [, encoded = ''] = dataUrl.split(',', 2);
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function patchAsset(result: EnsureMediaDerivativeResult, assetId: string): MediaAsset | null {
  return result.patch?.upserts.mediaAssets?.find((asset) => asset.id === assetId) ?? null;
}

function acquireEnsureTask(asset: MediaAsset, key: string): { promise: Promise<EnsureCacheEntry>; release: () => void } {
  let task = pendingEnsureTasks.get(key);
  if (!task) {
    const promise = window.castApi.ensureMediaDerivative(asset.id)
      .then((result) => ({ result, patchedAsset: patchAsset(result, asset.id) }))
      .finally(() => {
        const current = pendingEnsureTasks.get(key);
        if (current?.promise === promise) pendingEnsureTasks.delete(key);
      });
    task = { consumers: 0, promise, settled: false };
    pendingEnsureTasks.set(key, task);
  }

  task.consumers += 1;
  return {
    promise: task.promise,
    release: () => {
      const current = pendingEnsureTasks.get(key);
      if (!current) return;
      current.consumers = Math.max(0, current.consumers - 1);
    },
  };
}

async function imageSourceToPngData(src: string): Promise<{ bytes: Uint8Array; previewSrc: string }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.decoding = 'async';
    next.crossOrigin = 'anonymous';
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error('Failed to decode image fallback source'));
    next.src = src;
  });
  const scale = Math.min(1, 480 / Math.max(image.naturalWidth || 1, 1), 270 / Math.max(image.naturalHeight || 1, 1));
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for image fallback');
  ctx.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to encode image fallback thumbnail');
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    previewSrc: canvas.toDataURL('image/png'),
  };
}

export function useMediaDerivative(asset: MediaAsset, visible: boolean): {
  asset: MediaAsset;
  displaySrc: string | null;
  status: MediaDerivativeUiStatus;
} {
  const { applyPatchLocally } = useCast();
  const [status, setStatus] = useState<MediaDerivativeUiStatus>(asset.thumbnailSrc ? 'ready' : 'idle');
  const [localAsset, setLocalAsset] = useState(asset);
  const [fallbackDisplaySrc, setFallbackDisplaySrc] = useState<string | null>(null);
  const [fallbackIntent, setFallbackIntent] = useState<FallbackIntent | null>(null);
  const attemptKey = useMemo(() => assetAttemptKey(asset), [asset.id, asset.src, asset.updatedAt]);
  const stableAssetFields = [
    asset.id,
    asset.src,
    asset.updatedAt,
    asset.thumbnailSrc ?? '',
    asset.name,
    asset.width ?? -1,
    asset.height ?? -1,
    asset.duration ?? -1,
    asset.codec ?? '',
    asset.order,
    asset.createdAt,
  ] as const;
  const { posterSrc } = useVideoPoster(
    visible && fallbackIntent !== null && asset.type === 'video' && !localAsset.thumbnailSrc ? asset.src : null,
    visible,
  );

  useEffect(() => {
    setLocalAsset(asset);
    setFallbackDisplaySrc(null);
    setFallbackIntent(null);
    setStatus(asset.thumbnailSrc ? 'ready' : 'idle');
  }, stableAssetFields);

  useEffect(() => {
    if (!visible) return;
    const { promise, release } = acquireEnsureTask(asset, attemptKey);
    let cancelled = false;
    setStatus((current) => current === 'ready' ? current : 'generating');

    void promise
      .then((entry) => {
        if (cancelled) return;
        if (entry.result.patch) {
          void applyPatchLocally(entry.result.patch).catch(() => {});
        }
        if (entry.patchedAsset) {
          setLocalAsset((current) => ({ ...current, ...entry.patchedAsset }));
        }
        if (entry.result.status === 'ready') {
          setFallbackIntent(null);
          setStatus('ready');
          return;
        }
        if (
          entry.result.status === 'needs-upload'
          && entry.result.generationToken
          && entry.result.sourceFingerprint
          && (asset.type === 'image' || asset.type === 'video')
        ) {
          setFallbackIntent({
            mode: 'upload',
            generationToken: entry.result.generationToken,
            sourceFingerprint: entry.result.sourceFingerprint,
          });
          setStatus('uploading');
          return;
        }
        if (entry.result.status === 'failed' && (asset.type === 'image' || asset.type === 'video')) {
          setFallbackIntent({ mode: 'local' });
          setStatus('error');
          return;
        }
        setStatus(entry.result.status === 'missing' ? 'missing' : 'error');
      })
      .catch(() => {
        if (!cancelled) {
          if (asset.type === 'image' || asset.type === 'video') {
            setFallbackIntent({ mode: 'local' });
          }
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      release();
    };
  }, [applyPatchLocally, asset.id, asset.type, attemptKey, visible]);

  useEffect(() => {
    if (!fallbackIntent || asset.type !== 'image') return;
    let cancelled = false;
    void imageSourceToPngData(asset.src)
      .then(async ({ bytes, previewSrc }) => {
        if (cancelled) return;
        setFallbackDisplaySrc(previewSrc);
        if (fallbackIntent.mode === 'local') {
          setStatus('error');
          return;
        }
        const result = await window.castApi.uploadMediaDerivativeFallback(
          asset.id,
          fallbackIntent.generationToken,
          fallbackIntent.sourceFingerprint,
          bytes,
        );
        if (cancelled) return;
        if (result.patch) {
          void applyPatchLocally(result.patch).catch(() => {});
          const nextAsset = patchAsset(result, asset.id);
          if (nextAsset) setLocalAsset((current) => ({ ...current, ...nextAsset }));
        }
        if (result.status === 'ready') {
          setFallbackIntent(null);
        }
        setStatus(result.status === 'ready' ? 'ready' : 'error');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [applyPatchLocally, asset.id, asset.src, asset.type, fallbackIntent]);

  useEffect(() => {
    if (!fallbackIntent || asset.type !== 'video' || !posterSrc) return;
    let cancelled = false;
    setFallbackDisplaySrc(posterSrc);
    if (fallbackIntent.mode === 'local') {
      setStatus('error');
      return () => {
        cancelled = true;
      };
    }
    void window.castApi.uploadMediaDerivativeFallback(
      asset.id,
      fallbackIntent.generationToken,
      fallbackIntent.sourceFingerprint,
      dataUrlToUint8Array(posterSrc),
    )
      .then((result) => {
        if (cancelled) return;
        if (result.patch) {
          void applyPatchLocally(result.patch).catch(() => {});
          const nextAsset = patchAsset(result, asset.id);
          if (nextAsset) setLocalAsset((current) => ({ ...current, ...nextAsset }));
        }
        if (result.status === 'ready') {
          setFallbackIntent(null);
        }
        setStatus(result.status === 'ready' ? 'ready' : 'error');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [applyPatchLocally, asset.id, asset.type, fallbackIntent, posterSrc]);

  const displaySrc = localAsset.thumbnailSrc ?? fallbackDisplaySrc ?? null;
  return { asset: localAsset, displaySrc, status };
}
