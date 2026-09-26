// Store-level tests for `createChordStore`. The shared cue/theme/project
// pure helpers and the playback feature's `timelineEndMs` are mocked with
// small, deterministic stand-ins (owned by other in-flight agents) so these
// tests exercise the STORE's own orchestration — undo/redo bookkeeping,
// transaction batching, label recording, dirty flags, zoom math, and
// preset/custom semantics — independent of their real implementations.
// `@lumacast/kernel` and `@lumacast/markers` are real: both are already
// built and stable.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChordDesktopAPI } from '../../../../../apps/chord/shared/desktop-api';
import type { ChordCue, ChordProject, ChordTheme, ProjectDocument } from '../../../../../apps/chord/shared/project';
import { PROJECT_FORMAT_VERSION } from '../../../../../apps/chord/shared/project';
import type { ThemePreset } from '../../../../../apps/chord/shared/theme-presets';

const fixtures = vi.hoisted(() => {
  const theme: ChordTheme = {
    presetId: 'default',
    text: {
      fontFamily: 'Arial',
      fontSize: 64,
      color: '#ffffff',
      weight: 'bold',
      italic: false,
      underline: false,
      alignment: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      caseTransform: 'none',
      autoFit: true,
      autoFitMaxFontSize: 96,
      textStrokeEnabled: false,
      textStrokeColor: '#000000',
      textStrokeWidth: 2,
      textShadowEnabled: false,
      textShadowColor: '#000000',
      textShadowBlur: 4,
      textShadowOffsetX: 0,
      textShadowOffsetY: 2,
    },
    box: { x: 100, y: 700, width: 1720, height: 280, rotation: 0, opacity: 1 },
    transition: { in: 'fade', out: 'fade', durationMs: 300 },
  };

  const knownPreset: ThemePreset = {
    id: 'known',
    label: 'Known',
    theme: {
      ...theme,
      presetId: 'known',
      text: { ...theme.text, fontFamily: 'Georgia', fontSize: 48 },
    },
    swatch: { background: '#000000', text: '#ffffff' },
  };

  function makeProject(id: string, now: string): ChordProject {
    return {
      formatVersion: PROJECT_FORMAT_VERSION,
      id,
      title: 'Untitled',
      createdAt: now,
      updatedAt: now,
      composition: { width: 1920, height: 1080, fps: 30 },
      audio: null,
      background: { kind: 'color', color: '#000000' },
      theme,
      cues: [],
    };
  }

  return { theme, knownPreset, makeProject };
});

vi.mock('../../../../../apps/chord/shared/project-schema', () => ({
  createEmptyProject: (now: string, id: string) => fixtures.makeProject(id, now),
  serializeProject: (project: ChordProject) => JSON.stringify(project),
}));

vi.mock('../../../../../apps/chord/shared/theme-presets', () => ({
  THEME_PRESETS: [fixtures.knownPreset],
  DEFAULT_PRESET_ID: 'default',
  findPreset: (id: string) => (id === 'known' ? fixtures.knownPreset : undefined),
  scaleThemeToComposition: vi.fn((theme: ChordTheme, from: unknown, to: unknown) => ({
    ...theme,
    scaledFrom: from,
    scaledTo: to,
  })),
}));

vi.mock('../../../../../apps/chord/shared/cue-model', () => ({
  normalizeCues: (cues: ChordCue[]) => [...cues].sort((a, b) => a.startMs - b.startMs),
  normalizeOverride: (override: unknown) => override,
  insertCue: (cues: ChordCue[], cue: ChordCue) => [...cues, cue].sort((a, b) => a.startMs - b.startMs),
  moveCues: (cues: ChordCue[], ids: readonly string[], deltaMs: number) => cues.map((cue) => (
    ids.includes(cue.id) ? { ...cue, startMs: cue.startMs + deltaMs } : cue
  )),
  trimCue: (cues: ChordCue[], id: string, edge: 'start' | 'end', timeMs: number, _fps: number) => cues.map((cue) => (
    cue.id === id ? { ...cue, [edge === 'start' ? 'startMs' : 'endMs']: timeMs } : cue
  )),
  splitCue: (cues: ChordCue[], id: string, timeMs: number, idFactory: () => string) => {
    const index = cues.findIndex((cue) => cue.id === id);
    if (index === -1) return { cues: [...cues], newId: id };
    const newId = idFactory();
    const cue = cues[index]!;
    const result = [...cues];
    result.splice(index, 1, { ...cue, endMs: timeMs }, { ...cue, id: newId, startMs: timeMs });
    return { cues: result, newId };
  },
  deleteCues: (cues: ChordCue[], ids: readonly string[]) => cues.filter((cue) => !ids.includes(cue.id)),
  frameDurationMs: (fps: number) => 1000 / fps,
  quantizeToFrame: (ms: number, fps: number) => Math.round(ms / (1000 / fps)) * (1000 / fps),
  timedCuesFromCues: (cues: ChordCue[], endMs: number) => cues.map((cue, index) => ({
    order: index + 1,
    startMs: cue.startMs,
    endMs: cue.endMs ?? endMs,
    text: cue.text,
  })),
}));

