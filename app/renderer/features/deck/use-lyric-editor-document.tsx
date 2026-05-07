import { useCallback, useMemo, useState } from 'react';
import type { Id, SlideElement } from '@core/types';
import type { Block } from '../../components/form/doc-editor';
import { useCast } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useSlides } from '../../contexts/slide-context';
import { slideTextDetails } from '../../utils/slides';
import { buildLyricTextElement } from './lyric-text-utils';
import { groupSegmentsForSlides, joinSegments } from './lyric-slide-grouping';
import type { LyricLayoutConfig } from './lyric-layout-config';

function findTextElement(elements: SlideElement[]): SlideElement | null {
  return elements.find((element) => element.type === 'text' && 'text' in element.payload) ?? null;
}

interface UseLyricEditorSaveArgs {
  isOpen: boolean;
  onClose: () => void;
  config: LyricLayoutConfig;
}

export function useLyricEditorSave({ isOpen, onClose, config }: UseLyricEditorSaveArgs) {
  const { currentDeckItem } = useNavigation();
  const { slides } = useSlides();
  const { slideElementsBySlideId } = useProjectContent();
  const { mutatePatch, runOperation, setStatusText } = useCast();
  const [isSaving, setIsSaving] = useState(false);

  const initialBlocks = useMemo<Block[]>(() => {
    if (!isOpen || !currentDeckItem || currentDeckItem.type !== 'lyric') return [];
    return slides.map((slide) => ({
      id: slide.id,
      content: slideTextDetails(slideElementsBySlideId.get(slide.id) ?? []).text,
    }));
  }, [isOpen, currentDeckItem, slideElementsBySlideId, slides]);

  const writeSlideText = useCallback(async (slideId: Id, text: string, currentElements: SlideElement[]) => {
    const textElement = findTextElement(currentElements);
    if (textElement && 'text' in textElement.payload) {
      const currentText = String(textElement.payload.text ?? '');
      if (currentText === text) return;
      await mutatePatch(() => window.castApi.updateElement({
        id: textElement.id,
        payload: { ...textElement.payload, text },
      }));
      return;
    }
    await mutatePatch(() => window.castApi.createElement(buildLyricTextElement(slideId, text)));
  }, [mutatePatch]);

  const createSlideWithText = useCallback(async (lyricId: Id, text: string): Promise<Id> => {
    const snapshot = await mutatePatch(() => window.castApi.createSlide({ lyricId }));
    const nextSlide = snapshot.slides
      .filter((slide) => slide.lyricId === lyricId)
      .sort((left, right) => right.order - left.order)
      .at(0);
    if (!nextSlide) throw new Error('Unable to create lyric slide.');
    const nextSlideElements = snapshot.slideElements.filter((element) => element.slideId === nextSlide.id);
    await writeSlideText(nextSlide.id, text, nextSlideElements);
    return nextSlide.id;
  }, [mutatePatch, writeSlideText]);

  const saveBlocks = useCallback(async (blocks: Block[], options?: { skipGrouping?: boolean }) => {
    if (!currentDeckItem || currentDeckItem.type !== 'lyric') return;

    setIsSaving(true);

    try {
      await runOperation('Saving lyrics...', async () => {
        const segments = blocks
          .map((block) => block.content.replace(/^[ \t\n]+|[ \t\n]+$/g, ''))
          .filter((content) => content.length > 0);

        const slideTexts = options?.skipGrouping
          ? segments
          : groupSegmentsForSlides(segments, config).map((group) => joinSegments(group));

        const orderedSlideIds: Id[] = [];
        const reusableSlideIds = slides.map((slide) => slide.id);

        for (let i = 0; i < slideTexts.length; i += 1) {
          const text = slideTexts[i];
          const reuseId = reusableSlideIds[i];
          if (reuseId) {
            const elements = slideElementsBySlideId.get(reuseId) ?? [];
            await writeSlideText(reuseId, text, elements);
            orderedSlideIds.push(reuseId);
          } else {
            const created = await createSlideWithText(currentDeckItem.id, text);
            orderedSlideIds.push(created);
          }
        }

        const removedSlideIds = reusableSlideIds.slice(slideTexts.length);
        for (const slideId of removedSlideIds) {
          await mutatePatch(() => window.castApi.deleteSlide(slideId));
        }

        for (const [index, slideId] of orderedSlideIds.entries()) {
          await mutatePatch(() => window.castApi.setSlideOrder({ slideId, newOrder: index }));
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
  }, [config, createSlideWithText, currentDeckItem, mutatePatch, onClose, runOperation, setStatusText, slideElementsBySlideId, slides, writeSlideText]);

  return { initialBlocks, saveBlocks, isSaving };
}
