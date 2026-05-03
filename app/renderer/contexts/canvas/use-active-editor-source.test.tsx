import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Overlay, Slide, Stage, Theme } from '@core/types';
import { useDeckEditor, useOverlayEditor, useStageEditor, useThemeEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useNavigation } from '@renderer/contexts/navigation-context';
import { useSlides } from '@renderer/contexts/slide-context';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { useActiveEditorSource } from './use-active-editor-source';

vi.mock('@renderer/contexts/navigation-context', () => ({ useNavigation: vi.fn() }));
vi.mock('@renderer/contexts/slide-context', () => ({ useSlides: vi.fn() }));
vi.mock('@renderer/contexts/workbench-context', () => ({ useWorkbench: vi.fn() }));
vi.mock('@renderer/contexts/asset-editor/asset-editor-context', () => ({
  useDeckEditor: vi.fn(),
  useOverlayEditor: vi.fn(),
  useStageEditor: vi.fn(),
  useThemeEditor: vi.fn(),
}));

const useNavigationMock = vi.mocked(useNavigation);
const useSlidesMock = vi.mocked(useSlides);
const useWorkbenchMock = vi.mocked(useWorkbench);
const useDeckEditorMock = vi.mocked(useDeckEditor);
const useOverlayEditorMock = vi.mocked(useOverlayEditor);
const useStageEditorMock = vi.mocked(useStageEditor);
const useThemeEditorMock = vi.mocked(useThemeEditor);

function makeSlide(id: string): Slide {
  return {
    id,
    presentationId: 'presentation-1',
    lyricId: null,
    themeId: null,
    overlayId: null,
    stageId: null,
    kind: 'presentation',
    width: 1920,
    height: 1080,
    notes: '',
    order: 0,
    createdAt: '',
    updatedAt: '',
  };
}

function makeTheme(id: string, kind: Theme['kind']): Theme {
  return {
    id,
    slideId: `${id}-slide`,
    name: 'Theme',
    kind,
    width: 1920,
    height: 1080,
    order: 0,
    elements: [],
    collectionId: 'theme-default',
    createdAt: '',
    updatedAt: '',
  };
}

function makeStage(id: string): Stage {
  return {
    id,
    slideId: `${id}-slide`,
    name: 'Stage',
    width: 1280,
    height: 720,
    order: 0,
    elements: [],
    collectionId: 'stage-default',
    createdAt: '',
    updatedAt: '',
  };
}

function makeOverlay(id: string): Overlay {
  return {
    id,
    slideId: `${id}-slide`,
    name: 'Overlay',
    enabled: true,
    elements: [],
    animation: { kind: 'none', durationMs: 0, autoClearDurationMs: null },
    collectionId: 'overlay-default',
    createdAt: '',
    updatedAt: '',
  };
}

describe('useActiveEditorSource', () => {
  beforeEach(() => {
    useNavigationMock.mockReturnValue({
      currentDeckItem: { id: 'deck-1', type: 'presentation' },
    } as never);
    useSlidesMock.mockReturnValue({
      currentSlide: makeSlide('slide-1'),
    } as never);
    useWorkbenchMock.mockReturnValue({
      state: { workbenchMode: 'show' },
    } as never);
    useDeckEditorMock.mockReturnValue({
      getSlideElements: vi.fn().mockReturnValue([{ id: 'slide-el', slideId: 'slide-1', type: 'text' }]),
      replaceSlideElements: vi.fn(),
    } as never);
    useOverlayEditorMock.mockReturnValue({
      currentOverlay: null,
      updateOverlayDraft: vi.fn(),
    } as never);
    useThemeEditorMock.mockReturnValue({
      currentTheme: null,
      replaceThemeElements: vi.fn(),
    } as never);
    useStageEditorMock.mockReturnValue({
      currentStage: null,
      replaceStageElements: vi.fn(),
    } as never);
  });

  it('keeps stage editor empty when no stage is selected even if a deck slide exists', () => {
    useWorkbenchMock.mockReturnValue({
      state: { workbenchMode: 'stage-editor' },
    } as never);

    const { result } = renderHook(() => useActiveEditorSource());

    expect(result.current.mode).toBe('stage-editor');
    expect(result.current.hasSource).toBe(false);
    expect(result.current.elements).toEqual([]);
    expect(result.current.emptyStateLabel).toBe('No stage selected.');
  });

  it('resolves the selected stage as the active stage editor source', () => {
    const stage = makeStage('stage-1');
    stage.elements = [{ id: 'stage-el', slideId: 'stage-1', type: 'shape' } as never];
    useWorkbenchMock.mockReturnValue({
      state: { workbenchMode: 'stage-editor' },
    } as never);
    useStageEditorMock.mockReturnValue({
      currentStage: stage,
      replaceStageElements: vi.fn(),
    } as never);

    const { result } = renderHook(() => useActiveEditorSource());

    expect(result.current.mode).toBe('stage-editor');
    expect(result.current.entityId).toBe('stage-1');
    expect(result.current.hasSource).toBe(true);
    expect(result.current.elements).toEqual(stage.elements);
    expect(result.current.frame).toEqual({ width: 1280, height: 720 });
  });

  it('resolves deck editor metadata and disables text creation for lyric items', () => {
    useWorkbenchMock.mockReturnValue({
      state: { workbenchMode: 'deck-editor' },
    } as never);
    useNavigationMock.mockReturnValue({
      currentDeckItem: { id: 'deck-1', type: 'lyric' },
    } as never);

    const { result } = renderHook(() => useActiveEditorSource());

    const source = result.current;
    expect(source.mode).toBe('deck-editor');
    if (source.mode !== 'deck-editor') throw new Error('Expected deck editor source');
    expect(source.hasSource).toBe(true);
    expect(source.meta.deckItemType).toBe('lyric');
    expect(source.createCapabilities.text).toBe(false);
  });

  it('resolves theme editor metadata from the selected theme', () => {
    useWorkbenchMock.mockReturnValue({
      state: { workbenchMode: 'theme-editor' },
    } as never);
    useThemeEditorMock.mockReturnValue({
      currentTheme: makeTheme('theme-1', 'lyrics'),
      replaceThemeElements: vi.fn(),
    } as never);

    const { result } = renderHook(() => useActiveEditorSource());

    const source = result.current;
    expect(source.mode).toBe('theme-editor');
    if (source.mode !== 'theme-editor') throw new Error('Expected theme editor source');
    expect(source.meta.themeKind).toBe('lyrics');
    expect(source.emptyStateLabel).toBe('No theme selected.');
    expect(source.createCapabilities.text).toBe(false);
  });

  it('resolves overlay editor metadata from the selected overlay', () => {
    useWorkbenchMock.mockReturnValue({
      state: { workbenchMode: 'overlay-editor' },
    } as never);
    useOverlayEditorMock.mockReturnValue({
      currentOverlay: makeOverlay('overlay-1'),
      updateOverlayDraft: vi.fn(),
    } as never);

    const { result } = renderHook(() => useActiveEditorSource());

    expect(result.current.mode).toBe('overlay-editor');
    expect(result.current.entityId).toBe('overlay-1');
    expect(result.current.hasSource).toBe(true);
    expect(result.current.emptyStateLabel).toBe('No overlay selected.');
  });
});
