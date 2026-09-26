// The universal look every linked cue inherits: preset chips, then Text /
// Position / Effects / Transition / Background sections. Every field commits
// straight to `setTheme`/`setBackground` — there is no local draft state at
// this level (the number/text/colour fields below own their own).
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  Italic, Underline, X,
} from 'lucide-react';
import { cn, Label, PlainButton, ReacstButton, SegmentedControl } from '@lumacast/ui';
import type { TextCaseTransform, TextHorizontalAlign, TextVerticalAlign } from '@lumacast/composition';
import { THEME_PRESETS } from '../../../shared/theme-presets';
import type { MediaFit, TextStyle, TransitionKind } from '../../../shared/project';
import { useChordStore } from '../../store';
import { ColorField, NumberField, SelectField, SwitchField } from '../../components/field';
import { importBackground } from '../library/import-flows';
import { Section } from './inspector-section';
import { useSystemFonts } from './use-system-fonts';

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

const TRANSITION_OPTIONS: Array<{ value: TransitionKind; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'slide-down', label: 'Slide down' },
  { value: 'scale', label: 'Scale' },
];

const FIT_OPTIONS: Array<{ value: MediaFit; label: string }> = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'fill', label: 'Fill' },
];

export function ThemeTab() {
  const theme = useChordStore((s) => s.document.project.theme);
  const composition = useChordStore((s) => s.document.project.composition);
  const background = useChordStore((s) => s.document.project.background);
  const backgroundUrl = useChordStore((s) => s.media.backgroundUrl);
  const setTheme = useChordStore((s) => s.setTheme);
  const applyPreset = useChordStore((s) => s.applyPreset);
  const setBackground = useChordStore((s) => s.setBackground);
  const fontOptions = useSystemFonts(theme.text.fontFamily);

  function patchText(patch: Partial<TextStyle>) {
    setTheme({ text: { ...theme.text, ...patch } });
  }
  // Field-only edits (fit/dim/blur/loop) must keep the already-resolved
  // media url — only picking new media (`importBackground`) or switching to
  // a plain colour actually change what `media.backgroundUrl` should be.
  function patchBackgroundMedia(patch: Partial<Extract<typeof background, { kind: 'image' | 'video' }>>) {
    if (background.kind === 'color') return;
    setBackground({ ...background, ...patch } as typeof background, backgroundUrl);
  }
  function patchBox(patch: Partial<typeof theme.box>) {
    setTheme({ box: { ...theme.box, ...patch } });
  }
  function patchTransition(patch: Partial<typeof theme.transition>) {
    setTheme({ transition: { ...theme.transition, ...patch } });
  }

  function centerHorizontally() {
    patchBox({ x: Math.round((composition.width - theme.box.width) / 2) });
  }
  function lowerThird() {
    const height = Math.round(composition.height * 0.22);
    patchBox({ y: Math.round(composition.height * 0.68), height });
  }

  const styleToggles = [theme.text.italic ? 'italic' : null, theme.text.underline ? 'underline' : null].filter(
    (v): v is string => v !== null,
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Section.Root>
        <Section.Header>
          <Label.xs className="text-tertiary">Preset</Label.xs>
        </Section.Header>
        <Section.Body>
          <div className="grid grid-cols-3 gap-2">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-1 rounded-sm border p-1.5 transition-colors',
                  theme.presetId === preset.id ? 'border-brand bg-brand/10' : 'border-primary hover:bg-tertiary',
                )}
              >
                <span
                  className="flex h-7 w-full items-center justify-center rounded-sm text-xs font-semibold"
                  style={{ backgroundColor: preset.swatch.background, color: preset.swatch.text }}
                >
                  Aa
                </span>
                <span className="label-xs w-full truncate text-center text-secondary">{preset.label}</span>
              </button>
            ))}
          </div>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs className="text-tertiary">Text</Label.xs>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <SelectField value={theme.text.fontFamily} options={fontOptions} onChange={(value) => patchText({ fontFamily: value })} ariaLabel="Font family" />
            <SelectField value={theme.text.weight ?? '400'} options={WEIGHT_OPTIONS} onChange={(value) => patchText({ weight: value })} ariaLabel="Weight" />
          </Section.Row>
          <Section.Row>
            <NumberField value={theme.text.fontSize} min={1} onCommit={(value) => patchText({ fontSize: value })} ariaLabel="Font size" suffix="px" />
            <NumberField value={theme.text.lineHeight ?? 1.2} step={0.05} min={0.5} max={4} onCommit={(value) => patchText({ lineHeight: value })} ariaLabel="Line height" />
          </Section.Row>
          <Section.Row>
            <NumberField value={theme.text.letterSpacing ?? 0} step={0.5} onCommit={(value) => patchText({ letterSpacing: value })} ariaLabel="Letter spacing" />
            <ColorField value={theme.text.color} onChange={(value) => patchText({ color: value })} ariaLabel="Text colour" />
          </Section.Row>
          <Section.Row>
            <SegmentedControl
              aria-label="Text style"
              selectionMode="multiple"
              fill
              value={styleToggles}
              onValueChange={(values) => {
                const list = values as string[];
                patchText({ italic: list.includes('italic'), underline: list.includes('underline') });
              }}
            >
              <SegmentedControl.Icon fill value="italic" title="Italic" aria-label="Italic">
                <Italic size={14} />
              </SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="underline" title="Underline" aria-label="Underline">
                <Underline size={14} />
              </SegmentedControl.Icon>
            </SegmentedControl>
            <SelectField value={theme.text.caseTransform ?? 'none'} options={CASE_OPTIONS} onChange={(value) => patchText({ caseTransform: value })} ariaLabel="Case" />
          </Section.Row>
          <div className="flex gap-1.5">
            <SegmentedControl
              aria-label="Horizontal alignment"
              fill
              className="w-full"
              value={theme.text.alignment}
              onValueChange={(value) => patchText({ alignment: value as TextHorizontalAlign })}
            >
              <SegmentedControl.Icon fill value="left" title="Align left" aria-label="Align left"><AlignLeft size={14} /></SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="center" title="Align centre" aria-label="Align centre"><AlignCenter size={14} /></SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="right" title="Align right" aria-label="Align right"><AlignRight size={14} /></SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="justify" title="Justify" aria-label="Justify"><AlignJustify size={14} /></SegmentedControl.Icon>
            </SegmentedControl>
            <SegmentedControl
              aria-label="Vertical alignment"
              fill
              className="w-full"
              value={theme.text.verticalAlign ?? 'middle'}
              onValueChange={(value) => patchText({ verticalAlign: value as TextVerticalAlign })}
            >
              <SegmentedControl.Icon fill value="top" title="Align top" aria-label="Align top"><AlignVerticalJustifyStart size={14} /></SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="middle" title="Align middle" aria-label="Align middle"><AlignVerticalJustifyCenter size={14} /></SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="bottom" title="Align bottom" aria-label="Align bottom"><AlignVerticalJustifyEnd size={14} /></SegmentedControl.Icon>
            </SegmentedControl>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Label.xs className="text-tertiary">Auto-fit</Label.xs>
            <SwitchField checked={theme.text.autoFit ?? false} onChange={(checked) => patchText({ autoFit: checked })} ariaLabel="Auto-fit text" />
          </div>
          {theme.text.autoFit ? (
            <NumberField value={theme.text.autoFitMaxFontSize ?? theme.text.fontSize} min={1} onCommit={(value) => patchText({ autoFitMaxFontSize: value })} ariaLabel="Max font size" suffix="px" />
          ) : null}
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs className="text-tertiary">Position</Label.xs>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <NumberField value={theme.box.x} onCommit={(value) => patchBox({ x: value })} ariaLabel="X" />
            <NumberField value={theme.box.y} onCommit={(value) => patchBox({ y: value })} ariaLabel="Y" />
          </Section.Row>
          <Section.Row>
            <NumberField value={theme.box.width} min={0} onCommit={(value) => patchBox({ width: value })} ariaLabel="Width" />
            <NumberField value={theme.box.height} min={0} onCommit={(value) => patchBox({ height: value })} ariaLabel="Height" />
          </Section.Row>
          <Section.Row>
            <NumberField value={theme.box.rotation} onCommit={(value) => patchBox({ rotation: value })} ariaLabel="Rotation" suffix="°" />
            <NumberField value={theme.box.opacity} min={0} max={1} step={0.05} onCommit={(value) => patchBox({ opacity: value })} ariaLabel="Opacity" />
          </Section.Row>
          <div className="flex gap-1.5">
            <ReacstButton onClick={centerHorizontally}>Center horizontally</ReacstButton>
            <ReacstButton onClick={lowerThird}>Lower third</ReacstButton>
          </div>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs className="text-tertiary">Effects</Label.xs>
        </Section.Header>
        <Section.Body>
          <div className="flex items-center justify-between gap-2">
            <Label.xs className="text-tertiary">Stroke</Label.xs>
            <SwitchField checked={theme.text.textStrokeEnabled ?? false} onChange={(checked) => patchText({ textStrokeEnabled: checked })} ariaLabel="Enable stroke" />
          </div>
          {theme.text.textStrokeEnabled ? (
            <Section.Row>
              <ColorField value={theme.text.textStrokeColor ?? '#000000'} onChange={(value) => patchText({ textStrokeColor: value })} ariaLabel="Stroke colour" />
              <NumberField value={theme.text.textStrokeWidth ?? 2} min={0} onCommit={(value) => patchText({ textStrokeWidth: value })} ariaLabel="Stroke width" suffix="px" />
            </Section.Row>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Label.xs className="text-tertiary">Shadow</Label.xs>
            <SwitchField checked={theme.text.textShadowEnabled ?? false} onChange={(checked) => patchText({ textShadowEnabled: checked })} ariaLabel="Enable shadow" />
          </div>
          {theme.text.textShadowEnabled ? (
            <>
              <Section.Row>
                <ColorField value={theme.text.textShadowColor ?? '#000000'} onChange={(value) => patchText({ textShadowColor: value })} ariaLabel="Shadow colour" />
                <NumberField value={theme.text.textShadowBlur ?? 0} min={0} onCommit={(value) => patchText({ textShadowBlur: value })} ariaLabel="Shadow blur" suffix="px" />
              </Section.Row>
              <Section.Row>
                <NumberField value={theme.text.textShadowOffsetX ?? 0} onCommit={(value) => patchText({ textShadowOffsetX: value })} ariaLabel="Shadow offset X" />
                <NumberField value={theme.text.textShadowOffsetY ?? 0} onCommit={(value) => patchText({ textShadowOffsetY: value })} ariaLabel="Shadow offset Y" />
              </Section.Row>
            </>
          ) : null}
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs className="text-tertiary">Transition</Label.xs>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <SelectField value={theme.transition.in} options={TRANSITION_OPTIONS} onChange={(value) => patchTransition({ in: value })} ariaLabel="Transition in" />
            <SelectField value={theme.transition.out} options={TRANSITION_OPTIONS} onChange={(value) => patchTransition({ out: value })} ariaLabel="Transition out" />
          </Section.Row>
          <NumberField value={theme.transition.durationMs} min={0} step={50} onCommit={(value) => patchTransition({ durationMs: value })} ariaLabel="Transition duration" suffix="ms" />
        </Section.Body>
      </Section.Root>

      <Section.Root className="border-b-0">
        <Section.Header>
          <Label.xs className="text-tertiary">Background</Label.xs>
        </Section.Header>
        <Section.Body>
          <SegmentedControl
            aria-label="Background kind"
            fill
            value={background.kind}
            onValueChange={(value) => {
              if (value === 'color') setBackground({ kind: 'color', color: background.kind === 'color' ? background.color : '#000000' }, null);
              else void importBackground();
            }}
          >
            <SegmentedControl.Label fill value="color">Colour</SegmentedControl.Label>
            <SegmentedControl.Label fill value="image">Image</SegmentedControl.Label>
            <SegmentedControl.Label fill value="video">Video</SegmentedControl.Label>
          </SegmentedControl>

          {background.kind === 'color' ? (
            <ColorField value={background.color} onChange={(value) => setBackground({ kind: 'color', color: value }, null)} ariaLabel="Background colour" />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="label-xs min-w-0 flex-1 truncate text-secondary">{background.media.name}</span>
                <div className="flex shrink-0 gap-1">
                  <PlainButton onClick={() => void importBackground()}>Choose…</PlainButton>
                  <ReacstButton.Icon
                    label="Remove background"
                    onClick={() => setBackground({ kind: 'color', color: '#000000' }, null)}
                  >
                    <X size={14} />
                  </ReacstButton.Icon>
                </div>
              </div>
              <SelectField
                value={background.fit}
                options={FIT_OPTIONS}
                onChange={(value) => patchBackgroundMedia({ fit: value })}
                ariaLabel="Background fit"
              />
              <div className="flex flex-col gap-1">
                <Label.xs className="text-tertiary">Dim</Label.xs>
                <NumberField value={background.dim} min={0} max={1} step={0.05} onCommit={(value) => patchBackgroundMedia({ dim: value })} ariaLabel="Dim" />
              </div>
              <div className="flex flex-col gap-1">
                <Label.xs className="text-tertiary">Blur</Label.xs>
                <NumberField value={background.blur} min={0} max={40} onCommit={(value) => patchBackgroundMedia({ blur: value })} ariaLabel="Blur" suffix="px" />
              </div>
              {background.kind === 'video' ? (
                <div className="flex items-center justify-between gap-2">
                  <Label.xs className="text-tertiary">Loop</Label.xs>
                  <SwitchField checked={background.loop} onChange={(checked) => patchBackgroundMedia({ loop: checked })} ariaLabel="Loop video" />
                </div>
              ) : null}
            </>
          )}
        </Section.Body>
      </Section.Root>
    </div>
  );
}