const timelineEndMsMock = vi.fn((project: ChordProject) => project.audio?.durationMs ?? 10_000);

vi.mock('../../../../../apps/chord/renderer/features/playback', () => ({
  timelineEndMs: (project: ChordProject) => timelineEndMsMock(project),
  AudioElement: () => null,
}));

import { createChordStore, type ChordStoreImpl } from '../../../../../apps/chord/renderer/store/create-store';

function createFakeApi(overrides: Partial<ChordDesktopAPI> = {}): ChordDesktopAPI {
  return {
    newProject: vi.fn(async () => ({ project: fixtures.makeProject('new-project', '2024-06-01T00:00:00.000Z'), path: null })),
    openProject: vi.fn(async () => null),
    saveProject: vi.fn(async () => null),
    recentProjects: vi.fn(async () => []),
    setDocumentState: vi.fn(async () => {}),
    importMedia: vi.fn(async () => null),
    admitFiles: vi.fn(async () => []),
    pathsForFiles: vi.fn(() => []),
    mediaUrl: vi.fn(async () => null),
    readCueFile: vi.fn(async () => ''),
    exportCues: vi.fn(async () => null),
    chooseExportPath: vi.fn(async () => null),
    exportOpen: vi.fn(async (path: string) => ({ id: 'sink-1', path })),
    exportWrite: vi.fn(async () => {}),
    exportClose: vi.fn(async () => {}),
    exportAbort: vi.fn(async () => {}),
    revealPath: vi.fn(async () => {}),
    onMenuCommand: vi.fn(() => () => {}),
    onOpenDocument: vi.fn(() => () => {}),
    ...overrides,
  };
}

function makeCue(id: string, startMs: number, patch: Partial<ChordCue> = {}): ChordCue {
  return { id, startMs, endMs: null, text: `Line ${id}`, override: null, ...patch };
}

