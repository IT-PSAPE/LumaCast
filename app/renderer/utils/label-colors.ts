export const LABEL_COLOR_OPTIONS = [
  { key: 'red', label: 'Red', swatch: '#dc2626' },
  { key: 'orange', label: 'Orange', swatch: '#f97316' },
  { key: 'amber', label: 'Amber', swatch: '#fbbf24' },
  { key: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { key: 'indigo', label: 'Indigo', swatch: '#4f46e5' },
  { key: 'pink', label: 'Pink', swatch: '#ec4899' },
  { key: 'green', label: 'Green', swatch: '#22c55e' },
  { key: 'gray', label: 'Gray', swatch: '#6b7280' },
  { key: 'crimson', label: 'Crimson', swatch: '#7f1d1d' },
  { key: 'brown', label: 'Brown', swatch: '#78350f' },
  { key: 'ochre', label: 'Ochre', swatch: '#854d0e' },
  { key: 'navy', label: 'Navy', swatch: '#1d4ed8' },
  { key: 'violet', label: 'Violet', swatch: '#4338ca' },
  { key: 'magenta', label: 'Magenta', swatch: '#9d174d' },
  { key: 'teal', label: 'Teal', swatch: '#0f766e' },
  { key: 'slate', label: 'Slate', swatch: '#4b5563' },
] as const;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface LabelColors {
  backgroundColor: string;
  color: string;
}

const COLOR_BY_KEY = new Map<string, (typeof LABEL_COLOR_OPTIONS)[number]>(
  LABEL_COLOR_OPTIONS.map((option) => [option.key, option] as const),
);

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getLabelColors(colorKey: string | null, opacity = 0.18): LabelColors | null {
  if (!colorKey) return null;
  const option = COLOR_BY_KEY.get(colorKey);
  if (!option) return null;
  return {
    backgroundColor: withAlpha(option.swatch, opacity),
    color: `color-mix(in srgb, var(--text-color-primary) 88%, ${option.swatch})`,
  };
}
