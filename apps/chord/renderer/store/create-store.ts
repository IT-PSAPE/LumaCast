// The Zustand implementation of the `ChordStore` contract (see `./types.ts`,
// which this file must satisfy exactly). Every project mutation — theme,
// background, composition, audio, and every cue action — funnels through the
// single `updateProject(label, mutate)` action: it structured-clones the
// project, runs the mutator, normalises cues, bumps `updatedAt`, and records
// one undo step (unless a transaction is open, in which case the whole run
// collapses into the one step recorded when the transaction ends). This
// keeps undo bookkeeping in exactly one place instead of duplicated across
// every action.
import { create } from 'zustand';
import { createId, nowIso } from '@lumacast/kernel';
import { formatCues } from '@lumacast/markers';
import { createEmptyProject } from '../../shared/project-schema';
import { findPreset, scaleThemeToComposition } from '../../shared/theme-presets';
import {
  deleteCues as deleteCuesPure,
  frameDurationMs,
  insertCue,
  moveCues as moveCuesPure,
  normalizeCues,
  normalizeOverride,
  quantizeToFrame,
  splitCue as splitCuePure,
  timedCuesFromCues,
  trimCue as trimCuePure,
} from '../../shared/cue-model';
import { timelineEndMs } from '../features/playback';
import type { ChordDesktopAPI } from '../../shared/desktop-api';
import type { ChordCue, ChordProject } from '../../shared/project';
import type { ChordStore } from './types';

const UNDO_LIMIT = 200;
const MIN_ZOOM_PX_PER_SEC = 2;
const MAX_ZOOM_PX_PER_SEC = 4000;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM_PX_PER_SEC, Math.max(MIN_ZOOM_PX_PER_SEC, zoom));
}

interface UndoEntry {
  project: ChordProject;
  label: string;
}

/**
 * Store fields/methods beyond the `ChordStore` contract: the undo/redo
 * stacks and the transaction bookkeeping `beginTransaction`/`endTransaction`
 * rely on. The contract explicitly allows extra store methods (e.g. for the
 * timeline drag case); typing them here (rather than leaving them as
 * untyped extras on the object literal) keeps `create<...>()` honest about
 * the full shape while `ChordStore` stays exactly the public contract.
 */
interface ChordStoreInternal {
  beginTransaction: (label: string) => void;
  endTransaction: () => void;
  _undoStack: UndoEntry[];
  _redoStack: UndoEntry[];
  _txDepth: number;
  _txBase: ChordProject | null;
  _txLabel: string | null;
  _txMutated: boolean;
}

export type ChordStoreImpl = ChordStore & ChordStoreInternal;

function emptyExportJob(): ChordStore['exportJob'] {
  return { status: 'idle', percent: 0, etaMs: null, outputPath: null, error: null };
}

