import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { ReacstButton } from '@lumacast/ui';
import type { LyricBlankSlideMode } from '@lumacast/composition';
import { Dialog } from '../../components/overlays/dialog';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import DocEditor, { type Block } from '../../components/form/doc-editor';
import { useNavigation } from '../../contexts/navigation-context';
import { useLyricEditorSave } from './use-lyric-editor-document';
import { useLyricLayoutConfig, loadMeasureFont } from './lyric-layout-config';
import { groupBlocksForSlides } from './lyric-slide-grouping';
import { LyricLayoutConfigDialog } from './lyric-layout-config-dialog';
import { LyricBlankSlidesField } from './lyric-blank-slides-menu';

interface LyricEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function blocksEqual(left: Block[], right: Block[]): boolean {
  return left.length === right.length
    && left.every((block, index) => block.id === right[index].id && block.content === right[index].content);
}

export function LyricEditorModal({ isOpen, onClose }: LyricEditorModalProps) {
  const { currentItem, currentItemRef } = useNavigation();
  const { config, updateConfig } = useLyricLayoutConfig();
  const { initialBlocks, saveBlocks, isSaving } = useLyricEditorSave({ isOpen, onClose, config });
  const confirm = useConfirm();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [sessionBlocks, setSessionBlocks] = useState<Block[]>([]);
  const [editorBlocks, setEditorBlocks] = useState<Block[]>([]);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [hasAppliedGrouping, setHasAppliedGrouping] = useState(false);
  const [prePreviewBlocks, setPrePreviewBlocks] = useState<Block[] | null>(null);
  const blocksRef = useRef<Block[]>([]);
  const sessionBlocksRef = useRef<Block[]>([]);
  const [blankSlideMode, setBlankSlideMode] = useState<LyricBlankSlideMode>('none');
  const sessionBlankSlideModeRef = useRef<LyricBlankSlideMode>('none');

  useEffect(() => {
    if (!isOpen) return;
    setSessionBlocks(initialBlocks);
    const mode = currentItem && 'blankSlideMode' in currentItem ? currentItem.blankSlideMode ?? 'none' : 'none';
    setBlankSlideMode(mode);
    sessionBlankSlideModeRef.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    sessionBlocksRef.current = sessionBlocks;
    blocksRef.current = sessionBlocks;
    setEditorBlocks(sessionBlocks);
    setEditorEpoch((n) => n + 1);
    setHasAppliedGrouping(false);
    setPrePreviewBlocks(null);
  }, [sessionBlocks]);

  useEffect(() => {
    if (!isOpen) return;
    if (!currentItemRef || currentItemRef.type !== 'lyric') onClose();
  }, [isOpen, currentItemRef, onClose]);

  if (!isOpen || currentItemRef?.type !== 'lyric') return null;

  function handleChange(blocks: Block[]) {
    blocksRef.current = blocks;
  }

  function isDirty() {
    return blankSlideMode !== sessionBlankSlideModeRef.current
      || !blocksEqual(blocksRef.current, sessionBlocksRef.current);
  }

  async function requestClose() {
    if (isDirty()) {
      const discard = await confirm({
        title: 'Discard changes?',
        confirmLabel: 'Discard',
        destructive: true,
      });
      if (!discard) return;
    }
    onClose();
  }

  function handleSave() {
    void saveBlocks(blocksRef.current, { skipGrouping: hasAppliedGrouping, blankSlideMode });
  }

  async function handlePreview() {
    await loadMeasureFont(config);
    const grouped = groupBlocksForSlides(blocksRef.current, { config });
    setPrePreviewBlocks(blocksRef.current);
    blocksRef.current = grouped;
    setEditorBlocks(grouped);
    setEditorEpoch((n) => n + 1);
    setHasAppliedGrouping(true);
  }

  function handleRevert() {
    if (!prePreviewBlocks) return;
    blocksRef.current = prePreviewBlocks;
    setEditorBlocks(prePreviewBlocks);
    setEditorEpoch((n) => n + 1);
    setHasAppliedGrouping(false);
    setPrePreviewBlocks(null);
  }

  return (
    <>
      <Dialog.Root open onOpenChange={(open) => { if (!open) void requestClose(); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content data-ui-region="lyric-editor-modal" className="h-[calc(100vh-2rem)] w-full max-w-4xl">
              <Dialog.Header>
                <Dialog.Title>Lyric editor</Dialog.Title>
                <div className="flex items-center gap-1">
                  <ReacstButton.Icon label="Layout settings" variant="ghost" onClick={() => setIsConfigOpen(true)}>
                    <Settings />
                  </ReacstButton.Icon>
                  <Dialog.CloseButton />
                </div>
              </Dialog.Header>
              <Dialog.Body className="flex h-full flex-col overflow-auto bg-primary/95 px-0 py-0">
                <div className="shrink-0 border-b border-secondary px-4 py-2">
                  <fieldset disabled={isSaving} className="max-w-56">
                    <LyricBlankSlidesField value={blankSlideMode} onChange={setBlankSlideMode} />
                  </fieldset>
                </div>
                <div className="min-h-0 flex-1">
                  <DocEditor key={editorEpoch} initialBlocks={editorBlocks} onChange={handleChange} />
                </div>
              </Dialog.Body>
              <Dialog.Footer>
                <div className="flex items-center gap-2">
                  {prePreviewBlocks !== null && (
                    <ReacstButton variant="ghost" onClick={handleRevert} disabled={isSaving}>Revert</ReacstButton>
                  )}
                  <ReacstButton variant="default" onClick={() => void handlePreview()} disabled={isSaving}>Preview</ReacstButton>
                </div>
                <div className="flex items-center gap-2">
                  <ReacstButton variant="ghost" onClick={() => void requestClose()} disabled={isSaving}>Cancel</ReacstButton>
                  <ReacstButton variant="take" onClick={handleSave} disabled={isSaving}>Save</ReacstButton>
                </div>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Portal>
      </Dialog.Root>

      <LyricLayoutConfigDialog
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        config={config}
        onSave={updateConfig}
      />
    </>
  );
}
