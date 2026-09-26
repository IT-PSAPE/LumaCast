import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET_ID,
  THEME_PRESETS,
  findPreset,
  scaleThemeToComposition,
} from '../../../../apps/chord/shared/theme-presets';
import { chordProjectSchema, createEmptyProject } from '../../../../apps/chord/shared/project-schema';
import type { CompositionSize } from '../../../../apps/chord/shared/project';

const NOW = '2026-01-01T00:00:00.000Z';

describe('THEME_PRESETS', () => {
  it('has six presets with unique ids', () => {
    expect(THEME_PRESETS).toHaveLength(6);
    const ids = THEME_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only uses cross-platform fallback fonts', () => {
    const allowed = new Set(['Avenir Next', 'Helvetica Neue', 'Segoe UI', 'Arial']);
    for (const preset of THEME_PRESETS) {
      expect(allowed.has(preset.theme.text.fontFamily)).toBe(true);
    }
  });

  it('sets presetId on each theme to match the preset id', () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.theme.presetId).toBe(preset.id);
    }
  });

  it('every preset validates when placed in an otherwise-empty project', () => {
    for (const preset of THEME_PRESETS) {
      const project = { ...createEmptyProject(NOW, 'p'), theme: preset.theme };
      const result = chordProjectSchema.safeParse(project);
      expect(result.success).toBe(true);
    }
  });

  it('DEFAULT_PRESET_ID resolves to a real preset', () => {
    expect(DEFAULT_PRESET_ID).toBe('classic');
    expect(findPreset(DEFAULT_PRESET_ID)).toBeDefined();
  });

  it('findPreset returns undefined for an unknown id', () => {
    expect(findPreset('does-not-exist')).toBeUndefined();
  });
});

describe('scaleThemeToComposition', () => {
  const from: CompositionSize = { width: 1920, height: 1080 };

  it('scales the box and font size proportionally for a uniform 2x composition', () => {
    const theme = findPreset('classic')!.theme;
    const to: CompositionSize = { width: 3840, height: 2160 };
    const scaled = scaleThemeToComposition(theme, from, to);

    expect(scaled.box.x).toBeCloseTo(theme.box.x * 2);
    expect(scaled.box.y).toBeCloseTo(theme.box.y * 2);
    expect(scaled.box.width).toBeCloseTo(theme.box.width * 2);
    expect(scaled.box.height).toBeCloseTo(theme.box.height * 2);
    expect(scaled.text.fontSize).toBeCloseTo(theme.text.fontSize * 2);
  });

  it('preserves rotation, opacity, presetId and transition', () => {
    const theme = findPreset('bold')!.theme;
    const to: CompositionSize = { width: 1080, height: 1080 };
    const scaled = scaleThemeToComposition(theme, from, to);

    expect(scaled.presetId).toBe(theme.presetId);
    expect(scaled.box.rotation).toBe(theme.box.rotation);
    expect(scaled.box.opacity).toBe(theme.box.opacity);
    expect(scaled.transition).toEqual(theme.transition);
  });

  it('scales x/width by the horizontal ratio and y/height by the vertical ratio independently', () => {
    const theme = findPreset('minimal')!.theme;
    const to: CompositionSize = { width: 960, height: 3240 }; // 0.5x horizontal, 3x vertical
    const scaled = scaleThemeToComposition(theme, from, to);

    expect(scaled.box.x).toBeCloseTo(theme.box.x * 0.5);
    expect(scaled.box.width).toBeCloseTo(theme.box.width * 0.5);
    expect(scaled.box.y).toBeCloseTo(theme.box.y * 3);
    expect(scaled.box.height).toBeCloseTo(theme.box.height * 3);
  });

  it('scales secondary font metrics (letter spacing, stroke, shadow) alongside font size', () => {
    const theme = findPreset('karaoke')!.theme; // has textStrokeWidth
    const to: CompositionSize = { width: 3840, height: 2160 };
    const scaled = scaleThemeToComposition(theme, from, to);
    expect(scaled.text.textStrokeWidth).toBeCloseTo((theme.text.textStrokeWidth ?? 0) * 2);
  });

  it('produces a theme that still validates against the project schema', () => {
    const theme = findPreset('neon')!.theme;
    const to: CompositionSize = { width: 1080, height: 1920 };
    const scaled = scaleThemeToComposition(theme, from, to);
    const project = { ...createEmptyProject(NOW, 'p'), theme: scaled };
    expect(chordProjectSchema.safeParse(project).success).toBe(true);
  });
});
