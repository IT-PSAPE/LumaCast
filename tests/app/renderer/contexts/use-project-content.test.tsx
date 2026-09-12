import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSnapshot } from '@lumacast/protocol';
import { useAppStore } from '../../../../app/renderer/contexts/app-store';
import { useProjectContent } from '../../../../app/renderer/contexts/use-project-content';

function snapshot(thumbnailSrc: string | null): AppSnapshot {
  return {
    presentations: [],
    lyrics: [],
    slides: [],
    slideElements: [],
    mediaAssets: [{
      id: 'asset-1',
      name: 'Asset',
      type: 'image',
      src: 'cast-media://asset-1',
      thumbnailSrc,
      width: 640,
      height: 360,
      duration: null,
      codec: null,
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    overlays: [],
    presentationThemes: [],
    lyricThemes: [],
    overlayThemes: [],
    stages: [],
    playlists: [],
    playlistEntries: [],
    cues: [],
    macros: [],
    triggerBindings: [],
    slideTags: [],
  };
}

describe('useProjectContent media stabilization', () => {
  afterEach(() => {
    act(() => {
      useAppStore.setState({ snapshot: null });
    });
  });

  it('publishes a rebuilt thumbnail when durable asset timestamps are unchanged', () => {
    useAppStore.setState({ snapshot: snapshot(null) });
    const { result } = renderHook(() => useProjectContent());
    const initialAssets = result.current.mediaAssets;

    act(() => {
      useAppStore.setState({ snapshot: snapshot('cast-media://thumbnail-1') });
    });

    expect(result.current.mediaAssets).not.toBe(initialAssets);
    expect(result.current.mediaAssets[0]?.thumbnailSrc).toBe('cast-media://thumbnail-1');
  });
});