export function createChordStore(api: ChordDesktopAPI) {
  return create<ChordStoreImpl>()((set, get) => {
    async function resolveMedia(project: ChordProject): Promise<void> {
      const [audioUrl, backgroundUrl] = await Promise.all([
        project.audio ? api.mediaUrl(project.audio.path) : Promise.resolve(null),
        project.background.kind !== 'color' ? api.mediaUrl(project.background.media.path) : Promise.resolve(null),
      ]);
      // The document may have changed again while these awaits were in
      // flight (a second load fired before the first resolved); a stale
      // response must not clobber the media for the document now showing.
      if (get().document.project.id !== project.id) return;
      set({ media: { audioUrl, backgroundUrl } });
    }

    return {
      // ── State ────────────────────────────────────────────────────────
      // A fresh, untitled, empty project so `Welcome` and the rest of the
      // shell have a real document to read before `newDocument`/
      // `openDocument` ever runs (matches how the app opens in practice: an
      // untitled document exists from launch, mirroring most desktop apps).
      document: { project: createEmptyProject(nowIso(), createId()), path: null },
      dirty: false,
      selection: [],
      playback: { playing: false, timeMs: 0, loop: false },
      timeline: { zoom: 80, scrollMs: 0, viewportWidth: 0 },
      tool: 'select',
      tapIndex: null,
      tapOrder: null,
      inspectorTab: 'cue',
      media: { audioUrl: null, backgroundUrl: null },
      canUndo: false,
      canRedo: false,
      exportJob: emptyExportJob(),

      _undoStack: [],
      _redoStack: [],
      _txDepth: 0,
      _txBase: null,
      _txLabel: null,
      _txMutated: false,

      // ── Document lifecycle ──────────────────────────────────────────
      loadDocument: (document) => {
        set({
          document,
          dirty: false,
          selection: [],
          tool: 'select',
          tapIndex: null,
          tapOrder: null,
          inspectorTab: 'cue',
          playback: { playing: false, timeMs: 0, loop: false },
          media: { audioUrl: null, backgroundUrl: null },
          exportJob: emptyExportJob(),
          _undoStack: [],
          _redoStack: [],
          _txDepth: 0,
          _txBase: null,
          _txLabel: null,
          _txMutated: false,
          canUndo: false,
          canRedo: false,
        });
        void resolveMedia(document.project);
        void api.setDocumentState({ title: document.project.title, path: document.path, dirty: false });
      },

      newDocument: async () => {
        const document = await api.newProject();
        get().loadDocument(document);
      },

      openDocument: async (path) => {
        const document = await api.openProject(path);
        if (document) get().loadDocument(document);
      },

      saveDocument: async (saveAs) => {
        const state = get();
        const path = await api.saveProject(state.document, { saveAs });
        if (path === null) return;
        set({ document: { ...state.document, path }, dirty: false });
        void api.setDocumentState({ title: state.document.project.title, path, dirty: false });
      },

      updateProject: (label, mutate) => {
        const state = get();
        const draft = structuredClone(state.document.project);
        mutate(draft);
        draft.cues = normalizeCues(draft.cues);
        draft.updatedAt = nowIso();

        if (state._txDepth > 0) {
          if (!state._txMutated) set({ _txMutated: true, _redoStack: [], canRedo: false });
          set({ document: { ...state.document, project: draft }, dirty: true });
          return;
        }

        const undoStack = [...state._undoStack, { project: state.document.project, label }];
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        set({
          document: { ...state.document, project: draft },
          dirty: true,
          _undoStack: undoStack,
          _redoStack: [],
          canUndo: true,
          canRedo: false,
        });
      },

      undo: () => {
        const state = get();
        const entry = state._undoStack.at(-1);
        if (!entry) return;
        const undoStack = state._undoStack.slice(0, -1);
        const redoStack = [...state._redoStack, { project: state.document.project, label: entry.label }];
        if (redoStack.length > UNDO_LIMIT) redoStack.shift();
        set({
          document: { ...state.document, project: entry.project },
          dirty: true,
          _undoStack: undoStack,
          _redoStack: redoStack,
          canUndo: undoStack.length > 0,
          canRedo: true,
        });
      },

      redo: () => {
        const state = get();
        const entry = state._redoStack.at(-1);
        if (!entry) return;
        const redoStack = state._redoStack.slice(0, -1);
        const undoStack = [...state._undoStack, { project: state.document.project, label: entry.label }];
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        set({
          document: { ...state.document, project: entry.project },
          dirty: true,
          _undoStack: undoStack,
          _redoStack: redoStack,
          canUndo: true,
          canRedo: redoStack.length > 0,
        });
      },

      beginTransaction: (label) => {
        const state = get();
        if (state._txDepth > 0) {
          set({ _txDepth: state._txDepth + 1 });
          return;
        }
        set({ _txDepth: 1, _txBase: state.document.project, _txLabel: label, _txMutated: false });
      },

      endTransaction: () => {
        const state = get();
        if (state._txDepth === 0) return;
        if (state._txDepth > 1) {
          set({ _txDepth: state._txDepth - 1 });
          return;
        }
        const { _txBase, _txLabel, _txMutated } = state;
        set({ _txDepth: 0, _txBase: null, _txLabel: null, _txMutated: false });
        if (_txMutated && _txBase) {
          const undoStack = [...get()._undoStack, { project: _txBase, label: _txLabel ?? 'Edit' }];
          if (undoStack.length > UNDO_LIMIT) undoStack.shift();
          set({ _undoStack: undoStack, canUndo: true });
        }
      },

      // ── Cues ─────────────────────────────────────────────────────────
      addCue: (startMs, text = 'New line') => {
        const id = createId();
        const cue: ChordCue = { id, startMs, endMs: null, text, override: null };
        get().updateProject('Add cue', (draft) => {
          draft.cues = insertCue(draft.cues, cue);
        });
        get().select([id]);
        return id;
      },

      updateCue: (id, patch) => {
        get().updateProject('Edit cue', (draft) => {
          draft.cues = draft.cues.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue));
        });
      },

      setCueText: (id, text, richBody) => {
        get().updateProject('Edit text', (draft) => {
          draft.cues = draft.cues.map((cue) => (cue.id === id ? { ...cue, text, richBody } : cue));
        });
      },

      moveCues: (ids, deltaMs) => {
        get().updateProject(ids.length > 1 ? 'Move cues' : 'Move cue', (draft) => {
          draft.cues = moveCuesPure(draft.cues, ids, deltaMs);
        });
      },

      trimCue: (id, edge, timeMs) => {
        get().updateProject('Trim cue', (draft) => {
          draft.cues = trimCuePure(draft.cues, id, edge, timeMs, draft.composition.fps);
        });
      },

      splitCueAt: (id, timeMs) => {
        let newId: string | null = null;
        get().updateProject('Split cue', (draft) => {
          const result = splitCuePure(draft.cues, id, timeMs, createId);
          draft.cues = result.cues;
          if (result.newId !== id) newId = result.newId;
        });
        if (newId) set({ selection: [newId] });
      },

      deleteCues: (ids) => {
        get().updateProject(ids.length > 1 ? `Delete ${ids.length} cues` : 'Delete cue', (draft) => {
          draft.cues = deleteCuesPure(draft.cues, ids);
        });
        set((state) => ({ selection: state.selection.filter((id) => !ids.includes(id)) }));
      },

      detachCue: (id) => {
        // A detached-but-unedited cue's override is `{}` (present, but every
        // field still inherits) — deliberately not run through
        // `normalizeOverride`, which would collapse an empty object back to
        // `null` and undo the detach it was meant to record.
        get().updateProject('Detach cue', (draft) => {
          draft.cues = draft.cues.map((cue) => (cue.id === id ? { ...cue, override: cue.override ?? {} } : cue));
        });
      },

      relinkCue: (id) => {
        get().updateProject('Relink cue', (draft) => {
          draft.cues = draft.cues.map((cue) => (cue.id === id ? { ...cue, override: null } : cue));
        });
      },

      setCueOverride: (id, override) => {
        get().updateProject('Edit style', (draft) => {
          draft.cues = draft.cues.map((cue) => (
            // A detached cue whose every field was reset stays detached (`{}`):
            // only `relinkCue` may hand it back to the theme.
            cue.id === id ? { ...cue, override: override ? (normalizeOverride(override) ?? {}) : null } : cue
          ));
        });
      },

      replaceCues: (cues) => {
        get().updateProject('Import cues', (draft) => {
          draft.cues = cues;
        });
        set({ selection: [] });
      },

      // ── Look ─────────────────────────────────────────────────────────
      setTheme: (patch) => {
        const keys = Object.keys(patch);
        const onlyPresetId = keys.length === 1 && keys[0] === 'presetId';
        get().updateProject('Edit theme', (draft) => {
          draft.theme = { ...draft.theme, ...patch, ...(onlyPresetId ? {} : { presetId: 'custom' }) };
        });
      },

      applyPreset: (presetId) => {
        const preset = findPreset(presetId);
        if (!preset) return;
        get().updateProject('Apply preset', (draft) => {
          draft.theme = { ...preset.theme, presetId: preset.id };
        });
      },

      setBackground: (background, url) => {
        get().updateProject('Edit background', (draft) => {
          draft.background = background;
        });
        set((state) => ({ media: { ...state.media, backgroundUrl: url } }));
      },

      setComposition: (patch) => {
        const current = get().document.project.composition;
        const next = { ...current, ...patch };
        const sizeChanged = next.width !== current.width || next.height !== current.height;
        get().updateProject('Edit composition', (draft) => {
          if (sizeChanged) draft.theme = scaleThemeToComposition(draft.theme, current, next);
          draft.composition = next;
        });
      },

      setAudio: (audio, url) => {
        get().updateProject(audio ? 'Set audio' : 'Remove audio', (draft) => {
          draft.audio = audio;
        });
        set((state) => ({ media: { ...state.media, audioUrl: url } }));
      },

      setTitle: (title) => {
        get().updateProject('Rename project', (draft) => {
          draft.title = title;
        });
      },

      // ── Selection, tools, view ──────────────────────────────────────
      select: (ids, mode = 'replace') => {
        set((state) => {
          if (mode === 'replace') return { selection: [...ids] };
          if (mode === 'add') return { selection: Array.from(new Set([...state.selection, ...ids])) };
          const next = new Set(state.selection);
          for (const id of ids) {
            if (next.has(id)) next.delete(id);
            else next.add(id);
          }
          return { selection: Array.from(next) };
        });
      },

      clearSelection: () => set({ selection: [] }),

      setTool: (tool) =>
        set({
          tool,
          tapIndex: tool === 'tap' ? 0 : null,
          tapOrder: tool === 'tap' ? get().document.project.cues.map((cue) => cue.id) : null,
        }),

      setInspectorTab: (tab) => set({ inspectorTab: tab }),

      setTimelineView: (patch) => set((state) => ({ timeline: { ...state.timeline, ...patch } })),

      zoomBy: (factor, anchorMs) => {
        const state = get();
        const anchor = anchorMs ?? state.playback.timeMs;
        const oldZoom = state.timeline.zoom;
        const newZoom = clampZoom(oldZoom * factor);
        const anchorPx = ((anchor - state.timeline.scrollMs) / 1000) * oldZoom;
        const newScrollMs = anchor - (anchorPx / newZoom) * 1000;
        set({ timeline: { ...state.timeline, zoom: newZoom, scrollMs: Math.max(0, newScrollMs) } });
      },

      zoomToFit: () => {
        const state = get();
        const end = Math.max(0, timelineEndMs(state.document.project));
        const viewport = state.timeline.viewportWidth;
        if (end <= 0 || viewport <= 0) {
          set({ timeline: { ...state.timeline, scrollMs: 0 } });
          return;
        }
        set({ timeline: { ...state.timeline, zoom: clampZoom((viewport / end) * 1000), scrollMs: 0 } });
      },

      // ── Playback ─────────────────────────────────────────────────────
      play: () => set((state) => ({ playback: { ...state.playback, playing: true } })),
      pause: () => set((state) => ({ playback: { ...state.playback, playing: false } })),
      togglePlay: () => set((state) => ({ playback: { ...state.playback, playing: !state.playback.playing } })),

      seek: (timeMs) => {
        const state = get();
        const end = Math.max(0, timelineEndMs(state.document.project));
        const clamped = Math.min(Math.max(0, timeMs), end);
        set({ playback: { ...state.playback, timeMs: clamped } });
      },

      stepFrames: (frames) => {
        const state = get();
        const step = frameDurationMs(state.document.project.composition.fps);
        get().seek(state.playback.timeMs + frames * step);
      },

      setLoop: (loop) => set((state) => ({ playback: { ...state.playback, loop } })),

      tick: (timeMs) => set((state) => ({ playback: { ...state.playback, timeMs } })),

      tapMark: () => {
        const state = get();
        const project = state.document.project;
        const index = state.tapIndex ?? 0;
        // `tapOrder` is the stable order captured when tap mode started;
        // `project.cues` itself gets re-sorted by `startMs` on every
        // `updateProject`, so once a tap re-times a cue ahead of its
        // neighbours, a live array position no longer points at "the next
        // untimed cue" (see the field doc in `./types.ts`).
        const order = state.tapOrder ?? project.cues.map((cue) => cue.id);
        const quantized = quantizeToFrame(state.playback.timeMs, project.composition.fps);

        if (index < order.length) {
          const targetId = order[index]!;
          get().updateProject('Time cue', (draft) => {
            draft.cues = draft.cues.map((cue) => (cue.id === targetId ? { ...cue, startMs: quantized } : cue));
          });
          set({ tapIndex: index + 1, tapOrder: order, selection: [targetId] });
        } else {
          const id = createId();
          get().updateProject('Add cue', (draft) => {
            draft.cues = insertCue(draft.cues, { id, startMs: quantized, endMs: null, text: 'New line', override: null });
          });
          set({ tapIndex: index + 1, tapOrder: [...order, id], selection: [id] });
        }
      },

      // ── Export ───────────────────────────────────────────────────────
      setExportJob: (patch) => set((state) => ({ exportJob: { ...state.exportJob, ...patch } })),

      exportCueFile: async (format) => {
        const project = get().document.project;
        const end = Math.max(0, timelineEndMs(project));
        const timed = timedCuesFromCues(project.cues, end);
        const text = formatCues(timed, format);
        const suggestedName = `${project.title || 'lyrics'}.${format}`;
        await api.exportCues(text, format, suggestedName);
      },
    };
  });
}
