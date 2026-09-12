import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSlides } from '../../contexts/slide-context';
import { useWorkbench } from '../../contexts/workbench-context';

interface UseSlideNotesPanelResult {
  canEdit: boolean;
  notesDraft: string;
  isDirty: boolean;
  hasSlide: boolean;
  placeholder: string;
  handleNotesChange: (value: string) => void;
  handleSaveNotes: () => void;
  handleResetNotes: () => void;
}

export function useSlideNotesPanel(): UseSlideNotesPanelResult {
  const { currentSlide, updateCurrentSlideNotes } = useSlides();
  const { state: { workbenchMode } } = useWorkbench();
  const [notesDraft, setNotesDraft] = useState('');
  const isOverlayEdit = workbenchMode === 'overlay-editor';

  useEffect(() => {
    setNotesDraft(currentSlide?.notes ?? '');
  }, [currentSlide?.id, currentSlide?.notes]);

  const isDirty = (currentSlide?.notes ?? '') !== notesDraft;
  const hasSlide = Boolean(currentSlide);
  const canEdit = hasSlide && !isOverlayEdit;

  const placeholder = useMemo(() => {
    if (isOverlayEdit) return 'Slide notes are unavailable while editing overlays.';
    return 'Add notes for this slide.';
  }, [isOverlayEdit]);

  const handleNotesChange = useCallback((value: string) => {
    setNotesDraft(value);
  }, []);

  const handleSaveNotes = useCallback(() => {
    if (!canEdit || !isDirty) return;
    void updateCurrentSlideNotes(notesDraft);
  }, [canEdit, isDirty, notesDraft, updateCurrentSlideNotes]);

  const handleResetNotes = useCallback(() => {
    setNotesDraft(currentSlide?.notes ?? '');
  }, [currentSlide?.notes]);

  return {
    canEdit,
    notesDraft,
    isDirty,
    hasSlide,
    placeholder,
    handleNotesChange,
    handleSaveNotes,
    handleResetNotes,
  };
}
