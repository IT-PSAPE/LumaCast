// The LumaChord project model. Plain data only: it is what a `.lumachord`
// file contains, what crosses the IPC boundary, and what the renderer edits,
// so nothing here may name Node, Electron, or React. Text styling and rich
// text reuse the composition domain so `@lumacast/canvas` renders a cue
// without an adapter.
import type { RichBody, TextElementPayload } from '@lumacast/composition';

export const PROJECT_FORMAT_VERSION = 1 as const;
export const PROJECT_FILE_EXTENSION = 'lumachord';

export type FrameRate = 24 | 25 | 30 | 60;
export const FRAME_RATES: readonly FrameRate[] = [24, 25, 30, 60];

export interface CompositionSize {
  width: number;
  height: number;
}

/** Aspect presets offered in the top bar. Custom sizes are still allowed. */
export const COMPOSITION_PRESETS: ReadonlyArray<{ id: string; label: string; size: CompositionSize }> = [
  { id: 'landscape-1080p', label: '16:9 · 1920×1080', size: { width: 1920, height: 1080 } },
  { id: 'landscape-4k', label: '16:9 · 3840×2160', size: { width: 3840, height: 2160 } },
  { id: 'portrait-1080p', label: '9:16 · 1080×1920', size: { width: 1080, height: 1920 } },
  { id: 'square-1080', label: '1:1 · 1080×1080', size: { width: 1080, height: 1080 } },
];

export interface ChordComposition extends CompositionSize {
  fps: FrameRate;
}

/** A media file the user imported. `path` is the absolute path on disk. */
export interface ChordMediaRef {
  path: string;
  name: string;
  /** Known after probing; null for images. */
  durationMs: number | null;
  width?: number;
  height?: number;
}

export type MediaFit = 'cover' | 'contain' | 'fill';

export type ChordBackground =
  | { kind: 'color'; color: string }
  | {
      kind: 'image' | 'video';
      media: ChordMediaRef;
      fit: MediaFit;
      /** 0–1 black overlay to keep text legible. */
      dim: number;
      /** 0–40 px blur. */
      blur: number;
      /** Video only: loop when shorter than the audio. */
      loop: boolean;
    };

/**
 * Box-level text style, the subset of TextElementPayload a theme owns. Every
 * key is a box-level property in the composition sense (see CONTEXT.md Rich
 * Text): run-level overrides live in a cue's `richBody`.
 */
export type TextStyle = Pick<
  TextElementPayload,
  | 'fontFamily'
  | 'fontSize'
  | 'color'
  | 'weight'
  | 'italic'
  | 'underline'
  | 'alignment'
  | 'verticalAlign'
  | 'lineHeight'
  | 'letterSpacing'
  | 'caseTransform'
  | 'autoFit'
  | 'autoFitMaxFontSize'
  | 'textStrokeEnabled'
  | 'textStrokeColor'
  | 'textStrokeWidth'
  | 'textShadowEnabled'
  | 'textShadowColor'
  | 'textShadowBlur'
  | 'textShadowOffsetX'
  | 'textShadowOffsetY'
>;

/** Where the lyric box sits, in composition pixels. */
export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export type TransitionKind = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'scale';

export interface Transition {
  in: TransitionKind;
  out: TransitionKind;
  durationMs: number;
}

/** The universal look every linked cue inherits. */
export interface ChordTheme {
  /** A preset id from the gallery, or 'custom' once edited. */
  presetId: string;
  text: TextStyle;
  box: TextBox;
  transition: Transition;
}

/** What a detached cue changes relative to the theme. Absent keys inherit. */
export interface CueOverride {
  text?: Partial<TextStyle>;
  box?: Partial<TextBox>;
  transition?: Partial<Transition>;
}

export interface ChordCue {
  id: string;
  startMs: number;
  /** Null: the cue holds until the next cue starts (or the audio ends). */
  endMs: number | null;
  /** Plain projection of the lyric; always kept in sync with `richBody`. */
  text: string;
  /** Present when the user styled runs within the cue. */
  richBody?: RichBody;
  /** Null while the cue is linked to the theme. */
  override: CueOverride | null;
}

export interface ChordProject {
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  composition: ChordComposition;
  audio: ChordMediaRef | null;
  background: ChordBackground;
  theme: ChordTheme;
  /** Sorted by startMs; ids unique. */
  cues: ChordCue[];
}

/** A project plus where it lives on disk (null until first save). */
export interface ProjectDocument {
  project: ChordProject;
  path: string | null;
}

export interface RecentProject {
  path: string;
  title: string;
  openedAt: string;
}
