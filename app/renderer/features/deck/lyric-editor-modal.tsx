import { useEffect, useRef, useState } from 'react';
import { Baseline, Layers, MoveHorizontal, MoveVertical, Settings, Type } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { Dialog } from '../../components/overlays/dialog';
import DocEditor, { type Block } from '../../components/form/doc-editor';
import { useNavigation } from '../../contexts/navigation-context';
import { useLyricEditorSave } from './use-lyric-editor-document';
import { useLyricLayoutConfig, DEFAULT_LYRIC_LAYOUT_CONFIG, type LyricLayoutConfig } from './lyric-layout-config';
import { groupSegmentsForSlides, joinSegments } from './lyric-slide-grouping';
import { FieldIcon, FieldInput, FieldSelect } from '../../components/form/field';
import { Section } from '../inspector/inspector-section';
import { Label } from '../../components/display/text';
import { useSystemFonts } from '../inspector/use-system-fonts';

interface LyricEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LyricEditorModal({ isOpen, onClose }: LyricEditorModalProps) {
  const { currentDeckItem } = useNavigation();
  const { config, updateConfig } = useLyricLayoutConfig();
  const { initialBlocks, saveBlocks, isSaving } = useLyricEditorSave({ isOpen, onClose, config });
  const blocksRef = useRef<Block[]>(initialBlocks);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [editorBlocks, setEditorBlocks] = useState<Block[]>(initialBlocks);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [hasAppliedGrouping, setHasAppliedGrouping] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    blocksRef.current = initialBlocks;
    setEditorBlocks(initialBlocks);
    setEditorEpoch((n) => n + 1);
    setHasAppliedGrouping(false);
  }, [isOpen, initialBlocks]);

  function handleChange(blocks: Block[]) {
    blocksRef.current = blocks;
  }

  function handleSave() {
    void saveBlocks(blocksRef.current, { skipGrouping: hasAppliedGrouping });
  }

  function handlePreview() {
    const segments = blocksRef.current
      .map((block) => block.content.replace(/^[ \t\n]+|[ \t\n]+$/g, ''))
      .filter((content) => content.length > 0);
    const groups = groupSegmentsForSlides(segments, config);
    const groupedBlocks: Block[] = groups.map((group) => ({
      id: Math.random().toString(36).slice(2, 9),
      content: joinSegments(group),
    }));
    blocksRef.current = groupedBlocks;
    setEditorBlocks(groupedBlocks);
    setEditorEpoch((n) => n + 1);
    setHasAppliedGrouping(true);
  }

  if (!isOpen || !currentDeckItem || currentDeckItem.type !== 'lyric') return null;

  return (
    <>
      <Dialog.Root open onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
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
              <Dialog.Body className="h-full overflow-auto bg-primary/95 px-0 py-0">
                <DocEditor key={editorEpoch} initialBlocks={editorBlocks} onChange={handleChange} />
              </Dialog.Body>
              <Dialog.Footer>
                <ReacstButton variant="default" onClick={handlePreview} disabled={isSaving}>Preview</ReacstButton>
                <div className="flex items-center gap-2">
                  <ReacstButton variant="ghost" onClick={onClose} disabled={isSaving}>Cancel</ReacstButton>
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

interface LyricLayoutConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: LyricLayoutConfig;
  onSave: (next: LyricLayoutConfig) => void;
}

function LyricLayoutConfigDialog({ isOpen, onClose, config, onSave }: LyricLayoutConfigDialogProps) {
  const [draft, setDraft] = useState<LyricLayoutConfig>(config);
  const fontOptions = useSystemFonts(draft.fontFamily);

  useEffect(() => {
    if (isOpen) setDraft(config);
  }, [isOpen, config]);

  if (!isOpen) return null;

  function patch<K extends keyof LyricLayoutConfig>(key: K, value: LyricLayoutConfig[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function numericPatch<K extends keyof LyricLayoutConfig>(key: K, raw: string, fallback: number) {
    const parsed = Number(raw);
    patch(key, (Number.isFinite(parsed) ? parsed : fallback) as LyricLayoutConfig[K]);
  }

  function handleSubmit() {
    onSave(draft);
    onClose();
  }

  function handleReset() {
    setDraft(DEFAULT_LYRIC_LAYOUT_CONFIG);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-ui-region="lyric-layout-config" className="w-full max-w-md">
            <Dialog.Header>
              <Dialog.Title>Layout settings</Dialog.Title>
              <Dialog.CloseButton />
            </Dialog.Header>
            <Dialog.Body className="px-4 py-4">
              <Section.Root>
                <Section.Header><Label.xs>Text box</Label.xs></Section.Header>
                <Section.Body>
                  <Section.Row>
                    <FieldInput type="number" value={draft.boxWidth} onChange={(v) => numericPatch('boxWidth', v, DEFAULT_LYRIC_LAYOUT_CONFIG.boxWidth)}>
                      <FieldIcon><MoveHorizontal className="size-4" /></FieldIcon>
                    </FieldInput>
                    <FieldInput type="number" value={draft.boxHeight} onChange={(v) => numericPatch('boxHeight', v, DEFAULT_LYRIC_LAYOUT_CONFIG.boxHeight)}>
                      <FieldIcon><MoveVertical className="size-4" /></FieldIcon>
                    </FieldInput>
                  </Section.Row>
                </Section.Body>
              </Section.Root>

              <Section.Root>
                <Section.Header><Label.xs>Typography</Label.xs></Section.Header>
                <Section.Body>
                  <Section.Row>
                    <FieldSelect value={draft.fontFamily} onChange={(v) => patch('fontFamily', v)} options={fontOptions} />
                    <FieldInput type="text" value={draft.fontWeight} onChange={(v) => patch('fontWeight', v)} />
                  </Section.Row>
                  <Section.Row>
                    <FieldInput type="number" value={draft.fontSize} onChange={(v) => numericPatch('fontSize', v, DEFAULT_LYRIC_LAYOUT_CONFIG.fontSize)}>
                      <FieldIcon><Type className="size-4" /></FieldIcon>
                    </FieldInput>
                    <FieldInput type="number" value={draft.lineHeight} onChange={(v) => numericPatch('lineHeight', v, DEFAULT_LYRIC_LAYOUT_CONFIG.lineHeight)}>
                      <FieldIcon><Baseline className="size-4" /></FieldIcon>
                    </FieldInput>
                  </Section.Row>
                </Section.Body>
              </Section.Root>

              <Section.Root>
                <Section.Header><Label.xs>Slide composition</Label.xs></Section.Header>
                <Section.Body>
                  <Section.Row>
                    <FieldInput type="number" value={draft.segmentsPerSlide} onChange={(v) => numericPatch('segmentsPerSlide', v, DEFAULT_LYRIC_LAYOUT_CONFIG.segmentsPerSlide)} min={1}>
                      <FieldIcon><Layers className="size-4" /></FieldIcon>
                    </FieldInput>
                  </Section.Row>
                </Section.Body>
              </Section.Root>
            </Dialog.Body>
            <Dialog.Footer>
              <ReacstButton variant="ghost" onClick={handleReset}>Reset</ReacstButton>
              <div className="flex items-center gap-2">
                <ReacstButton variant="ghost" onClick={onClose}>Cancel</ReacstButton>
                <ReacstButton variant="take" onClick={handleSubmit}>Apply</ReacstButton>
              </div>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
