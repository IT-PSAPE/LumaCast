import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { MediaAsset } from '@lumacast/composition';
import type { EnsureMediaDerivativeResult, SnapshotPatch } from '@lumacast/protocol';

const { applyPatchLocally, useVideoPoster } = vi.hoisted(() => ({
  applyPatchLocally: vi.fn(),
  useVideoPoster: vi.fn(() => ({ posterSrc: null, status: 'idle' })),
}));

vi.mock('../contexts/app-context', () => ({
  useCast: () => ({ applyPatchLocally }),
}));

vi.mock('./use-video-poster', () => ({
  useVideoPoster,
}));

import { useMediaDerivative } from './use-media-derivative';

function mediaAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset-1',
    name: 'Clip',
    type: 'video',
    src: 'managed://asset-1',
    width: 1280,
    height: 720,
    duration: 12,
    codec: 'h264',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function derivativePatch(asset: MediaAsset): SnapshotPatch {
  return {
    version: 1,
    deletes: {},
    upserts: { mediaAssets: [asset] },
  };
}

async function flushWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useMediaDerivative task registry', () => {
  beforeEach(() => {
    applyPatchLocally.mockReset();
    applyPatchLocally.mockResolvedValue(null);
    useVideoPoster.mockReturnValue({ posterSrc: null, status: 'idle' });
    window.castApi = {
      ...window.castApi,
      ensureMediaDerivative: vi.fn(),
      uploadMediaDerivativeFallback: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('retries after a transient ensure rejection instead of poisoning future acquisitions', async () => {
    const ensure = vi.fn<() => Promise<EnsureMediaDerivativeResult>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({
        assetId: 'asset-1',
        status: 'ready',
        patch: derivativePatch({ ...mediaAsset(), thumbnailSrc: 'managed://thumb-1' }),
      });
    window.castApi.ensureMediaDerivative = ensure as typeof window.castApi.ensureMediaDerivative;
    window.castApi.uploadMediaDerivativeFallback = vi.fn() as typeof window.castApi.uploadMediaDerivativeFallback;

    const first = renderHook(() => useMediaDerivative(mediaAsset(), true));
    await flushWork();
    expect(first.result.current.status).toBe('error');
    first.unmount();

    const second = renderHook(() => useMediaDerivative(mediaAsset(), true));
    await flushWork();

    expect(ensure).toHaveBeenCalledTimes(2);
    expect(second.result.current.status).toBe('ready');
    expect(applyPatchLocally).toHaveBeenCalledTimes(1);
  });

  it('reacquires a successful result after unmount instead of pinning a stale ready cache', async () => {
    const cachedAsset = mediaAsset({ id: 'asset-cached', src: 'managed://asset-cached' });
    const ensure = vi.fn<() => Promise<EnsureMediaDerivativeResult>>()
      .mockResolvedValue({
        assetId: 'asset-cached',
        status: 'ready',
        patch: derivativePatch({ ...cachedAsset, thumbnailSrc: 'managed://thumb-1' }),
      });
    window.castApi.ensureMediaDerivative = ensure as typeof window.castApi.ensureMediaDerivative;
    window.castApi.uploadMediaDerivativeFallback = vi.fn() as typeof window.castApi.uploadMediaDerivativeFallback;

    const first = renderHook(() => useMediaDerivative(cachedAsset, true));
    await flushWork();
    first.unmount();

    const second = renderHook(() => useMediaDerivative(cachedAsset, true));
    await flushWork();

    expect(ensure).toHaveBeenCalledTimes(2);
    expect(second.result.current.asset.thumbnailSrc).toBe('managed://thumb-1');
    expect(second.result.current.status).toBe('ready');
  });

  it('retries a missing derivative result on the next acquisition instead of caching the miss', async () => {
    const missingAsset = mediaAsset({ id: 'asset-missing', src: 'managed://asset-missing' });
    const ensure = vi.fn<() => Promise<EnsureMediaDerivativeResult>>()
      .mockResolvedValueOnce({
        assetId: 'asset-missing',
        status: 'missing',
      })
      .mockResolvedValueOnce({
        assetId: 'asset-missing',
        status: 'ready',
        patch: derivativePatch({ ...missingAsset, thumbnailSrc: 'managed://thumb-restored', width: 1920, height: 1080 }),
      });
    window.castApi.ensureMediaDerivative = ensure as typeof window.castApi.ensureMediaDerivative;
    window.castApi.uploadMediaDerivativeFallback = vi.fn() as typeof window.castApi.uploadMediaDerivativeFallback;

    const first = renderHook(() => useMediaDerivative(missingAsset, true));
    await flushWork();
    expect(first.result.current.status).toBe('missing');
    first.unmount();

    const second = renderHook(() => useMediaDerivative(missingAsset, true));
    await flushWork();

    expect(ensure).toHaveBeenCalledTimes(2);
    expect(second.result.current.status).toBe('ready');
    expect(second.result.current.asset.thumbnailSrc).toBe('managed://thumb-restored');
    expect(second.result.current.asset.width).toBe(1920);
  });

  it('does not cache a spent upload token result after unmounting before fallback upload completes', async () => {
    const uploadAsset = mediaAsset({ id: 'asset-upload', src: 'managed://asset-upload' });
    const ensure = vi.fn<() => Promise<EnsureMediaDerivativeResult>>()
      .mockResolvedValueOnce({
        assetId: 'asset-upload',
        status: 'needs-upload',
        generationToken: 'token-a',
        sourceFingerprint: 'fingerprint-a',
      })
      .mockResolvedValueOnce({
        assetId: 'asset-upload',
        status: 'ready',
        patch: derivativePatch({ ...uploadAsset, thumbnailSrc: 'managed://thumb-after-remount' }),
      });
    window.castApi.ensureMediaDerivative = ensure as typeof window.castApi.ensureMediaDerivative;
    window.castApi.uploadMediaDerivativeFallback = vi.fn() as typeof window.castApi.uploadMediaDerivativeFallback;
    useVideoPoster.mockReturnValue({ posterSrc: null, status: 'idle' });

    const first = renderHook(() => useMediaDerivative(uploadAsset, true));
    await flushWork();
    expect(first.result.current.status).toBe('uploading');
    first.unmount();

    const second = renderHook(() => useMediaDerivative(uploadAsset, true));
    await flushWork();

    expect(ensure).toHaveBeenCalledTimes(2);
    expect(window.castApi.uploadMediaDerivativeFallback).not.toHaveBeenCalled();
    expect(second.result.current.status).toBe('ready');
    expect(second.result.current.asset.thumbnailSrc).toBe('managed://thumb-after-remount');
  });
});
