import { useCallback } from 'react';
import { isLyricDeckItem } from '@core/deck-items';
import type { DeckItem, ElementCreateInput, Id, MediaAsset, SlideElement } from '@core/types';
import type { SnapshotPatch } from '@core/snapshot-patch';
import { castMediaSrc, getOverlayDefaults, typeFromFile } from '../../utils/slides';
import { useProjectContent } from '../use-project-content';
import { useWorkbench } from '../workbench-context';
import type { ActiveEditorSource } from '../canvas/editor-source';
import {
  newOverlayElement,
  newShapePayload,
  newSlideMediaElement,
  newSlideShapeElement,
  newSlideTextElement,
  newTextPayload,
  nextOverlayZIndex,
} from './element-factory';

interface CommandsParams {
  activeEditorSource: ActiveEditorSource;
  currentDeckItem: DeckItem | null;
  mutatePatch: (action: () => Promise<SnapshotPatch>) => Promise<unknown>;
  setStatusText: (text: string) => void;
  pushHistorySnapshot: () => void;
}

export function useElementCommands({ activeEditorSource, currentDeckItem, mutatePatch, setStatusText, pushHistorySnapshot }: CommandsParams) {
  const { state: { overlayDefaults } } = useWorkbench();
  const isLyricItem = isLyricDeckItem(currentDeckItem);
  const { slideElementsBySlideId } = useProjectContent();

  function resolvePersistentMediaSource(file: File): string | null {
    const filePath = window.castApi.getPathForFile(file);
    if (!filePath) return null;
    return castMediaSrc(filePath);
  }

  function replaceSourceElements(elements: SlideElement[]) {
    if (!activeEditorSource.editable || !activeEditorSource.hasSource) return;
    activeEditorSource.replaceElements(elements);
  }

  function addToSource(element: SlideElement) {
    pushHistorySnapshot();
    replaceSourceElements([...activeEditorSource.elements, element]);
  }

  function resolveSlideIdForDirectCreate(): Id | null {
    if (activeEditorSource.mode === 'deck-editor') return activeEditorSource.meta.slideId;
    return null;
  }

  const createText = useCallback(async () => {
    if (activeEditorSource.mode === 'overlay-editor') {
      const currentOverlay = activeEditorSource.meta.overlay;
      if (!currentOverlay) return;
      addToSource(newOverlayElement(currentOverlay.id, 'text', 210, 460, 1500, 120, nextOverlayZIndex(currentOverlay.elements, 20), newTextPayload('New Overlay Text', 72, 'center', '700')));
      setStatusText('Added overlay text');
      return;
    }

    if (activeEditorSource.mode === 'theme-editor') {
      const currentTheme = activeEditorSource.meta.theme;
      if (!currentTheme) return;
      if (currentTheme.kind === 'lyrics' && activeEditorSource.elements.some((element) => element.type === 'text')) {
        setStatusText('Lyric themes only support the existing lyric text element.');
        return;
      }
      addToSource(newSlideTextElement(currentTheme.id));
      setStatusText('Added theme text');
      return;
    }

    if (activeEditorSource.mode === 'stage-editor') {
      const currentStage = activeEditorSource.meta.stage;
      if (!currentStage) return;
      addToSource(newSlideTextElement(currentStage.id));
      setStatusText('Added stage text');
      return;
    }

    const currentSlideId = resolveSlideIdForDirectCreate();
    if (!currentSlideId) return;
    if (activeEditorSource.mode === 'deck-editor' && isLyricItem) {
      const existingLyricsText = (slideElementsBySlideId.get(currentSlideId) ?? []).find((element) => {
        return element.slideId === currentSlideId && element.type === 'text' && 'text' in element.payload;
      });
      if (existingLyricsText) {
        setStatusText('Lyrics keep one text element per slide. Edit text in Outline view.');
        return;
      }
    }

    if (activeEditorSource.mode === 'deck-editor') {
      addToSource(newSlideTextElement(currentSlideId));
      setStatusText('Added text element');
      return;
    }

    await mutatePatch(() => window.castApi.createElement({
      slideId: currentSlideId,
      type: 'text',
      x: 210,
      y: 460,
      width: 1500,
      height: 120,
      zIndex: 20,
      layer: 'content',
      payload: newTextPayload('New Text Element', 72, 'center', '700'),
    }));
    setStatusText('Added text element');
  }, [activeEditorSource, isLyricItem, mutatePatch, setStatusText, slideElementsBySlideId]);

  const createShape = useCallback(async () => {
    if (activeEditorSource.mode === 'overlay-editor') {
      const currentOverlay = activeEditorSource.meta.overlay;
      if (!currentOverlay) return;
      addToSource(newOverlayElement(currentOverlay.id, 'shape', 260, 260, 1400, 560, nextOverlayZIndex(currentOverlay.elements, 2), newShapePayload()));
      setStatusText('Added overlay shape');
      return;
    }

    if (activeEditorSource.mode === 'theme-editor') {
      const currentTheme = activeEditorSource.meta.theme;
      if (!currentTheme) return;
      addToSource(newSlideShapeElement(currentTheme.id));
      setStatusText('Added theme shape');
      return;
    }

    if (activeEditorSource.mode === 'stage-editor') {
      const currentStage = activeEditorSource.meta.stage;
      if (!currentStage) return;
      addToSource(newSlideShapeElement(currentStage.id));
      setStatusText('Added stage shape');
      return;
    }

    const currentSlideId = resolveSlideIdForDirectCreate();
    if (!currentSlideId) return;

    if (activeEditorSource.mode === 'deck-editor') {
      addToSource(newSlideShapeElement(currentSlideId));
      setStatusText('Added shape element');
      return;
    }

    await mutatePatch(() => window.castApi.createElement({
      slideId: currentSlideId,
      type: 'shape',
      x: 260,
      y: 260,
      width: 1400,
      height: 560,
      zIndex: 2,
      layer: 'background',
      payload: newShapePayload(),
    }));
    setStatusText('Added shape element');
  }, [activeEditorSource, mutatePatch, setStatusText]);

  const createFromMedia = useCallback(async (asset: MediaAsset, x: number, y: number) => {
    if (activeEditorSource.mode === 'overlay-editor') {
      const currentOverlay = activeEditorSource.meta.overlay;
      if (!currentOverlay) return;
      const elementType = asset.type === 'video' ? 'video' as const : 'image' as const;
      const width = asset.type === 'image' ? 640 : 960;
      const height = asset.type === 'image' ? 360 : 540;
      const payload = asset.type === 'video'
        ? { src: asset.src, autoplay: true, loop: true, muted: false, playbackRate: 1 }
        : { src: asset.src };
      addToSource(newOverlayElement(currentOverlay.id, elementType, x, y, width, height, nextOverlayZIndex(currentOverlay.elements, 10), payload));
      setStatusText(`Added ${asset.type} overlay`);
      return;
    }

    if (activeEditorSource.mode === 'theme-editor') {
      const currentTheme = activeEditorSource.meta.theme;
      if (!currentTheme) return;
      addToSource(newSlideMediaElement(currentTheme.id, asset, x, y));
      setStatusText(`Added ${asset.type} theme element`);
      return;
    }

    if (activeEditorSource.mode === 'stage-editor') {
      const currentStage = activeEditorSource.meta.stage;
      if (!currentStage) return;
      addToSource(newSlideMediaElement(currentStage.id, asset, x, y));
      setStatusText(`Added ${asset.type} stage element`);
      return;
    }

    const currentSlideId = resolveSlideIdForDirectCreate();
    if (!currentSlideId) return;

    if (activeEditorSource.mode === 'deck-editor') {
      addToSource(newSlideMediaElement(currentSlideId, asset, x, y));
      setStatusText(`Added ${asset.type} element`);
      return;
    }

    let input: ElementCreateInput;
    if (asset.type === 'image') {
      input = { slideId: currentSlideId, type: 'image', x, y, width: 640, height: 360, zIndex: 10, layer: 'media', payload: { src: asset.src } };
    } else if (asset.type === 'video') {
      input = { slideId: currentSlideId, type: 'video', x, y, width: 960, height: 540, zIndex: 10, layer: 'media', payload: { src: asset.src, autoplay: true, loop: true, muted: false, playbackRate: 1 } };
    } else {
      input = {
        slideId: currentSlideId,
        type: 'text',
        x,
        y,
        width: 800,
        height: 90,
        zIndex: 12,
        layer: 'content',
        payload: newTextPayload(`[AUDIO] ${asset.name}`, 42, 'left', '600'),
      };
    }
    await mutatePatch(() => window.castApi.createElement(input));
    setStatusText(`Added ${asset.type} element`);
  }, [activeEditorSource, mutatePatch, setStatusText]);

  const createOverlay = useCallback(async () => {
    await mutatePatch(() => window.castApi.createOverlay(getOverlayDefaults({
      animationKind: overlayDefaults.animationKind,
      durationMs: overlayDefaults.durationMs,
      autoClearDurationMs: overlayDefaults.autoClearDurationMs,
    })));
    setStatusText('Created overlay');
  }, [mutatePatch, overlayDefaults.autoClearDurationMs, overlayDefaults.animationKind, overlayDefaults.durationMs, setStatusText]);

  const toggleOverlay = useCallback(async (overlayId: Id, enabled: boolean) => {
    await mutatePatch(() => window.castApi.setOverlayEnabled(overlayId, enabled));
    setStatusText(enabled ? 'Overlay enabled' : 'Overlay disabled');
  }, [mutatePatch, setStatusText]);

  const importMedia = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    let importedCount = 0;
    let skippedCount = 0;
    for (const file of Array.from(files)) {
      const src = resolvePersistentMediaSource(file);
      if (!src) {
        skippedCount += 1;
        continue;
      }
      await mutatePatch(() => window.castApi.createMediaAsset({
        name: file.name,
        type: typeFromFile(file),
        src,
      }));
      importedCount += 1;
    }
    if (importedCount > 0 && skippedCount === 0) {
      setStatusText('Media imported');
      return;
    }
    if (importedCount > 0) {
      setStatusText(`Imported ${importedCount} media item(s); skipped ${skippedCount} item(s) without file paths.`);
      return;
    }
    setStatusText('No media imported. Selected files did not expose absolute file paths.');
  }, [mutatePatch, setStatusText]);

  const deleteMedia = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deleteMediaAsset(id));
    setStatusText('Media removed');
  }, [mutatePatch, setStatusText]);

  const changeMediaSrc = useCallback(async (id: Id, file: File) => {
    const src = resolvePersistentMediaSource(file);
    if (!src) {
      setStatusText('Media source not updated. Selected file did not expose an absolute file path.');
      return;
    }
    await mutatePatch(() => window.castApi.updateMediaAssetSrc(id, src));
    setStatusText('Media source updated');
  }, [mutatePatch, setStatusText]);

  return { createText, createShape, createFromMedia, createOverlay, toggleOverlay, importMedia, deleteMedia, changeMediaSrc };
}
