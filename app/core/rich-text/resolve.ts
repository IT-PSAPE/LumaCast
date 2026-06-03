// Run-level inheritance and the bridge from the existing Box-level seam.
// See docs/superpowers/specs/2026-06-02-rich-text-design.md §4.
//
// A Run carries only the attributes it overrides; everything unset resolves to
// the Box-level value. `boxStyleFromPayload` reads the Box-level style through
// the existing `readTextFormatting` seam and coerces the legacy numeric-string
// weight (e.g. '400') into the Run model's true numeric weight. `synthesizePlain`
// is the lazy read-tolerance entry point: a missing/'plain' element is read as a
// Rich Body of override-free Runs, without rewriting stored data.

import type { TextElementPayload } from '../types';
import { readTextFormatting } from '../element-payload';
import type { RichBody, RichRun } from './types';
import { textToRichBody } from './serialize';

// The Box-level inputs a Run inherits from, plus the family/size every run draws
// with (font family and font size are Box-level and cannot be overridden per Run).
export interface RichBoxStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  weight: number;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

// The fully-resolved style for one Run after applying inheritance — same shape as
// the Box-level style because resolution only fills in unset Run attributes.
export type ResolvedRunStyle = RichBoxStyle;

const DEFAULT_WEIGHT = 400;

// Coerces the legacy Box-level weight (a numeric string such as '400'/'700', or
// already a number) into the Run model's numeric weight. Garbage ⇒ 400.
export function coerceWeight(weight: string | number | undefined): number {
  if (typeof weight === 'number') return Number.isFinite(weight) ? weight : DEFAULT_WEIGHT;
  const parsed = Number.parseInt(weight ?? '', 10);
  return Number.isNaN(parsed) ? DEFAULT_WEIGHT : parsed;
}

// Reads the Box-level style through the existing seam, coercing weight to numeric.
// fontSize here is the authored size; the renderer substitutes the auto-fit size
// when auto-fit is active.
export function boxStyleFromPayload(payload: TextElementPayload): RichBoxStyle {
  const formatting = readTextFormatting(payload);
  return {
    fontFamily: formatting.fontFamily || 'sans-serif',
    fontSize: formatting.fontSize,
    color: payload.color,
    weight: coerceWeight(formatting.weight),
    italic: formatting.italic,
    underline: formatting.underline,
    strikethrough: formatting.strikethrough,
  };
}

// Applies Run-level overrides over the Box-level style. Family and size are always
// the Box's; the five Run-level attributes fall back to the Box when unset.
export function resolveRun(run: RichRun, box: RichBoxStyle): ResolvedRunStyle {
  return {
    fontFamily: box.fontFamily,
    fontSize: box.fontSize,
    color: run.color ?? box.color,
    weight: run.weight ?? box.weight,
    italic: run.italic ?? box.italic,
    underline: run.underline ?? box.underline,
    strikethrough: run.strikethrough ?? box.strikethrough,
  };
}

// Lazy read-tolerance: read a plain/legacy element as a Rich Body of override-free
// Runs (one Block per hard line). Nothing is rewritten; the result inherits the
// entire Box-level style, so it is byte-identical in meaning to the plain string.
export function synthesizePlain(payload: TextElementPayload): RichBody {
  return textToRichBody(payload.text ?? '');
}
