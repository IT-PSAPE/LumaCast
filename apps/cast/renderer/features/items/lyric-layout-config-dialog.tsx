import { useEffect, useState } from 'react';
import { Baseline, Layers, MoveHorizontal, MoveVertical, Type } from 'lucide-react';
import { ReacstButton, Label, Select, Modal } from '@lumacast/ui';
import { FieldIcon, FieldInput } from '../../components/form/field';
import { Section } from '../inspector/inspector-section';
import { useSystemFonts } from '../inspector/use-system-fonts';
import {
  DEFAULT_LYRIC_LAYOUT_CONFIG,
  LYRIC_LAYOUT_CONFIG_LIMITS,
  clampLyricLayoutConfig,
  type LyricLayoutConfig,
} from './lyric-layout-config';

interface LyricLayoutConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: LyricLayoutConfig;
  onSave: (next: LyricLayoutConfig) => void;
}

export function LyricLayoutConfigDialog({ isOpen, onClose, config, onSave }: LyricLayoutConfigDialogProps) {
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
    onSave(clampLyricLayoutConfig(draft));
    onClose();
  }

  function handleReset() {
    setDraft(DEFAULT_LYRIC_LAYOUT_CONFIG);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Layout settings"
      size="md"
      className="max-w-md"
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          <ReacstButton variant="ghost" onClick={handleReset}>Reset</ReacstButton>
          <div className="flex items-center gap-2">
            <ReacstButton variant="ghost" onClick={onClose}>Cancel</ReacstButton>
            <ReacstButton variant="take" onClick={handleSubmit}>Apply</ReacstButton>
          </div>
        </div>
      )}
    >
      <div data-ui-region="lyric-layout-config" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Section.Root>
          <Section.Header><Label.xs>Text box</Label.xs></Section.Header>
          <Section.Body>
            <Section.Row>
              <FieldInput type="number" value={draft.boxWidth} min={LYRIC_LAYOUT_CONFIG_LIMITS.boxWidth.min} max={LYRIC_LAYOUT_CONFIG_LIMITS.boxWidth.max} onChange={(v) => numericPatch('boxWidth', v, DEFAULT_LYRIC_LAYOUT_CONFIG.boxWidth)}>
                <FieldIcon><MoveHorizontal className="size-4" /></FieldIcon>
              </FieldInput>
              <FieldInput type="number" value={draft.boxHeight} min={LYRIC_LAYOUT_CONFIG_LIMITS.boxHeight.min} max={LYRIC_LAYOUT_CONFIG_LIMITS.boxHeight.max} onChange={(v) => numericPatch('boxHeight', v, DEFAULT_LYRIC_LAYOUT_CONFIG.boxHeight)}>
                <FieldIcon><MoveVertical className="size-4" /></FieldIcon>
              </FieldInput>
            </Section.Row>
          </Section.Body>
        </Section.Root>

        <Section.Root>
          <Section.Header><Label.xs>Typography</Label.xs></Section.Header>
          <Section.Body>
            <Section.Row>
              <Select value={draft.fontFamily} onValueChange={(v) => patch('fontFamily', v)} options={fontOptions} className="w-full" />
              <Select value={draft.fontWeight} onValueChange={(v) => patch('fontWeight', v)} options={[{ value: "100", label: '100' }, { value: "200", label: '200' }, { value: "300", label: '300' }, { value: "400", label: '400' }, { value: "500", label: '500' }, { value: "600", label: '600' }, { value: "700", label: '700' }, { value: "800", label: '800' }, { value: "900", label: '900' }]} className="w-full" />
            </Section.Row>
            <Section.Row>
              <FieldInput type="number" value={draft.fontSize} min={LYRIC_LAYOUT_CONFIG_LIMITS.fontSize.min} max={LYRIC_LAYOUT_CONFIG_LIMITS.fontSize.max} onChange={(v) => numericPatch('fontSize', v, DEFAULT_LYRIC_LAYOUT_CONFIG.fontSize)}>
                <FieldIcon><Type className="size-4" /></FieldIcon>
              </FieldInput>
              <FieldInput type="number" value={draft.lineHeight} min={LYRIC_LAYOUT_CONFIG_LIMITS.lineHeight.min} max={LYRIC_LAYOUT_CONFIG_LIMITS.lineHeight.max} step={0.1} onChange={(v) => numericPatch('lineHeight', v, DEFAULT_LYRIC_LAYOUT_CONFIG.lineHeight)}>
                <FieldIcon><Baseline className="size-4" /></FieldIcon>
              </FieldInput>
            </Section.Row>
          </Section.Body>
        </Section.Root>

        <Section.Root>
          <Section.Header><Label.xs>Slide composition</Label.xs></Section.Header>
          <Section.Body>
            <Section.Row>
              <FieldInput type="number" value={draft.segmentsPerSlide} min={LYRIC_LAYOUT_CONFIG_LIMITS.segmentsPerSlide.min} max={LYRIC_LAYOUT_CONFIG_LIMITS.segmentsPerSlide.max} onChange={(v) => numericPatch('segmentsPerSlide', v, DEFAULT_LYRIC_LAYOUT_CONFIG.segmentsPerSlide)}>
                <FieldIcon><Layers className="size-4" /></FieldIcon>
              </FieldInput>
            </Section.Row>
          </Section.Body>
        </Section.Root>
      </div>
    </Modal>
  );
}
