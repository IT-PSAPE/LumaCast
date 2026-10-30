import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SlideElement } from '@lumacast/composition';
import type { AppSnapshot, SnapshotPatch } from '@lumacast/protocol';
import { useElementHistory } from '@renderer/contexts/element/use-element-history';

function emptySnapshot(): AppSnapshot {
  return {
    presentations: [], lyrics: [], slides: [], slideElements: [], mediaAssets: [], overlays: [],
    presentationThemes: [], lyricThemes: [], overlayThemes: [], stages: [], playlists: [],
    playlistEntries: [], cues: [], macros: [], triggerBindings: [],
  };
}

function element(id: string, x: number, y: number, locked = false): SlideElement {
  return {
    id, slideId: 'slide-1', type: 'shape',
    x, y, width: 100, height: 50, rotation: 0, opacity: 1, zIndex: 0, layer: 'content',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    payload: {
      fillColor: '#FFFFFF',
      borderColor: '#000000',
      borderWidth: 0,
      borderRadius: 0,
      locked,
    },
  };
}

describe('useElementHistory.nudgeSelection', () => {
  it('commits one relative move for each unlocked selected element and skips locked elements', async () => {
    const elements = [element('el-a', 10, 20), element('el-b', 70, 80), element('el-locked', 5, 9, true)];
    const saveElementUpdates = vi.fn(async () => undefined);
    const { result } = renderHook(() => useElementHistory({
      baseElements: elements,
      effectiveElements: elements,
      activeEditorEntityId: 'slide-1',
      hasActiveEditorSource: false,
      historyKey: 'slide-1',
      selectedElementIds: ['el-a', 'el-b', 'el-locked'],
      mutatePatch: vi.fn(async (action: () => Promise<SnapshotPatch>) => {
        await action();
        return emptySnapshot();
      }),
      setStatusText: vi.fn(),
      selectElements: vi.fn(),
      setDraftElements: vi.fn() as never,
      setCanvasInteracting: vi.fn(),
      saveElementUpdates,
    }));

    await act(async () => {
      await result.current.nudgeSelection(12, -4);
    });

    expect(saveElementUpdates).toHaveBeenCalledWith([
      { id: 'el-a', x: 22, y: 16 },
      { id: 'el-b', x: 82, y: 76 },
    ]);
  });
});
