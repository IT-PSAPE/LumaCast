import { useCallback, useMemo, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import type { ElementCreateInput, ElementUpdateInput } from '@lumacast/protocol';
import type { Block } from '../../components/form/doc-editor';
import { useCast } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useSlides } from '../../contexts/slide-context';
import { slideTextDetails, sortSlides } from '../../utils/slides';
import { buildLyricTextElement, normalizeLyricText } from './lyric-text-utils';
import { groupBlocksForSlides } from './lyric-slide-grouping';
import { loadMeasureFont, type LyricLayoutConfig } from './lyric-layout-config';

function findTextElement(elements: SlideElement[]): SlideElement | null {
  return elements.find((element) => element.type === 'text' && 'text' in element.payload) ?? null;
}

interface UseLyricEditorSaveArgs {
  isOpen: boolean;
  onClose: () => void;
  config: LyricLayoutConfig;
}

export function useLyricEditorSave({ isOpen, onClose, config }: UseLyricEditorSaveArgs) {
  const { currentItem, currentItemRef } = useNavigation();
  const { slides } = useSlides();
  const { slideElementsBySlideId } = useProjectContent();
  const { mutatePatch, runOperation, setStatusText } = useCast();
  const [isSaving, setIsSaving] = useState(false);
  const isLyric = currentItemRef?.type === 'lyric';

  const initialBlocks = useMemo<Block[]>(() => {
    if (!isOpen || !currentItem || !isLyric) return [];
    return slides.map((slide) => ({
      id: slide.id,
      content: slideTextDetails(slideElementsBySlideId.get(slide.id) ?? []).text,
    }));
  }, [isOpen, currentItem, isLyric, slideElementsBySlideId, slides]);

  const saveBlocks = useCallback(async (blocks: Block[], options?: { skipGrouping?: boolean }) => {
    if (!currentItem || !isLyric) return;

    setIsSaving(true);

    try {
      await runOperation('Saving lyrics...', async () => {
        await loadMeasureFont(config);

        const lyricId = currentItem.id;
        const knownSlideIds = new Set(slides.map((slide) => slide.id));
        const currentOrderIds = slides.map((slide) => slide.id);
        const grouped = (options?.skipGrouping ? blocks : groupBlocksForSlides(blocks, { config }))
          .map((block) => ({ id: block.id, content: normalizeLyricText(block.content) }));

        const createdSlideIds: Id[] = [];
        const resolvedSlideIds: Id[] = [];
        const elementUpdates: ElementUpdateInput[] = [];
        const elementCreates: ElementCreateInput[] = [];

        const planWrites = (slideId: Id, text: string, elements: SlideElement[]) => {
          const textElement = findTextElement(elements);
          if (!textElement || !('text' in textElement.payload)) {
            if (text.length > 0) elementCreates.push(buildLyricTextElement(slideId, text, config));
            return;
          }
          const currentText = String(textElement.payload.text ?? '');
          if (currentText === text) return;
          elementUpdates.push({ id: textElement.id, payload: { ...textElement.payload, text } });
        };

        for (const block of grouped) {
          if (knownSlideIds.has(block.id)) {
            resolvedSlideIds.push(block.id);
            planWrites(block.id, block.content, slideElementsBySlideId.get(block.id) ?? []);
            continue;
          }
          const snapshot = await mutatePatch(() => window.castApi.createSlide({ lyricId }));
          const freshCandidates = sortSlides(snapshot.slides.filter((slide) =>
            slide.lyricId === lyricId
            && !knownSlideIds.has(slide.id)
            && !createdSlideIds.includes(slide.id),
          ));
          const nextSlide = freshCandidates[0]
            ?? snapshot.slides
              .filter((slide) => slide.lyricId === lyricId)
              .sort((left, right) => right.order - left.order)
              .at(0);
          if (!nextSlide) throw new Error('Unable to create lyric slide.');
          createdSlideIds.push(nextSlide.id);
          resolvedSlideIds.push(nextSlide.id);
          planWrites(
            nextSlide.id,
            block.content,
            snapshot.slideElements.filter((element) => element.slideId === nextSlide.id),
          );
        }

        const finalSlideIds = new Set(resolvedSlideIds);
        const removedSlideIds = currentOrderIds.filter((id) => !finalSlideIds.has(id));

        const reorderNeeded = resolvedSlideIds.length !== currentOrderIds.length
          || resolvedSlideIds.some((id, index) => id !== currentOrderIds[index]);

        if (elementUpdates.length > 0) {
          await mutatePatch(() => window.castApi.updateElementsBatch(elementUpdates));
        }
        if (elementCreates.length > 0) {
          await mutatePatch(() => window.castApi.createElementsBatch(elementCreates));
        }
        for (const slideId of removedSlideIds) {
          await mutatePatch(() => window.castApi.deleteSlide(slideId));
        }
        if (reorderNeeded) {
          for (const [index, slideId] of resolvedSlideIds.entries()) {
            await mutatePatch(() => window.castApi.setSlideOrder({ slideId, newOrder: index }));
          }
        }

        setStatusText('Saved lyrics');
        onClose();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save lyrics.';
      setStatusText(message);
    } finally {
      setIsSaving(false);
    }
  }, [config, currentItem, isLyric, mutatePatch, onClose, runOperation, setStatusText, slideElementsBySlideId, slides]);

  return { initialBlocks, saveBlocks, isSaving };
}