describe('createChordStore', () => {
  let api: ChordDesktopAPI;
  let store: ReturnType<typeof createChordStore>;

  beforeEach(() => {
    timelineEndMsMock.mockClear();
    timelineEndMsMock.mockImplementation((project: ChordProject) => project.audio?.durationMs ?? 10_000);
    api = createFakeApi();
    store = createChordStore(api);
  });

  function state(): ChordStoreImpl {
    return store.getState();
  }

  function setCues(cues: ChordCue[]) {
    store.setState((s) => ({ document: { ...s.document, project: { ...s.document.project, cues } } }));
  }

  // ── Initial state ───────────────────────────────────────────────────
  it('starts on a fresh, untitled, clean document', () => {
    expect(state().document.project.title).toBe('Untitled');
    expect(state().document.path).toBeNull();
    expect(state().dirty).toBe(false);
    expect(state().canUndo).toBe(false);
    expect(state().canRedo).toBe(false);
    expect(state().selection).toEqual([]);
  });

  // ── updateProject / undo / redo / dirty ─────────────────────────────
  describe('updateProject, undo, redo', () => {
    it('applies the mutation, marks dirty, and records one labelled undo step', () => {
      state().updateProject('Rename project', (draft) => {
        draft.title = 'New Title';
      });
      expect(state().document.project.title).toBe('New Title');
      expect(state().dirty).toBe(true);
      expect(state().canUndo).toBe(true);
      expect(state().canRedo).toBe(false);
      expect(state()._undoStack.at(-1)?.label).toBe('Rename project');
    });

    it('undo restores the previous project and arms redo; redo replays it', () => {
      state().updateProject('Rename project', (draft) => {
        draft.title = 'New Title';
      });
      state().undo();
      expect(state().document.project.title).toBe('Untitled');
      expect(state().canUndo).toBe(false);
      expect(state().canRedo).toBe(true);
      expect(state().dirty).toBe(true);

      state().redo();
      expect(state().document.project.title).toBe('New Title');
      expect(state().canUndo).toBe(true);
      expect(state().canRedo).toBe(false);
    });

    it('a fresh edit clears the redo stack', () => {
      state().updateProject('Rename project', (draft) => { draft.title = 'A'; });
      state().undo();
      expect(state().canRedo).toBe(true);
      state().updateProject('Rename project again', (draft) => { draft.title = 'B'; });
      expect(state().canRedo).toBe(false);
      expect(state().document.project.title).toBe('B');
    });

    it('undo is a no-op with an empty stack', () => {
      state().undo();
      expect(state().document.project.title).toBe('Untitled');
      expect(state().canUndo).toBe(false);
    });

    it('caps the undo stack at 200 entries', () => {
      for (let i = 0; i < 205; i += 1) {
        state().updateProject(`Edit ${i}`, (draft) => { draft.title = `Title ${i}`; });
      }
      expect(state()._undoStack.length).toBe(200);
      expect(state()._undoStack[0]?.label).toBe('Edit 5');
    });
  });

  // ── Transactions ─────────────────────────────────────────────────────
  describe('beginTransaction / endTransaction', () => {
    it('collapses several mutations into a single undo step', () => {
      setCues([makeCue('a', 1000)]);
      const before = state()._undoStack.length;

      state().beginTransaction('Move cue');
      state().moveCues(['a'], 100);
      state().moveCues(['a'], 100);
      state().moveCues(['a'], 100);
      state().endTransaction();

      expect(state()._undoStack.length).toBe(before + 1);
      expect(state()._undoStack.at(-1)?.label).toBe('Move cue');
      expect(state().document.project.cues.find((c) => c.id === 'a')?.startMs).toBe(1300);

      state().undo();
      expect(state().document.project.cues.find((c) => c.id === 'a')?.startMs).toBe(1000);
    });

    it('records nothing when the transaction never mutates', () => {
      const before = state()._undoStack.length;
      state().beginTransaction('No-op drag');
      state().endTransaction();
      expect(state()._undoStack.length).toBe(before);
      expect(state().dirty).toBe(false);
    });

    it('nested begin/end only commits on the outermost end', () => {
      setCues([makeCue('a', 0)]);
      const before = state()._undoStack.length;
      state().beginTransaction('Outer');
      state().beginTransaction('Inner');
      state().moveCues(['a'], 50);
      state().endTransaction();
      expect(state()._undoStack.length).toBe(before); // still open
      state().endTransaction();
      expect(state()._undoStack.length).toBe(before + 1);
    });
  });

  // ── Cue actions ──────────────────────────────────────────────────────
  describe('cue actions', () => {
    it('addCue inserts a default-text cue, selects it, and returns its id', () => {
      const id = state().addCue(2000);
      expect(state().document.project.cues).toHaveLength(1);
      expect(state().document.project.cues[0]).toMatchObject({ id, startMs: 2000, text: 'New line' });
      expect(state().selection).toEqual([id]);
      expect(state()._undoStack.at(-1)?.label).toBe('Add cue');
    });

    it('updateCue patches arbitrary fields', () => {
      setCues([makeCue('a', 0)]);
      state().updateCue('a', { startMs: 250 });
      expect(state().document.project.cues[0]?.startMs).toBe(250);
      expect(state()._undoStack.at(-1)?.label).toBe('Edit cue');
    });

    it('setCueText updates text (and richBody) with an "Edit text" label', () => {
      setCues([makeCue('a', 0)]);
      state().setCueText('a', 'Hello world');
      expect(state().document.project.cues[0]?.text).toBe('Hello world');
      expect(state()._undoStack.at(-1)?.label).toBe('Edit text');
    });

    it('moveCues labels a single cue "Move cue" and several "Move cues"', () => {
      setCues([makeCue('a', 0), makeCue('b', 1000)]);
      state().moveCues(['a'], 500);
      expect(state()._undoStack.at(-1)?.label).toBe('Move cue');
      state().moveCues(['a', 'b'], 500);
      expect(state()._undoStack.at(-1)?.label).toBe('Move cues');
    });

    it('trimCue and splitCueAt delegate to the pure helpers', () => {
      setCues([makeCue('a', 0)]);
      state().trimCue('a', 'end', 4000);
      expect(state().document.project.cues.find((c) => c.id === 'a')?.endMs).toBe(4000);
      expect(state()._undoStack.at(-1)?.label).toBe('Trim cue');

      state().splitCueAt('a', 2000);
      expect(state().document.project.cues.length).toBe(2);
      expect(state()._undoStack.at(-1)?.label).toBe('Split cue');
      // The second half is a new cue id, selected afterwards.
      const [first, second] = state().document.project.cues;
      expect(second?.id).not.toBe('a');
      expect(first?.id).toBe('a');
      expect(state().selection).toEqual([second?.id]);
    });

    it('deleteCues labels singular/plural and clears the selection', () => {
      setCues([makeCue('a', 0), makeCue('b', 1000), makeCue('c', 2000)]);
      state().select(['a', 'b']);
      state().deleteCues(['a', 'b']);
      expect(state().document.project.cues.map((c) => c.id)).toEqual(['c']);
      expect(state().selection).toEqual([]);
      expect(state()._undoStack.at(-1)?.label).toBe('Delete 2 cues');

      setCues([makeCue('d', 0)]);
      state().deleteCues(['d']);
      expect(state()._undoStack.at(-1)?.label).toBe('Delete cue');
    });

    it('detachCue/relinkCue toggle the override', () => {
      setCues([makeCue('a', 0)]);
      state().detachCue('a');
      expect(state().document.project.cues[0]?.override).not.toBeNull();
      expect(state()._undoStack.at(-1)?.label).toBe('Detach cue');

      state().relinkCue('a');
      expect(state().document.project.cues[0]?.override).toBeNull();
      expect(state()._undoStack.at(-1)?.label).toBe('Relink cue');
    });

    it('setCueOverride writes a normalized override with an "Edit style" label', () => {
      setCues([makeCue('a', 0)]);
      state().setCueOverride('a', { text: { fontSize: 12 } });
      expect(state().document.project.cues[0]?.override).toEqual({ text: { fontSize: 12 } });
      expect(state()._undoStack.at(-1)?.label).toBe('Edit style');
    });

    it('replaceCues swaps every cue and clears the selection', () => {
      setCues([makeCue('a', 0)]);
      state().select(['a']);
      state().replaceCues([makeCue('x', 0), makeCue('y', 1000)]);
      expect(state().document.project.cues.map((c) => c.id)).toEqual(['x', 'y']);
      expect(state().selection).toEqual([]);
      expect(state()._undoStack.at(-1)?.label).toBe('Import cues');
    });
  });

  // ── Tap-to-mark ──────────────────────────────────────────────────────
  describe('tapMark', () => {
    it('times cues in tapIndex order, quantised to the frame, then adds one past the end', () => {
      setCues([makeCue('a', 0), makeCue('b', 0)]);
      state().setTool('tap');
      expect(state().tapIndex).toBe(0);

      state().tick(1001); // 30fps -> frame = 33.33ms; nearest frame boundary
      state().tapMark();
      expect(state().tapIndex).toBe(1);
      expect(state().selection).toEqual(['a']);
      const timedA = state().document.project.cues.find((c) => c.id === 'a')!;
      expect(timedA.startMs).toBeCloseTo(Math.round(1001 / (1000 / 30)) * (1000 / 30));

      state().tick(2000);
      state().tapMark();
      expect(state().tapIndex).toBe(2);
      expect(state().selection).toEqual(['b']);

      state().tick(3000);
      state().tapMark();
      expect(state().tapIndex).toBe(3);
      expect(state().document.project.cues).toHaveLength(3);
      const added = state().document.project.cues.find((c) => c.id !== 'a' && c.id !== 'b')!;
      expect(added.text).toBe('New line');
      expect(state().selection).toEqual([added.id]);
    });

    it('setTool clears tapIndex when leaving tap mode', () => {
      state().setTool('tap');
      expect(state().tapIndex).toBe(0);
      state().setTool('select');
      expect(state().tapIndex).toBeNull();
    });
  });

  // ── Theme: preset vs custom ──────────────────────────────────────────
  describe('theme presets and custom edits', () => {
    it('applyPreset sets the theme from findPreset and the given id', () => {
      state().applyPreset('known');
      expect(state().document.project.theme).toEqual({ ...fixtures.knownPreset.theme, presetId: 'known' });
    });

    it('applyPreset is a no-op for an unknown id', () => {
      const before = state().document.project.theme;
      state().applyPreset('does-not-exist');
      expect(state().document.project.theme).toBe(before);
      expect(state()._undoStack.length).toBe(0);
    });

    it('setTheme marks the theme custom unless the patch is only presetId', () => {
      state().setTheme({ text: { ...state().document.project.theme.text, fontSize: 12 } });
      expect(state().document.project.theme.presetId).toBe('custom');

      state().applyPreset('known');
      state().setTheme({ presetId: 'known' });
      expect(state().document.project.theme.presetId).toBe('known');
    });
  });

  // ── Composition scaling ──────────────────────────────────────────────
  describe('setComposition', () => {
    it('scales the theme when width/height change', async () => {
      const { scaleThemeToComposition } = await import('../../../../../apps/chord/shared/theme-presets');
      const before = state().document.project.composition;
      state().setComposition({ width: 3840, height: 2160 });
      expect(scaleThemeToComposition).toHaveBeenCalledWith(fixtures.theme, before, { ...before, width: 3840, height: 2160 });
      expect(state().document.project.composition).toEqual({ width: 3840, height: 2160, fps: 30 });
    });

    it('does not scale the theme for an fps-only change', async () => {
      const { scaleThemeToComposition } = await import('../../../../../apps/chord/shared/theme-presets');
      vi.mocked(scaleThemeToComposition).mockClear();
      state().setComposition({ fps: 60 });
      expect(scaleThemeToComposition).not.toHaveBeenCalled();
      expect(state().document.project.composition.fps).toBe(60);
    });
  });

  // ── Media wiring ─────────────────────────────────────────────────────
  it('setAudio/setBackground update the project and the resolved media urls', () => {
    state().setAudio({ path: '/song.mp3', name: 'song.mp3', durationMs: 5000 }, 'lumachord://file/song.mp3');
    expect(state().document.project.audio?.path).toBe('/song.mp3');
    expect(state().media.audioUrl).toBe('lumachord://file/song.mp3');

    state().setBackground({ kind: 'color', color: '#112233' }, null);
    expect(state().document.project.background).toEqual({ kind: 'color', color: '#112233' });
    expect(state().media.backgroundUrl).toBeNull();
  });

  // ── Selection ────────────────────────────────────────────────────────
  it('select supports replace/add/toggle', () => {
    state().select(['a']);
    expect(state().selection).toEqual(['a']);
    state().select(['b'], 'add');
    expect(state().selection).toEqual(['a', 'b']);
    state().select(['a'], 'toggle');
    expect(state().selection).toEqual(['b']);
  });

  // ── Zoom ─────────────────────────────────────────────────────────────
  describe('zoom', () => {
    it('zoomBy keeps the anchor under the same pixel', () => {
      state().setTimelineView({ zoom: 100, scrollMs: 1000, viewportWidth: 800 });
      state().zoomBy(2, 3000);
      expect(state().timeline.zoom).toBe(200);
      expect(state().timeline.scrollMs).toBe(2000);
      // The anchor's pixel position is unchanged by the zoom.
      const px = (state().timeline.scrollMs === 2000 ? (3000 - 2000) / 1000 * 200 : NaN);
      expect(px).toBe(200);
    });

    it('zoomBy clamps to the zoom bounds', () => {
      state().setTimelineView({ zoom: 100, scrollMs: 0, viewportWidth: 800 });
      state().zoomBy(0.0001, 0);
      expect(state().timeline.zoom).toBeGreaterThanOrEqual(2);
      state().setTimelineView({ zoom: 100, scrollMs: 0, viewportWidth: 800 });
      state().zoomBy(1000, 0);
      expect(state().timeline.zoom).toBeLessThanOrEqual(4000);
    });

    it('zoomToFit fits the full timeline into the viewport', () => {
      timelineEndMsMock.mockReturnValue(5000);
      state().setTimelineView({ viewportWidth: 1000 });
      state().zoomToFit();
      expect(state().timeline.zoom).toBe(200);
      expect(state().timeline.scrollMs).toBe(0);
    });
  });

  // ── Playback ─────────────────────────────────────────────────────────
  describe('playback', () => {
    it('seek clamps to [0, timelineEnd]', () => {
      timelineEndMsMock.mockReturnValue(10_000);
      state().seek(-500);
      expect(state().playback.timeMs).toBe(0);
      state().seek(20_000);
      expect(state().playback.timeMs).toBe(10_000);
      state().seek(4321);
      expect(state().playback.timeMs).toBe(4321);
    });

    it('stepFrames advances by whole frames at the project fps', () => {
      timelineEndMsMock.mockReturnValue(10_000);
      state().seek(0);
      state().stepFrames(3);
      expect(state().playback.timeMs).toBeCloseTo(3 * (1000 / 30));
    });

    it('tick sets timeMs without clamping', () => {
      state().tick(999_999);
      expect(state().playback.timeMs).toBe(999_999);
    });

    it('play/pause/togglePlay/setLoop flip playback flags', () => {
      state().play();
      expect(state().playback.playing).toBe(true);
      state().pause();
      expect(state().playback.playing).toBe(false);
      state().togglePlay();
      expect(state().playback.playing).toBe(true);
      state().setLoop(true);
      expect(state().playback.loop).toBe(true);
    });
  });

  // ── Export ───────────────────────────────────────────────────────────
  it('exportCueFile formats the cues and hands them to the api', async () => {
    setCues([makeCue('a', 0, { text: 'Line one' })]);
    timelineEndMsMock.mockReturnValue(6000);
    await state().exportCueFile('csv');
    expect(api.exportCues).toHaveBeenCalledTimes(1);
    const [text, format, name] = vi.mocked(api.exportCues).mock.calls[0]!;
    expect(format).toBe('csv');
    expect(name).toBe('Untitled.csv');
    expect(text).toContain('Line one');
  });

  // ── Document lifecycle ───────────────────────────────────────────────
  describe('document lifecycle', () => {
    it('newDocument loads whatever api.newProject resolves and resets history', () => {
      state().updateProject('Edit', (draft) => { draft.title = 'Dirty'; });
      expect(state().canUndo).toBe(true);

      return state().newDocument().then(() => {
        expect(api.newProject).toHaveBeenCalledTimes(1);
        expect(state().document.project.id).toBe('new-project');
        expect(state().dirty).toBe(false);
        expect(state().canUndo).toBe(false);
        expect(api.setDocumentState).toHaveBeenCalledWith({ title: 'Untitled', path: null, dirty: false });
      });
    });

    it('openDocument does nothing when the user cancels the dialog', async () => {
      vi.mocked(api.openProject).mockResolvedValueOnce(null);
      const before = state().document;
      await state().openDocument();
      expect(state().document).toBe(before);
    });

    it('saveDocument updates the path and clears dirty on success', async () => {
      state().updateProject('Edit', (draft) => { draft.title = 'Dirty'; });
      vi.mocked(api.saveProject).mockResolvedValueOnce('/tmp/song.lumachord');
      await state().saveDocument();
      expect(state().document.path).toBe('/tmp/song.lumachord');
      expect(state().dirty).toBe(false);
    });

    it('saveDocument leaves dirty untouched when the user cancels', async () => {
      state().updateProject('Edit', (draft) => { draft.title = 'Dirty'; });
      vi.mocked(api.saveProject).mockResolvedValueOnce(null);
      await state().saveDocument();
      expect(state().dirty).toBe(true);
      expect(state().document.path).toBeNull();
    });

    it('loadDocument resolves audio/background media urls', async () => {
      vi.mocked(api.mediaUrl).mockImplementation(async (path: string) => `lumachord://file/${path}`);
      const project = fixtures.makeProject('loaded', '2024-01-01T00:00:00.000Z');
      project.audio = { path: '/a.mp3', name: 'a.mp3', durationMs: 1000 };
      const document: ProjectDocument = { project, path: '/tmp/x.lumachord' };

      state().loadDocument(document);
      expect(state().dirty).toBe(false);
      expect(state().selection).toEqual([]);
      expect(state().canUndo).toBe(false);

      await vi.waitFor(() => {
        expect(state().media.audioUrl).toBe('lumachord://file//a.mp3');
      });
    });
  });
});
