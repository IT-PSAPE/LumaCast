import { useMemo } from 'react';
import type { TextElementPayload } from '@lumacast/composition';
import { useSlides } from '../../contexts/slide-context';
import { buildRenderScene } from '../canvas/build-render-scene';
import type { BindingValue } from '@lumacast/composition';
import type { RenderScene } from '@lumacast/composition';
import { useStagePlayback } from '../../contexts/playback/playback-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useTimers } from '../../contexts/timers/timers-context';
import { useMediaProxyMap } from '../../hooks/use-media-proxy-map';

// Resolves the RenderScene for the operator-selected stage layout. Returns an
// empty scene when no stage is active so consumers can always render without
// conditional logic.
export function useStageScene(): RenderScene {
  const { currentStageId } = useStagePlayback();
  const { stagesById } = useProjectContent();
  const mediaProxyBySource = useMediaProxyMap();

  return useMemo(() => {
    const stage = currentStageId ? stagesById.get(currentStageId) ?? null : null;
    return buildRenderScene(
      stage ? { id: stage.id, width: stage.width, height: stage.height, background: stage.background ?? null } : null,
      stage?.elements ?? [],
      { proxyMediaBySource: mediaProxyBySource },
    );
  }, [currentStageId, mediaProxyBySource, stagesById]);
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
  const { liveSlide, liveElements, nextLiveSlide, nextLiveElements } = useSlides();
  const { readings } = useTimers();

  return useMemo(() => ({
    currentSlideText: liveSlide ? extractSlideText(liveElements) : null,
    nextSlideText: nextLiveSlide ? extractSlideText(nextLiveElements) : null,
    slideNotes: liveSlide ? liveSlide.notes : null,
    timerReadings: readings,
  }), [liveElements, liveSlide, nextLiveElements, nextLiveSlide, readings]);
}

export function useProgramBindingValue(): BindingValue {
  const { liveSlide, liveElements, nextLiveSlide, nextLiveElements } = useSlides();
  const { readings } = useTimers();

  return useMemo(() => ({
    currentSlideText: liveSlide ? extractSlideText(liveElements) : null,
    nextSlideText: nextLiveSlide ? extractSlideText(nextLiveElements) : null,
    slideNotes: liveSlide ? liveSlide.notes : null,
    timerReadings: readings,
  }), [liveElements, liveSlide, nextLiveElements, nextLiveSlide, readings]);
}
