import type { Id } from '@lumacast/kernel';
import { ContextMenu } from '@lumacast/ui';
import { useSlides } from '@renderer/contexts/slide-context';
import { useNavigation } from '@renderer/contexts/navigation-context';
import { moveSlideIdsAsBlock, persistSlideReorder } from './use-slide-reorder';
import { useSlideBulkActions } from './use-slide-bulk-actions';
import { SlideAutomationMenu } from '../automation/slide-automation-menu';
import { SlideBindingsMenu } from '../automation/slide-bindings-menu';
import { SlideTagMenu } from './slide-tag-menu';

export function SlideActionsMenu({ slideIds: selectedSlideIds }: { slideIds: Id[] }) {
  const { slides, currentSlideIndex, setCurrentSlideIndex, duplicateSlide, deleteSlide, moveSlide, reorderSlide, setLyricBlankSlides } = useSlides();
  const { currentItemRef } = useNavigation();
  const { duplicateSlides, deleteSlides } = useSlideBulkActions({ slides, duplicateSlide, deleteSlide });
  const slideIds = selectedSlideIds.filter((id) => slides.some((slide) => slide.id === id && !slide.runtimeBlank));
  const count = slideIds.length;
  const isRuntimeBlank = count === 0;
  const storedSlides = slides.filter((slide) => !slide.runtimeBlank);
  const storedSlideIds = storedSlides.map((slide) => slide.id);
  const selectedIndex = storedSlideIds.findIndex((id) => slideIds.includes(id));
  const lastSelectedIndex = storedSlideIds.reduce((last, id, index) => slideIds.includes(id) ? index : last, -1);
  const storedSingleIndex = count === 1 ? storedSlides.findIndex((slide) => slide.id === slideIds[0]) : -1;
  const isFirst = count === 1 ? storedSingleIndex <= 0 : selectedIndex <= 0;
  const isLast = count === 1
    ? storedSingleIndex === -1 || storedSingleIndex === storedSlides.length - 1
    : lastSelectedIndex === -1 || lastSelectedIndex === storedSlides.length - 1;

  async function moveSelectedAsBlock(direction: 'up' | 'down') {
    const orderedStoredIds = moveSlideIdsAsBlock(storedSlideIds, slideIds, direction);
    let storedIndex = 0;
    const orderedIds = slides.map((slide) => slide.runtimeBlank ? slide.id : orderedStoredIds[storedIndex++]!);
    const currentSlideId = slides[currentSlideIndex]?.id ?? null;
    await persistSlideReorder(
      { orderedIds, movedIds: slideIds },
      slides.map((slide) => slide.id),
      reorderSlide,
      currentSlideId,
      setCurrentSlideIndex,
    );
  }

  return (
    <>
      {(count === 1 || isRuntimeBlank) && currentItemRef?.type === 'lyric' ? (
        <>
          <ContextMenu.Submenu label="Blank slides">
            <ContextMenu.Item onSelect={() => { void setLyricBlankSlides('none'); }}>None</ContextMenu.Item>
            <ContextMenu.Item onSelect={() => { void setLyricBlankSlides('start'); }}>At beginning</ContextMenu.Item>
            <ContextMenu.Item onSelect={() => { void setLyricBlankSlides('end'); }}>At end</ContextMenu.Item>
            <ContextMenu.Item onSelect={() => { void setLyricBlankSlides('both'); }}>Beginning and end</ContextMenu.Item>
          </ContextMenu.Submenu>
          {!isRuntimeBlank ? <ContextMenu.Separator /> : null}
        </>
      ) : null}
      {!isRuntimeBlank ? (
        <>
          <ContextMenu.Item disabled={isFirst} onSelect={() => {
            if (count === 1) {
              // moveSlide rejects when the slide no longer exists (#214), which
              // a context-menu action can race with a concurrent delete.
              // mutatePatch has already reported the failure, so absorb the rethrow here.
              void moveSlide(slideIds[0], 'up').catch(() => undefined);
            } else {
              void moveSelectedAsBlock('up').catch(() => undefined);
            }
          }}>{count === 1 ? 'Move up' : `Move ${count} slides up`}</ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onSelect={() => {
            if (count === 1) {
              // See "Move up" above: same race, same absorption.
              void moveSlide(slideIds[0], 'down').catch(() => undefined);
            } else {
              void moveSelectedAsBlock('down').catch(() => undefined);
            }
          }}>{count === 1 ? 'Move down' : `Move ${count} slides down`}</ContextMenu.Item>
          <ContextMenu.Separator />
        </>
      ) : null}
      {!isRuntimeBlank ? (
        <>
          <ContextMenu.Item onSelect={() => { void duplicateSlides(slideIds).catch(() => undefined); }}>
            {count === 1 ? 'Duplicate' : `Duplicate ${count} slides`}
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <SlideAutomationMenu slideIds={slideIds} />
          <SlideTagMenu slideIds={slideIds} />
          {count === 1 ? <SlideBindingsMenu slideId={slideIds[0]} /> : null}
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void deleteSlides(slideIds).catch(() => undefined); }}>
            {count === 1 ? 'Delete' : `Delete ${count} slides`}
          </ContextMenu.Item>
        </>
      ) : null}
    </>
  );
}
