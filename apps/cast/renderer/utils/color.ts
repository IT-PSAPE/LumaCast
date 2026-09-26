import { clamp } from './math';

/** RGB color with 0–255 channels. */
export interface Rgb { r: number; g: number; b: number }

/** HSB (HSV) color: h 0–360, s 0–100, b 0–100. */
export interface Hsb { h: number; s: number; b: number }

/** HSL color: h 0–360, s 0–100, l 0–100. */
export interface Hsl { h: number; s: number; l: number }

// ── Hex ↔ RGB ──────────────────────────────────────────────

export function hexToRgb(hex: string): Rgb {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2) || '0', 16);
  const g = parseInt(h.slice(2, 4) || '0', 16);
  const b = parseInt(h.slice(4, 6) || '0', 16);
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) };
}

export function rgbToHex(rgb: Rgb): string {
  const r = clamp(Math.round(rgb.r), 0, 255).toString(16).padStart(2, '0');
  const g = clamp(Math.round(rgb.g), 0, 255).toString(16).padStart(2, '0');
  const b = clamp(Math.round(rgb.b), 0, 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/** Extract alpha from a hex string (0–100). Returns 100 if no alpha channel. */
export function hexAlpha(hex: string): number {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length <= 6) return 100;
  const a = parseInt(h.slice(6, 8) || 'FF', 16);
  return Math.round((a / 255) * 100);
}

/** Combine a 6-char hex with an alpha 0–100 → #RRGGBBAA. */
export function withAlpha(hex: string, alpha: number): string {
  const base = hex.startsWith('#') ? hex.slice(0, 7) : `#${hex.slice(0, 6)}`;
  if (alpha >= 100) return base;
  const a = clamp(Math.round((alpha / 100) * 255), 0, 255).toString(16).padStart(2, '0');
  return `${base}${a}`;
}

// ── RGB ↔ HSB ──────────────────────────────────────────────

export function rgbToHsb(rgb: Rgb): Hsb {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }

  const s = max === 0 ? 0 : (d / max) * 100;
  const bri = max * 100;
  return { h: Math.round(h), s: Math.round(s), b: Math.round(bri) };
}

export function hsbToRgb(hsb: Hsb): Rgb {
  const h = hsb.h;
  const s = hsb.s / 100;
  const v = hsb.b / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// ── RGB ↔ HSL ──────────────────────────────────────────────

export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(hsl: Hsl): Rgb {
  const h = hsl.h;
  const s = hsl.s / 100;
  const l = hsl.l / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// ── Convenience ────────────────────────────────────────────

export function hexToHsb(hex: string): Hsb {
  return rgbToHsb(hexToRgb(hex));
}

export function hsbToHex(hsb: Hsb): string {
  return rgbToHex(hsbToRgb(hsb));
}

/** Pure hue CSS color for the saturation/brightness gradient background. */
export function hueToHex(hue: number): string {
  return rgbToHex(hsbToRgb({ h: hue, s: 100, b: 100 }));
}
