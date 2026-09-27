// The renderer's single store contract. Every feature (timeline, canvas,
// inspector, top bar, export) reads and mutates the document through this
// interface, so the features can be built and tested against a fake store
// and never reach into each other. `create-store.ts` implements it.
import type { CueFileFormat } from '../../shared/desktop-api';
import type {
  ChordBackground,
  ChordComposition,
  ChordCue,
  ChordMediaRef,
  ChordProject,
  ChordTheme,
  CueOverride,
  ProjectDocument,
} from '../../shared/project';
import type { RichBody } from '@lumacast/composition';

export type Tool = 'select' | 'tap';
export type InspectorTab = 'cue' | 'theme';
export type SelectMode = 'replace' | 'add' | 'toggle';

export interface PlaybackState {
  playing: boolean;
  /** The playhead, in ms; driven by the audio clock while playing. */
  timeMs: number;
  loop: boolean;
}

export interface TimelineView {
  /** Pixels per second. */
  zoom: number;
  /** Timeline left edge, in ms. */
  scrollMs: number;
  /** Viewport width the timeline last measured, in px. */
  viewportWidth: number;
}

export type ExportStatus = 'idle' | 'preparing' | 'rendering' | 'finalizing' | 'done' | 'failed' | 'cancelled';

export interface ExportJobState {
  status: ExportStatus;
  percent: number;
  etaMs: number | null;
  outputPath: string | null;
  error: string | null;
}

export interface ResolvedMedia {
  /** `lumachord://file/...` URLs resolved by main; null until admitted. */
  audioUrl: string | null;
  backgroundUrl: string | null;
}

export interface ChordState {
  document: ProjectDocument;
  dirty: boolean;
  /** Selected cue ids, in selection order. */
  selection: string[];
  playback: PlaybackState;
  timeline: TimelineView;
  tool: Tool;
  /** Index of the next cue tap-to-mark will time; null when not tapping. */
  tapIndex: number | null;
  /**
   * Cue ids in the order tap-to-mark will time them, snapshotted when tap
   * mode starts (and extended as new cues are appended past the end); null
   * when not tapping. `updateProject` re-sorts `cues` by `startMs` after
   * every mutation, so a live array position can't be used as a stable
   * "next cue" pointer once a tap re-times a cue ahead of its neighbours.
   */
  tapOrder: readonly string[] | null;
  inspectorTab: InspectorTab;
  media: ResolvedMedia;
  canUndo: boolean;
  canRedo: boolean;
  exportJob: ExportJobState;
}

export interface ChordActions {
  // Document lifecycle (main-backed)
  loadDocument: (document: ProjectDocument) => void;
  newDocument: () => Promise<void>;
  openDocument: (path?: string) => Promise<void>;
  saveDocument: (saveAs?: boolean) => Promise<void>;
  /** Records one undo step; `label` names it for the Edit menu. */
  updateProject: (label: string, mutate: (project: ChordProject) => void) => void;
  undo: () => void;
  redo: () => void;

  // Cues
  addCue: (startMs: number, text?: string) => string;
  updateCue: (id: string, patch: Partial<Omit<ChordCue, 'id'>>) => void;
  setCueText: (id: string, text: string, richBody?: RichBody) => void;
  moveCues: (ids: readonly string[], deltaMs: number) => void;
  trimCue: (id: string, edge: 'start' | 'end', timeMs: number) => void;
  splitCueAt: (id: string, timeMs: number) => void;
  deleteCues: (ids: readonly string[]) => void;
  detachCue: (id: string) => void;
  relinkCue: (id: string) => void;
  setCueOverride: (id: string, override: CueOverride | null) => void;
  /** Replaces every cue (cue-file import). */
  replaceCues: (cues: ChordCue[]) => void;

  // Look
  setTheme: (patch: Partial<ChordTheme>) => void;
  applyPreset: (presetId: string) => void;
  setBackground: (background: ChordBackground, url: string | null) => void;
  setComposition: (patch: Partial<ChordComposition>) => void;
  setAudio: (audio: ChordMediaRef | null, url: string | null) => void;
  setTitle: (title: string) => void;

  // Selection, tools, view
  select: (ids: readonly string[], mode?: SelectMode) => void;
  clearSelection: () => void;
  setTool: (tool: Tool) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setTimelineView: (patch: Partial<TimelineView>) => void;
  /** Multiplies zoom, keeping `anchorMs` (default: playhead) under the same pixel. */
  zoomBy: (factor: number, anchorMs?: number) => void;
  zoomToFit: () => void;

  // Playback (the clock hook calls tick; everything else calls the rest)
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (timeMs: number) => void;
  stepFrames: (frames: number) => void;
  setLoop: (loop: boolean) => void;
  tick: (timeMs: number) => void;
  /** Tap-to-mark: times the next cue at the playhead (adds one when none is left). */
  tapMark: () => void;

  // Export
  setExportJob: (patch: Partial<ExportJobState>) => void;
  /** Serialises the cues in a cue-file format and hands them to main. */
  exportCueFile: (format: CueFileFormat) => Promise<void>;
}

export type ChordStore = ChordState & ChordActions;
