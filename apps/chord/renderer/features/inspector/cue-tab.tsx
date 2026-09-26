// Editing for the selected cue(s): empty state, a single cue's text/timing/
// detach controls (plus the full Text/Position/Transition override editor
// once detached), or a bulk summary for several cues.
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  Italic, RotateCcw, Trash2, Underline,
} from 'lucide-react';
import { EmptyState, Label, ReacstButton, SegmentedControl } from '@lumacast/ui';
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
import { AutoGrowTextarea, ColorField, NumberField, SelectField, SwitchField } from '../../components/field';
import { TimecodeInput } from '../../components/timecode-input';
import { Section } from './inspector-section';
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
      <div className="flex flex-1 flex-col overflow-y-auto">
        <Section.Root className="border-b-0">
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
        </Section.Root>
      </div>
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
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Section.Root>
        <Section.Body>
          <AutoGrowTextarea
            value={cue.text}
            ariaLabel="Cue text"
            minRows={2}
            onFocus={() => beginTransaction('Edit text')}
            onBlur={() => endTransaction()}
            onChange={(value) => setCueText(cue.id, value)}
          />
          <Section.Row>
            <TimecodeInput ms={cue.startMs} ariaLabel="Start" onCommit={(value) => value !== null && updateCue(cue.id, { startMs: value })} />
            <TimecodeInput ms={cue.endMs} allowAuto ariaLabel="End" onCommit={(value) => updateCue(cue.id, { endMs: value })} />
          </Section.Row>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Label.xs className="text-tertiary">Detach from theme</Label.xs>
            <SwitchField checked={detached} onChange={(checked) => (checked ? detachCue(cue.id) : relinkCue(cue.id))} ariaLabel="Detach from theme" />
          </div>
        </Section.Body>
      </Section.Root>

      {detached ? (
        <>
          <Section.Root>
            <Section.Header>
              <Label.xs className="text-tertiary">Text</Label.xs>
              {cue.override?.text ? <ResetButton onClick={() => resetSection('text')} /> : null}
            </Section.Header>
            <Section.Body>
              <Section.Row>
                <SelectField value={resolved.text.fontFamily} options={fontOptions} onChange={(value) => patchOverrideText({ fontFamily: value })} ariaLabel="Font family" />
                <SelectField value={resolved.text.weight ?? '400'} options={WEIGHT_OPTIONS} onChange={(value) => patchOverrideText({ weight: value })} ariaLabel="Weight" />
              </Section.Row>
              <Section.Row>
                <NumberField value={resolved.text.fontSize} min={1} onCommit={(value) => patchOverrideText({ fontSize: value })} ariaLabel="Font size" suffix="px" />
                <NumberField value={resolved.text.lineHeight ?? 1.2} step={0.05} min={0.5} max={4} onCommit={(value) => patchOverrideText({ lineHeight: value })} ariaLabel="Line height" />
              </Section.Row>
              <Section.Row>
                <NumberField value={resolved.text.letterSpacing ?? 0} step={0.5} onCommit={(value) => patchOverrideText({ letterSpacing: value })} ariaLabel="Letter spacing" />
                <ColorField value={resolved.text.color} onChange={(value) => patchOverrideText({ color: value })} ariaLabel="Text colour" />
              </Section.Row>
              <Section.Row>
                <SelectField value={resolved.text.caseTransform ?? 'none'} options={CASE_OPTIONS} onChange={(value) => patchOverrideText({ caseTransform: value })} ariaLabel="Case" />
              </Section.Row>
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
                <SwitchField checked={resolved.text.autoFit ?? false} onChange={(checked) => patchOverrideText({ autoFit: checked })} ariaLabel="Auto-fit text" />
              </div>
              {resolved.text.autoFit ? (
                <NumberField value={resolved.text.autoFitMaxFontSize ?? resolved.text.fontSize} min={1} onCommit={(value) => patchOverrideText({ autoFitMaxFontSize: value })} ariaLabel="Max font size" suffix="px" />
              ) : null}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Label.xs className="text-tertiary">Stroke</Label.xs>
                <SwitchField checked={resolved.text.textStrokeEnabled ?? false} onChange={(checked) => patchOverrideText({ textStrokeEnabled: checked })} ariaLabel="Enable stroke" />
              </div>
              {resolved.text.textStrokeEnabled ? (
                <Section.Row>
                  <ColorField value={resolved.text.textStrokeColor ?? '#000000'} onChange={(value) => patchOverrideText({ textStrokeColor: value })} ariaLabel="Stroke colour" />
                  <NumberField value={resolved.text.textStrokeWidth ?? 2} min={0} onCommit={(value) => patchOverrideText({ textStrokeWidth: value })} ariaLabel="Stroke width" suffix="px" />
                </Section.Row>
              ) : null}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Label.xs className="text-tertiary">Shadow</Label.xs>
                <SwitchField checked={resolved.text.textShadowEnabled ?? false} onChange={(checked) => patchOverrideText({ textShadowEnabled: checked })} ariaLabel="Enable shadow" />
              </div>
              {resolved.text.textShadowEnabled ? (
                <>
                  <Section.Row>
                    <ColorField value={resolved.text.textShadowColor ?? '#000000'} onChange={(value) => patchOverrideText({ textShadowColor: value })} ariaLabel="Shadow colour" />
                    <NumberField value={resolved.text.textShadowBlur ?? 0} min={0} onCommit={(value) => patchOverrideText({ textShadowBlur: value })} ariaLabel="Shadow blur" suffix="px" />
                  </Section.Row>
                  <Section.Row>
                    <NumberField value={resolved.text.textShadowOffsetX ?? 0} onCommit={(value) => patchOverrideText({ textShadowOffsetX: value })} ariaLabel="Shadow offset X" />
                    <NumberField value={resolved.text.textShadowOffsetY ?? 0} onCommit={(value) => patchOverrideText({ textShadowOffsetY: value })} ariaLabel="Shadow offset Y" />
                  </Section.Row>
                </>
              ) : null}
            </Section.Body>
          </Section.Root>

          <Section.Root>
            <Section.Header>
              <Label.xs className="text-tertiary">Position</Label.xs>
              {cue.override?.box ? <ResetButton onClick={() => resetSection('box')} /> : null}
            </Section.Header>
            <Section.Body>
              <Section.Row>
                <NumberField value={resolved.box.x} onCommit={(value) => patchOverrideBox({ x: value })} ariaLabel="X" />
                <NumberField value={resolved.box.y} onCommit={(value) => patchOverrideBox({ y: value })} ariaLabel="Y" />
              </Section.Row>
              <Section.Row>
                <NumberField value={resolved.box.width} min={0} onCommit={(value) => patchOverrideBox({ width: value })} ariaLabel="Width" />
                <NumberField value={resolved.box.height} min={0} onCommit={(value) => patchOverrideBox({ height: value })} ariaLabel="Height" />
              </Section.Row>
              <Section.Row>
                <NumberField value={resolved.box.rotation} onCommit={(value) => patchOverrideBox({ rotation: value })} ariaLabel="Rotation" suffix="°" />
                <NumberField value={resolved.box.opacity} min={0} max={1} step={0.05} onCommit={(value) => patchOverrideBox({ opacity: value })} ariaLabel="Opacity" />
              </Section.Row>
            </Section.Body>
          </Section.Root>

          <Section.Root className="border-b-0">
            <Section.Header>
              <Label.xs className="text-tertiary">Transition</Label.xs>
              {cue.override?.transition ? <ResetButton onClick={() => resetSection('transition')} /> : null}
            </Section.Header>
            <Section.Body>
              <Section.Row>
                <SelectField value={resolved.transition.in} options={TRANSITION_OPTIONS} onChange={(value) => patchOverrideTransition({ in: value })} ariaLabel="Transition in" />
                <SelectField value={resolved.transition.out} options={TRANSITION_OPTIONS} onChange={(value) => patchOverrideTransition({ out: value })} ariaLabel="Transition out" />
              </Section.Row>
              <NumberField value={resolved.transition.durationMs} min={0} step={50} onCommit={(value) => patchOverrideTransition({ durationMs: value })} ariaLabel="Transition duration" suffix="ms" />
            </Section.Body>
          </Section.Root>
        </>
      ) : null}

      <Section.Root className="border-b-0">
        <Section.Body>
          <ReacstButton variant="danger" onClick={() => deleteCues([cue.id])}>
            <Trash2 size={14} /> Delete cue
          </ReacstButton>
        </Section.Body>
      </Section.Root>
    </div>
  );
}
