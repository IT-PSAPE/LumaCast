// Editing for the selected cue(s): empty state, a single cue's text/timing/
// detach controls (plus the full Text/Position/Transition override editor
// once detached), or a bulk summary for several cues.
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  Italic, RotateCcw, Trash2, Underline,
} from 'lucide-react';
import { ColorField, EmptyState, Label, NumberField, Panel, ReacstButton, Section, SegmentedControl, Select, Switch, Textarea } from '@lumacast/ui';
import type { TextCaseTransform, TextHorizontalAlign, TextVerticalAlign } from '@lumacast/composition';
import { resolveCueStyle } from '../../../shared/cue-model';
import type {
  ChordCue,
  CueOverride,
  TextBox,
  TextStyle,
  Transition,
  TransitionKind,
} from '../../../shared/project';
import { useChordStore } from '../../store';
import { NativeColorPicker } from '../../components/native-color-picker';
import { TimecodeInput } from '../../components/timecode-input';
import { useSystemFonts } from './use-system-fonts';

const TRANSITION_OPTIONS: Array<{ value: TransitionKind; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'slide-down', label: 'Slide down' },
  { value: 'scale', label: 'Scale' },
];

const WEIGHT_OPTIONS = [
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '700', label: 'Bold' },
];

const CASE_OPTIONS: Array<{ value: TextCaseTransform; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'uppercase', label: 'Uppercase' },
  { value: 'sentence', label: 'Sentence case' },
];

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <ReacstButton.Icon label="Reset to theme" onClick={onClick} className="ml-auto">
      <RotateCcw size={12} />
    </ReacstButton.Icon>
  );
}

