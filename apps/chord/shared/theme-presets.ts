// The theme preset gallery: six well-designed starting looks for a lyric
// video, all sized for a 1920×1080 frame. Fonts are restricted to the
// cross-platform fallback set (Avenir Next, Helvetica Neue, Segoe UI, Arial)
// so a preset renders the same regardless of which OS LumaChord runs on.
// Process-neutral: no Node builtins, no Electron.
import type { ChordTheme, CompositionSize, TextBox, TextStyle } from './project';

export interface ThemePreset {
  id: string;
  label: string;
  theme: ChordTheme;
  /** Small swatch shown in the preset gallery: a representative background and text colour. */
  swatch: { background: string; text: string };
}

export const DEFAULT_PRESET_ID = 'classic';

// The composition default lyric box (packages/composition/src/themes.ts
// createDefaultThemeElements, 'lyric' branch) on a 1920×1080 frame: the
// anchor every preset's box is built around.
const ANCHOR_BOX: TextBox = { x: 180, y: 860, width: 1560, height: 170, rotation: 0, opacity: 1 };

function centeredBox(height: number): TextBox {
  const y = Math.round((1080 - height) / 2);
  return { x: 180, y, width: 1560, height, rotation: 0, opacity: 1 };
}

const classicText: TextStyle = {
  fontFamily: 'Avenir Next',
  fontSize: 72,
  color: '#FFFFFF',
  weight: '700',
  alignment: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.2,
  caseTransform: 'none',
  textShadowEnabled: true,
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowBlur: 12,
  textShadowOffsetX: 0,
  textShadowOffsetY: 4,
};

const boldText: TextStyle = {
  fontFamily: 'Helvetica Neue',
  fontSize: 96,
  color: '#FFFFFF',
  weight: '900',
  alignment: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.1,
  letterSpacing: 1,
  caseTransform: 'uppercase',
};

const cinematicText: TextStyle = {
  fontFamily: 'Helvetica Neue',
  fontSize: 56,
  color: '#F5F5F5',
  weight: '300',
  alignment: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.3,
  letterSpacing: 4,
  caseTransform: 'none',
};

const karaokeText: TextStyle = {
  fontFamily: 'Arial',
  fontSize: 80,
  color: '#FFE600',
  weight: '800',
  alignment: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.2,
  caseTransform: 'none',
  textStrokeEnabled: true,
  textStrokeColor: '#101010',
  textStrokeWidth: 6,
};

const minimalText: TextStyle = {
  fontFamily: 'Helvetica Neue',
  fontSize: 40,
  color: '#CCCCCC',
  weight: '400',
  alignment: 'left',
  verticalAlign: 'bottom',
  lineHeight: 1.2,
  caseTransform: 'none',
};

const neonText: TextStyle = {
  fontFamily: 'Segoe UI',
  fontSize: 76,
  color: '#00E5FF',
  weight: '700',
  alignment: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.2,
  caseTransform: 'none',
  textShadowEnabled: true,
  textShadowColor: '#00E5FF',
  textShadowBlur: 24,
  textShadowOffsetX: 0,
  textShadowOffsetY: 0,
};

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    theme: {
      presetId: 'classic',
      text: classicText,
      box: ANCHOR_BOX,
      transition: { in: 'fade', out: 'fade', durationMs: 400 },
    },
    swatch: { background: '#101010', text: '#FFFFFF' },
  },
  {
    id: 'bold',
    label: 'Bold',
    theme: {
      presetId: 'bold',
      text: boldText,
      box: centeredBox(220),
      transition: { in: 'scale', out: 'fade', durationMs: 350 },
    },
    swatch: { background: '#000000', text: '#FFFFFF' },
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    theme: {
      presetId: 'cinematic',
      text: cinematicText,
      box: centeredBox(150),
      transition: { in: 'fade', out: 'fade', durationMs: 700 },
    },
    swatch: { background: '#0B0B10', text: '#F5F5F5' },
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    theme: {
      presetId: 'karaoke',
      text: karaokeText,
      box: { x: 120, y: 900, width: 1680, height: 140, rotation: 0, opacity: 1 },
      transition: { in: 'slide-up', out: 'fade', durationMs: 250 },
    },
    swatch: { background: '#101010', text: '#FFE600' },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    theme: {
      presetId: 'minimal',
      text: minimalText,
      box: { x: 80, y: 960, width: 900, height: 80, rotation: 0, opacity: 1 },
      transition: { in: 'none', out: 'none', durationMs: 0 },
    },
    swatch: { background: '#1A1A1A', text: '#CCCCCC' },
  },
  {
    id: 'neon',
    label: 'Neon',
    theme: {
      presetId: 'neon',
      text: neonText,
      box: centeredBox(220),
      transition: { in: 'scale', out: 'fade', durationMs: 400 },
    },
    swatch: { background: '#050505', text: '#00E5FF' },
  },
];

export function findPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

const SCALED_TEXT_KEYS = [
  'letterSpacing',
  'autoFitMaxFontSize',
  'textStrokeWidth',
  'textShadowBlur',
  'textShadowOffsetX',
  'textShadowOffsetY',
] as const satisfies readonly (keyof TextStyle)[];

/** Proportionally resizes a theme's box and font-related metrics for a new composition size. */
export function scaleThemeToComposition(theme: ChordTheme, from: CompositionSize, to: CompositionSize): ChordTheme {
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  const fontScale = (scaleX + scaleY) / 2;

  const text: TextStyle = { ...theme.text, fontSize: theme.text.fontSize * fontScale };
  const scalableText = text as unknown as Record<string, number | undefined>;
  for (const key of SCALED_TEXT_KEYS) {
    const value = theme.text[key];
    if (typeof value === 'number') {
      scalableText[key] = value * fontScale;
    }
  }

  const box: TextBox = {
    x: theme.box.x * scaleX,
    y: theme.box.y * scaleY,
    width: theme.box.width * scaleX,
    height: theme.box.height * scaleY,
    rotation: theme.box.rotation,
    opacity: theme.box.opacity,
  };

  return {
    presetId: theme.presetId,
    text,
    box,
    transition: { ...theme.transition },
  };
}
