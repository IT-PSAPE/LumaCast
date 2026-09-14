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

  it('projects configured lyric blanks at runtime without persisting slides', () => {
    const base = snapshot(null);
    base.mediaAssets = [];
    base.lyrics = [{
      id: 'lyric-1', title: 'Song', themeId: 'theme-1', blankSlideMode: 'both', order: 0,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }];
    base.lyricThemes = [{
      id: 'theme-1', slideId: 'theme-slide', name: 'Theme', width: 1280, height: 720, order: 0,
      background: { type: 'color', color: '#123456' },
      elements: [
        { id: 'theme-text', slideId: 'theme-slide', type: 'text', x: 0, y: 0, width: 100, height: 50, rotation: 0, opacity: 1, zIndex: 1, layer: 'content', payload: { text: 'lyrics', fontFamily: 'Arial', fontSize: 32, color: '#fff', alignment: 'left', weight: '400' }, createdAt: '', updatedAt: '' },
        { id: 'theme-shape', slideId: 'theme-slide', type: 'shape', x: 0, y: 0, width: 100, height: 50, rotation: 0, opacity: 1, zIndex: 0, layer: 'background', payload: { fillColor: '#000', borderColor: '#000', borderWidth: 0, borderRadius: 0 }, createdAt: '', updatedAt: '' },
      ],
      createdAt: '', updatedAt: '',
    }];
    base.slides = [{
      id: 'slide-1', presentationId: null, lyricId: 'lyric-1', presentationThemeId: null, lyricThemeId: null,
      overlayThemeId: null, overlayId: null, stageId: null, kind: 'lyric', width: 1280, height: 720, notes: '',
      background: null, backgroundSource: 'theme', order: 0, createdAt: '', updatedAt: '',
    }];
    useAppStore.setState({ snapshot: base });

    const { result } = renderHook(() => useProjectContent());
    const projected = result.current.slidesForItemRef({ type: 'lyric', id: 'lyric-1' });

    expect(result.current.slides).toHaveLength(1);
    expect(projected.map((slide) => slide.runtimeBlank ?? null)).toEqual(['start', null, 'end']);
    const blank = projected[0]!;
    expect(result.current.liveSlidesById.get(blank.id)?.background).toEqual({ type: 'color', color: '#123456' });
    expect(result.current.liveSlideElementsBySlideId.get(blank.id)?.map((element) => element.type)).toEqual(['shape']);
  });

  it('projects an unthemed runtime blank as empty', () => {
    const base = snapshot(null);
    base.mediaAssets = [];
    base.lyrics = [{ id: 'lyric-1', title: 'Song', themeId: null, blankSlideMode: 'start', order: 0, createdAt: '', updatedAt: '' }];
    useAppStore.setState({ snapshot: base });

    const { result } = renderHook(() => useProjectContent());
    const blank = result.current.slidesForItemRef({ type: 'lyric', id: 'lyric-1' })[0]!;
    expect(blank.background).toBeNull();
    expect(result.current.liveSlideElementsBySlideId.get(blank.id)).toEqual([]);
  });
});
