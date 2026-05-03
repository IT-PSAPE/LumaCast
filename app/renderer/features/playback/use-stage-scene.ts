import { useEffect, useMemo, useState } from 'react';
import type { TextElementPayload } from '@core/types';
import { useSlides } from '../../contexts/slide-context';
import { buildRenderScene } from '../canvas/build-render-scene';
import type { BindingValue } from '../canvas/binding-context';
import type { RenderScene } from '../canvas/scene-types';
import { useStagePlayback } from '../../contexts/playback/playback-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useNavigation } from '../../contexts/navigation-context';

// Resolves the RenderScene for the operator-selected stage layout. Returns an
// empty scene when no stage is active so consumers can always render without
// conditional logic.
export function useStageScene(): RenderScene {
  const { currentStageId } = useStagePlayback();
  const { stagesById } = useProjectContent();

  return useMemo(() => {
    const stage = currentStageId ? stagesById.get(currentStageId) ?? null : null;
    return buildRenderScene(null, stage?.elements ?? []);
  }, [currentStageId, stagesById]);
}

function extractSlideText(elements: Array<{ type: string; payload: unknown }>): string {
  const lines: string[] = [];
  for (const element of elements) {
    if (element.type !== 'text') continue;
    const text = (element.payload as TextElementPayload).text ?? '';
    if (text.trim().length > 0) lines.push(text);
  }
  return lines.join('\n');
}

export function useStageBindingValue(): BindingValue {
  const { armedAtMs } = useStagePlayback();
  const { liveSlide, liveElements, nextLiveSlide, nextLiveElements } = useSlides();

  return useMemo(() => ({
    currentSlideText: liveSlide ? extractSlideText(liveElements) : null,
    nextSlideText: nextLiveSlide ? extractSlideText(nextLiveElements) : null,
    slideNotes: liveSlide ? liveSlide.notes : null,
    armedAtMs,
  }), [armedAtMs, liveElements, liveSlide, nextLiveElements, nextLiveSlide]);
}

export function useProgramBindingValue(): BindingValue {
  const { currentOutputDeckItemId, outputArmVersion } = useNavigation();
  const { liveSlide, liveElements, nextLiveSlide, nextLiveElements } = useSlides();
  const [armedAtMs, setArmedAtMs] = useState<number | null>(null);

  useEffect(() => {
    if (!currentOutputDeckItemId) {
      setArmedAtMs(null);
      return;
    }
    setArmedAtMs(Date.now());
  }, [currentOutputDeckItemId, outputArmVersion]);

  return useMemo(() => ({
    currentSlideText: liveSlide ? extractSlideText(liveElements) : null,
    nextSlideText: nextLiveSlide ? extractSlideText(nextLiveElements) : null,
    slideNotes: liveSlide ? liveSlide.notes : null,
    armedAtMs,
  }), [armedAtMs, liveElements, liveSlide, nextLiveElements, nextLiveSlide]);
}
