import type { Id } from '@lumacast/kernel';
import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useSlides } from '@renderer/contexts/slide-context';
import { SlideAutomationMenu } from '../automation/slide-automation-menu';
import { SlideBindingsMenu } from '../automation/slide-bindings-menu';
import { SlideTagMenu } from './slide-tag-menu';

export function SlideActionsMenu({ slideIds }: { slideIds: Id[] }) {
  const { slides, duplicateSlide, deleteSlide, moveSlide } = useSlides();
  const confirm = useConfirm();
  const count = slideIds.length;
  const singleIndex = count === 1 ? slides.findIndex((slide) => slide.id === slideIds[0]) : -1;
  const isFirst = singleIndex <= 0;
  const isLast = singleIndex === -1 || singleIndex === slides.length - 1;

  async function duplicateSelected() {
    for (const slideId of slideIds) await duplicateSlide(slideId);
  }

  async function deleteSelected() {
    const ok = await confirm({
      title: count === 1 ? 'Delete slide?' : `Delete ${count} slides?`,
      description: count === 1
        ? 'This slide and all its elements will be permanently removed.'
        : 'These slides and all their elements will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    for (const slideId of [...slideIds].reverse()) await deleteSlide(slideId);
  }

  return (
    <>
      {count === 1 ? (
        <>
          <ContextMenu.Item disabled={isFirst} onSelect={() => {
            // moveSlide rejects when the slide no longer exists (#214), which
            // a context-menu action can race with a concurrent delete.
            // mutatePatch has already reported the failure, so absorb the
            // rethrow here.
            void moveSlide(slideIds[0], 'up').catch(() => undefined);
          }}>Move up</ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onSelect={() => {
            // See "Move up" above: same race, same absorption.
            void moveSlide(slideIds[0], 'down').catch(() => undefined);
          }}>Move down</ContextMenu.Item>
          <ContextMenu.Separator />
        </>
      ) : null}
      <ContextMenu.Item onSelect={() => { void duplicateSelected(); }}>
        {count === 1 ? 'Duplicate' : `Duplicate ${count} slides`}
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <SlideAutomationMenu slideIds={slideIds} />
      <SlideTagMenu slideIds={slideIds} />
      {count === 1 ? <SlideBindingsMenu slideId={slideIds[0]} /> : null}
      <ContextMenu.Separator />
      <ContextMenu.Item variant="destructive" onSelect={() => { void deleteSelected(); }}>
        {count === 1 ? 'Delete' : `Delete ${count} slides`}
      </ContextMenu.Item>
    </>
  );
}
