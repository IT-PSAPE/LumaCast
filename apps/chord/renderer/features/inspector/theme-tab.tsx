// The universal look every linked cue inherits: preset chips, then Text /
// Position / Effects / Transition / Background sections. Every field commits
// straight to `setTheme`/`setBackground` — there is no local draft state at
// this level (the number/text/colour fields below own their own).
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  Italic, Underline, X,
} from 'lucide-react';
import { cn, Label, Panel, PlainButton, ReacstButton, Section, SegmentedControl, Select, Switch, ColorField, NumberField } from '@lumacast/ui';
import type { TextCaseTransform, TextHorizontalAlign, TextVerticalAlign } from '@lumacast/composition';
import { THEME_PRESETS } from '../../../shared/theme-presets';
import type { MediaFit, TextStyle, TransitionKind } from '../../../shared/project';
import { useChordStore } from '../../store';
import { NativeColorPicker } from '../../components/native-color-picker';
import { importBackground } from '../library/import-flows';
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
    <Panel.Body className="flex flex-col divide-y divide-primary">
      <Section density="compact" className="px-3 py-3">
        <Section.Header><Section.Title>Preset</Section.Title></Section.Header>
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
      </Section>

      <Section density="compact" className="px-3 py-3">
        <Section.Header><Section.Title>Text</Section.Title></Section.Header>
        <Section.Body>
          <div className="grid grid-cols-2 gap-1.5">
            <Select value={theme.text.fontFamily} options={fontOptions} onValueChange={(value) => patchText({ fontFamily: value })} label="Font family" labelPlacement="hidden" />
            <Select value={theme.text.weight ?? '400'} options={WEIGHT_OPTIONS} onValueChange={(value) => patchText({ weight: value })} label="Weight" labelPlacement="hidden" />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField value={theme.text.fontSize} min={1} onValueChange={(value) => patchText({ fontSize: value })} label="Font size" labelPlacement="hidden" suffix="px" />
            <NumberField value={theme.text.lineHeight ?? 1.2} step={0.05} min={0.5} max={4} onValueChange={(value) => patchText({ lineHeight: value })} label="Line height" labelPlacement="hidden" />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField value={theme.text.letterSpacing ?? 0} step={0.5} onValueChange={(value) => patchText({ letterSpacing: value })} label="Letter spacing" labelPlacement="hidden" />
            <ColorField value={theme.text.color} onValueChange={(value) => patchText({ color: value })} label="Text colour" labelPlacement="hidden" picker={<NativeColorPicker value={theme.text.color} onValueChange={(value) => patchText({ color: value })} />} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
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
            <Select value={theme.text.caseTransform ?? 'none'} options={CASE_OPTIONS} onValueChange={(value) => patchText({ caseTransform: value })} label="Case" labelPlacement="hidden" />
          </div>
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
            <Switch checked={theme.text.autoFit ?? false} onCheckedChange={(checked) => patchText({ autoFit: checked })} label="Auto-fit text" />
          </div>
          {theme.text.autoFit ? (
            <NumberField value={theme.text.autoFitMaxFontSize ?? theme.text.fontSize} min={1} onValueChange={(value) => patchText({ autoFitMaxFontSize: value })} label="Max font size" labelPlacement="hidden" suffix="px" />
          ) : null}
        </Section.Body>
      </Section>

      <Section density="compact" className="px-3 py-3">
        <Section.Header><Section.Title>Position</Section.Title></Section.Header>
        <Section.Body>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField value={theme.box.x} onValueChange={(value) => patchBox({ x: value })} label="X" labelPlacement="hidden" />
            <NumberField value={theme.box.y} onValueChange={(value) => patchBox({ y: value })} label="Y" labelPlacement="hidden" />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField value={theme.box.width} min={0} onValueChange={(value) => patchBox({ width: value })} label="Width" labelPlacement="hidden" />
            <NumberField value={theme.box.height} min={0} onValueChange={(value) => patchBox({ height: value })} label="Height" labelPlacement="hidden" />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField value={theme.box.rotation} onValueChange={(value) => patchBox({ rotation: value })} label="Rotation" labelPlacement="hidden" suffix="°" />
            <NumberField value={theme.box.opacity} min={0} max={1} step={0.05} onValueChange={(value) => patchBox({ opacity: value })} label="Opacity" labelPlacement="hidden" />
          </div>
          <div className="flex gap-1.5">
            <ReacstButton onClick={centerHorizontally}>Center horizontally</ReacstButton>
            <ReacstButton onClick={lowerThird}>Lower third</ReacstButton>
          </div>
        </Section.Body>
      </Section>

      <Section density="compact" className="px-3 py-3">
        <Section.Header><Section.Title>Effects</Section.Title></Section.Header>
        <Section.Body>
          <div className="flex items-center justify-between gap-2">
            <Label.xs className="text-tertiary">Stroke</Label.xs>
            <Switch checked={theme.text.textStrokeEnabled ?? false} onCheckedChange={(checked) => patchText({ textStrokeEnabled: checked })} label="Enable stroke" />
          </div>
          {theme.text.textStrokeEnabled ? (
            <div className="grid grid-cols-2 gap-1.5">
              <ColorField value={theme.text.textStrokeColor ?? '#000000'} onValueChange={(value) => patchText({ textStrokeColor: value })} label="Stroke colour" labelPlacement="hidden" picker={<NativeColorPicker value={theme.text.textStrokeColor ?? '#000000'} onValueChange={(value) => patchText({ textStrokeColor: value })} />} />
              <NumberField value={theme.text.textStrokeWidth ?? 2} min={0} onValueChange={(value) => patchText({ textStrokeWidth: value })} label="Stroke width" labelPlacement="hidden" suffix="px" />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Label.xs className="text-tertiary">Shadow</Label.xs>
            <Switch checked={theme.text.textShadowEnabled ?? false} onCheckedChange={(checked) => patchText({ textShadowEnabled: checked })} label="Enable shadow" />
          </div>
          {theme.text.textShadowEnabled ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <ColorField value={theme.text.textShadowColor ?? '#000000'} onValueChange={(value) => patchText({ textShadowColor: value })} label="Shadow colour" labelPlacement="hidden" picker={<NativeColorPicker value={theme.text.textShadowColor ?? '#000000'} onValueChange={(value) => patchText({ textShadowColor: value })} />} />
                <NumberField value={theme.text.textShadowBlur ?? 0} min={0} onValueChange={(value) => patchText({ textShadowBlur: value })} label="Shadow blur" labelPlacement="hidden" suffix="px" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField value={theme.text.textShadowOffsetX ?? 0} onValueChange={(value) => patchText({ textShadowOffsetX: value })} label="Shadow offset X" labelPlacement="hidden" />
                <NumberField value={theme.text.textShadowOffsetY ?? 0} onValueChange={(value) => patchText({ textShadowOffsetY: value })} label="Shadow offset Y" labelPlacement="hidden" />
              </div>
            </>
          ) : null}
        </Section.Body>
      </Section>

      <Section density="compact" className="px-3 py-3">
        <Section.Header><Section.Title>Transition</Section.Title></Section.Header>
        <Section.Body>
          <div className="grid grid-cols-2 gap-1.5">
            <Select value={theme.transition.in} options={TRANSITION_OPTIONS} onValueChange={(value) => patchTransition({ in: value })} label="Transition in" labelPlacement="hidden" />
            <Select value={theme.transition.out} options={TRANSITION_OPTIONS} onValueChange={(value) => patchTransition({ out: value })} label="Transition out" labelPlacement="hidden" />
          </div>
          <NumberField value={theme.transition.durationMs} min={0} step={50} onValueChange={(value) => patchTransition({ durationMs: value })} label="Transition duration" labelPlacement="hidden" suffix="ms" />
        </Section.Body>
      </Section>

      <Section density="compact" className="px-3 py-3">
        <Section.Header><Section.Title>Background</Section.Title></Section.Header>
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
            <ColorField value={background.color} onValueChange={(value) => setBackground({ kind: 'color', color: value }, null)} label="Background colour" labelPlacement="hidden" picker={<NativeColorPicker value={background.color} onValueChange={(value) => setBackground({ kind: 'color', color: value }, null)} />} />
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
              <Select
                value={background.fit}
                options={FIT_OPTIONS}
                onValueChange={(value) => patchBackgroundMedia({ fit: value })}
                label="Background fit"
                labelPlacement="hidden"
              />
              <NumberField value={background.dim} min={0} max={1} step={0.05} onValueChange={(value) => patchBackgroundMedia({ dim: value })} label="Dim" />
              <NumberField value={background.blur} min={0} max={40} onValueChange={(value) => patchBackgroundMedia({ blur: value })} label="Blur" suffix="px" />
              {background.kind === 'video' ? (
                <div className="flex items-center justify-between gap-2">
                  <Label.xs className="text-tertiary">Loop</Label.xs>
                  <Switch checked={background.loop} onCheckedChange={(checked) => patchBackgroundMedia({ loop: checked })} label="Loop video" />
                </div>
              ) : null}
            </>
          )}
        </Section.Body>
      </Section>
    </Panel.Body>
  );
}
