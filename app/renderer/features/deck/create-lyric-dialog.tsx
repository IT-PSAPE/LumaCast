import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { DeckItemIcon } from '../../components/display/entity-icon';
import { Dialog } from '../../components/overlays/dialog';

interface CreateLyricDialogProps {
  isBusy: boolean;
  isOpen: boolean;
  onClose: () => void;
  onCreateEditableLyric: () => void;
  onCreateEmptyLyric: () => void;
}

export function CreateLyricDialog({ isBusy, isOpen, onClose, onCreateEditableLyric, onCreateEmptyLyric }: CreateLyricDialogProps) {
  if (!isOpen) return null;

  function handleClose() {
    if (isBusy) return;
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-ui-region="create-lyric-dialog" className="max-w-2xl">
            <Dialog.Header>
              <Dialog.Title>Create lyric</Dialog.Title>
              <Dialog.CloseButton />
            </Dialog.Header>
            <Dialog.Body className="bg-primary/95 px-6 py-6">
              <LumaCastPanel.Root className="justify-between rounded-lg border border-primary bg-tertiary/20 p-6">
                <div className="flex flex-col gap-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary bg-primary text-secondary">
                    <DeckItemIcon entity="lyric" size={22} strokeWidth={1.75} />
                  </div>
                  <div className="space-y-2">
                    <h2 className="m-0 text-xl font-semibold text-primary">Lyric</h2>
                    <p className="m-0 max-w-xl text-sm text-secondary">
                      Start with one slide, or open the lyric editor and generate slides when you save.
                    </p>
                  </div>
                </div>
                <div className="pt-6">
                  <div className="flex flex-wrap gap-2">
                    <ReacstButton variant="ghost" onClick={onCreateEmptyLyric} disabled={isBusy} className="px-3 py-2 text-sm">
                      Empty
                    </ReacstButton>
                    <ReacstButton variant="take" onClick={onCreateEditableLyric} disabled={isBusy} className="px-3 py-2 text-sm">
                      Edit
                    </ReacstButton>
                  </div>
                </div>
              </LumaCastPanel.Root>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
