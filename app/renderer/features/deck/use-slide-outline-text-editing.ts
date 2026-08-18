import { useCallback } from 'react';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import { useCast } from '../../contexts/app-context';

interface UpdateSlideOutlineTextInput {
  elements: SlideElement[];
  nextText: string;
  slideIndex: number;
  textEditable: boolean;
  textElementId: Id | null;
}

interface SlideOutlineTextEditingResult {
  updateText: (input: UpdateSlideOutlineTextInput) => void;
}

export function useSlideOutlineTextEditing(): SlideOutlineTextEditingResult {
  const { mutatePatch, setStatusText } = useCast();

  const updateText = useCallback((input: UpdateSlideOutlineTextInput) => {
    if (!input.textEditable || !input.textElementId) return;

    const textElement = input.elements.find((element) => element.id === input.textElementId);
    if (!textElement || !('text' in textElement.payload)) return;

    const currentText = String(textElement.payload.text ?? '');
    if (input.nextText === currentText) return;

    void mutatePatch(() => window.castApi.updateElement({
      id: textElement.id,
      payload: {
        ...textElement.payload,
        text: input.nextText,
      },
    }));

    setStatusText(`Updated slide ${input.slideIndex + 1} text`);
  }, [mutatePatch, setStatusText]);

  return { updateText };
}