export function CueTab() {
  const selection = useChordStore((s) => s.selection);
  const cues = useChordStore((s) => s.document.project.cues);
  const deleteCues = useChordStore((s) => s.deleteCues);
  const detachCue = useChordStore((s) => s.detachCue);
  const relinkCue = useChordStore((s) => s.relinkCue);

  const selected = cues.filter((cue) => selection.includes(cue.id));

  if (selected.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Title>Select a lyric on the timeline</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  if (selected.length > 1) {
    const anyLinked = selected.some((cue) => cue.override === null);
    const anyDetached = selected.some((cue) => cue.override !== null);
    return (
      <Panel.Body className="flex flex-col divide-y divide-primary">
        <Section density="compact" className="px-3 py-3">
          <Section.Body>
            <Label.xs className="text-secondary">{selected.length} cues selected</Label.xs>
            <div className="flex gap-1.5">
              {anyLinked ? <ReacstButton onClick={() => selected.forEach((cue) => detachCue(cue.id))}>Detach</ReacstButton> : null}
              {anyDetached ? <ReacstButton onClick={() => selected.forEach((cue) => relinkCue(cue.id))}>Relink</ReacstButton> : null}
            </div>
            <ReacstButton variant="danger" onClick={() => deleteCues(selected.map((cue) => cue.id))}>
              <Trash2 size={14} /> Delete {selected.length} cues
            </ReacstButton>
          </Section.Body>
        </Section>
      </Panel.Body>
    );
  }

  return <SingleCueEditor cue={selected[0]!} />;
}

function SingleCueEditor({ cue }: { cue: ChordCue }) {
  const theme = useChordStore((s) => s.document.project.theme);
  const setCueText = useChordStore((s) => s.setCueText);
  const updateCue = useChordStore((s) => s.updateCue);
  const deleteCues = useChordStore((s) => s.deleteCues);
  const detachCue = useChordStore((s) => s.detachCue);
  const relinkCue = useChordStore((s) => s.relinkCue);
  const setCueOverride = useChordStore((s) => s.setCueOverride);
  const beginTransaction = useChordStore((s) => s.beginTransaction);
  const endTransaction = useChordStore((s) => s.endTransaction);

  const detached = cue.override !== null;
  const resolved = resolveCueStyle(theme, cue);
  const fontOptions = useSystemFonts(resolved.text.fontFamily);

  function patchOverride(patch: Partial<CueOverride>) {
    setCueOverride(cue.id, { ...cue.override, ...patch });
  }
  function patchOverrideText(patch: Partial<TextStyle>) {
    patchOverride({ text: { ...cue.override?.text, ...patch } });
  }
  function patchOverrideBox(patch: Partial<TextBox>) {
    patchOverride({ box: { ...cue.override?.box, ...patch } });
  }
  function patchOverrideTransition(patch: Partial<Transition>) {
    patchOverride({ transition: { ...cue.override?.transition, ...patch } });
  }
  function resetSection(key: 'text' | 'box' | 'transition') {
    const next = { ...cue.override };
    delete next[key];
    setCueOverride(cue.id, next);
  }

  return (
    <Panel.Body className="flex flex-col divide-y divide-primary">
      <Section density="compact" className="px-3 py-3">
        <Section.Body>
          {/* Focus events bubble: one undo step spans a whole editing session. */}
          <div onFocus={() => beginTransaction('Edit text')} onBlur={() => endTransaction()}>
            <Textarea
              value={cue.text}
              label="Cue text"
              labelPlacement="hidden"
              rows={2}
              autoResize
              onValueChange={(value) => setCueText(cue.id, value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <TimecodeInput ms={cue.startMs} ariaLabel="Start" onCommit={(value) => value !== null && updateCue(cue.id, { startMs: value })} />
            <TimecodeInput ms={cue.endMs} allowAuto ariaLabel="End" onCommit={(value) => updateCue(cue.id, { endMs: value })} />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Label.xs className="text-tertiary">Detach from theme</Label.xs>
            <Switch checked={detached} onCheckedChange={(checked) => (checked ? detachCue(cue.id) : relinkCue(cue.id))} label="Detach from theme" />
          </div>
        </Section.Body>
      </Section>

      {detached ? (
        <>
          <Section density="compact" className="px-3 py-3">
            <Section.Header><Section.Title>Text</Section.Title><Section.Actions>{cue.override?.text ? <ResetButton onClick={() => resetSection('text')} /> : null}</Section.Actions></Section.Header>
            <Section.Body>
              <div className="grid grid-cols-2 gap-1.5">
                <Select value={resolved.text.fontFamily} options={fontOptions} onValueChange={(value) => patchOverrideText({ fontFamily: value })} label="Font family" labelPlacement="hidden" />
                <Select value={resolved.text.weight ?? '400'} options={WEIGHT_OPTIONS} onValueChange={(value) => patchOverrideText({ weight: value })} label="Weight" labelPlacement="hidden" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField value={resolved.text.fontSize} min={1} onValueChange={(value) => patchOverrideText({ fontSize: value })} label="Font size" labelPlacement="hidden" suffix="px" />
                <NumberField value={resolved.text.lineHeight ?? 1.2} step={0.05} min={0.5} max={4} onValueChange={(value) => patchOverrideText({ lineHeight: value })} label="Line height" labelPlacement="hidden" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField value={resolved.text.letterSpacing ?? 0} step={0.5} onValueChange={(value) => patchOverrideText({ letterSpacing: value })} label="Letter spacing" labelPlacement="hidden" />
                <ColorField value={resolved.text.color} onValueChange={(value) => patchOverrideText({ color: value })} label="Text colour" labelPlacement="hidden" picker={<NativeColorPicker value={resolved.text.color} onValueChange={(value) => patchOverrideText({ color: value })} />} />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Select value={resolved.text.caseTransform ?? 'none'} options={CASE_OPTIONS} onValueChange={(value) => patchOverrideText({ caseTransform: value })} label="Case" labelPlacement="hidden" />
              </div>
              <div className="flex gap-1.5">
                <SegmentedControl
                  aria-label="Text style"
                  selectionMode="multiple"
                  fill
                  value={[resolved.text.italic ? 'italic' : null, resolved.text.underline ? 'underline' : null].filter((v): v is string => v !== null)}
                  onValueChange={(values) => {
                    const list = values as string[];
                    patchOverrideText({ italic: list.includes('italic'), underline: list.includes('underline') });
                  }}
                >
                  <SegmentedControl.Icon fill value="italic" title="Italic" aria-label="Italic"><Italic size={14} /></SegmentedControl.Icon>
                  <SegmentedControl.Icon fill value="underline" title="Underline" aria-label="Underline"><Underline size={14} /></SegmentedControl.Icon>
                </SegmentedControl>
              </div>
              <div className="flex gap-1.5">
                <SegmentedControl aria-label="Horizontal alignment" fill className="w-full" value={resolved.text.alignment} onValueChange={(value) => patchOverrideText({ alignment: value as TextHorizontalAlign })}>
                  <SegmentedControl.Icon fill value="left" title="Align left" aria-label="Align left"><AlignLeft size={14} /></SegmentedControl.Icon>
                  <SegmentedControl.Icon fill value="center" title="Align centre" aria-label="Align centre"><AlignCenter size={14} /></SegmentedControl.Icon>
                  <SegmentedControl.Icon fill value="right" title="Align right" aria-label="Align right"><AlignRight size={14} /></SegmentedControl.Icon>
                  <SegmentedControl.Icon fill value="justify" title="Justify" aria-label="Justify"><AlignJustify size={14} /></SegmentedControl.Icon>
                </SegmentedControl>
                <SegmentedControl aria-label="Vertical alignment" fill className="w-full" value={resolved.text.verticalAlign ?? 'middle'} onValueChange={(value) => patchOverrideText({ verticalAlign: value as TextVerticalAlign })}>
                  <SegmentedControl.Icon fill value="top" title="Align top" aria-label="Align top"><AlignVerticalJustifyStart size={14} /></SegmentedControl.Icon>
                  <SegmentedControl.Icon fill value="middle" title="Align middle" aria-label="Align middle"><AlignVerticalJustifyCenter size={14} /></SegmentedControl.Icon>
                  <SegmentedControl.Icon fill value="bottom" title="Align bottom" aria-label="Align bottom"><AlignVerticalJustifyEnd size={14} /></SegmentedControl.Icon>
                </SegmentedControl>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Label.xs className="text-tertiary">Auto-fit</Label.xs>
                <Switch checked={resolved.text.autoFit ?? false} onCheckedChange={(checked) => patchOverrideText({ autoFit: checked })} label="Auto-fit text" />
              </div>
              {resolved.text.autoFit ? (
                <NumberField value={resolved.text.autoFitMaxFontSize ?? resolved.text.fontSize} min={1} onValueChange={(value) => patchOverrideText({ autoFitMaxFontSize: value })} label="Max font size" labelPlacement="hidden" suffix="px" />
              ) : null}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Label.xs className="text-tertiary">Stroke</Label.xs>
                <Switch checked={resolved.text.textStrokeEnabled ?? false} onCheckedChange={(checked) => patchOverrideText({ textStrokeEnabled: checked })} label="Enable stroke" />
              </div>
              {resolved.text.textStrokeEnabled ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <ColorField value={resolved.text.textStrokeColor ?? '#000000'} onValueChange={(value) => patchOverrideText({ textStrokeColor: value })} label="Stroke colour" labelPlacement="hidden" picker={<NativeColorPicker value={resolved.text.textStrokeColor ?? '#000000'} onValueChange={(value) => patchOverrideText({ textStrokeColor: value })} />} />
                  <NumberField value={resolved.text.textStrokeWidth ?? 2} min={0} onValueChange={(value) => patchOverrideText({ textStrokeWidth: value })} label="Stroke width" labelPlacement="hidden" suffix="px" />
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Label.xs className="text-tertiary">Shadow</Label.xs>
                <Switch checked={resolved.text.textShadowEnabled ?? false} onCheckedChange={(checked) => patchOverrideText({ textShadowEnabled: checked })} label="Enable shadow" />
              </div>
              {resolved.text.textShadowEnabled ? (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <ColorField value={resolved.text.textShadowColor ?? '#000000'} onValueChange={(value) => patchOverrideText({ textShadowColor: value })} label="Shadow colour" labelPlacement="hidden" picker={<NativeColorPicker value={resolved.text.textShadowColor ?? '#000000'} onValueChange={(value) => patchOverrideText({ textShadowColor: value })} />} />
                    <NumberField value={resolved.text.textShadowBlur ?? 0} min={0} onValueChange={(value) => patchOverrideText({ textShadowBlur: value })} label="Shadow blur" labelPlacement="hidden" suffix="px" />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumberField value={resolved.text.textShadowOffsetX ?? 0} onValueChange={(value) => patchOverrideText({ textShadowOffsetX: value })} label="Shadow offset X" labelPlacement="hidden" />
                    <NumberField value={resolved.text.textShadowOffsetY ?? 0} onValueChange={(value) => patchOverrideText({ textShadowOffsetY: value })} label="Shadow offset Y" labelPlacement="hidden" />
                  </div>
                </>
              ) : null}
            </Section.Body>
          </Section>

          <Section density="compact" className="px-3 py-3">
            <Section.Header><Section.Title>Position</Section.Title><Section.Actions>{cue.override?.box ? <ResetButton onClick={() => resetSection('box')} /> : null}</Section.Actions></Section.Header>
            <Section.Body>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField value={resolved.box.x} onValueChange={(value) => patchOverrideBox({ x: value })} label="X" labelPlacement="hidden" />
                <NumberField value={resolved.box.y} onValueChange={(value) => patchOverrideBox({ y: value })} label="Y" labelPlacement="hidden" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField value={resolved.box.width} min={0} onValueChange={(value) => patchOverrideBox({ width: value })} label="Width" labelPlacement="hidden" />
                <NumberField value={resolved.box.height} min={0} onValueChange={(value) => patchOverrideBox({ height: value })} label="Height" labelPlacement="hidden" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField value={resolved.box.rotation} onValueChange={(value) => patchOverrideBox({ rotation: value })} label="Rotation" labelPlacement="hidden" suffix="°" />
                <NumberField value={resolved.box.opacity} min={0} max={1} step={0.05} onValueChange={(value) => patchOverrideBox({ opacity: value })} label="Opacity" labelPlacement="hidden" />
              </div>
            </Section.Body>
          </Section>

          <Section density="compact" className="px-3 py-3">
            <Section.Header><Section.Title>Transition</Section.Title><Section.Actions>{cue.override?.transition ? <ResetButton onClick={() => resetSection('transition')} /> : null}</Section.Actions></Section.Header>
            <Section.Body>
              <div className="grid grid-cols-2 gap-1.5">
                <Select value={resolved.transition.in} options={TRANSITION_OPTIONS} onValueChange={(value) => patchOverrideTransition({ in: value })} label="Transition in" labelPlacement="hidden" />
                <Select value={resolved.transition.out} options={TRANSITION_OPTIONS} onValueChange={(value) => patchOverrideTransition({ out: value })} label="Transition out" labelPlacement="hidden" />
              </div>
              <NumberField value={resolved.transition.durationMs} min={0} step={50} onValueChange={(value) => patchOverrideTransition({ durationMs: value })} label="Transition duration" labelPlacement="hidden" suffix="ms" />
            </Section.Body>
          </Section>
        </>
      ) : null}

      <Section density="compact" className="px-3 py-3">
        <Section.Body>
          <ReacstButton variant="danger" onClick={() => deleteCues([cue.id])}>
            <Trash2 size={14} /> Delete cue
          </ReacstButton>
        </Section.Body>
      </Section>
    </Panel.Body>
  );
}
