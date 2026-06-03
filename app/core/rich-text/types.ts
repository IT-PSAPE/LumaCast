// Canonical Rich Text model — see CONTEXT.md "Rich Text" glossary and
// docs/superpowers/specs/2026-06-02-rich-text-design.md §4.
//
// A Rich Body is an ordered list of Blocks; a Block is one paragraph or list
// item of Runs; a Run is a contiguous span sharing the same Run-level style.
// A Run stores ONLY the attributes it overrides — anything unset inherits the
// Box-level style at resolve time (see ./resolve). Font family and font size
// are always Box-level and never appear here.

export interface RichRun {
  text: string;
  // Run-level style — OVERRIDES only. Any unset attribute ⇒ inherit Box-level.
  color?: string;
  weight?: number; // true numeric weight (e.g. 400, 700); not the box's numeric-string
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface RichBlock {
  runs: RichRun[];
  listType?: 'bullet' | 'number'; // absent ⇒ plain paragraph
  indent: number; // 0 for v1; the schema is nesting-ready
}

export type RichBody = RichBlock[];
