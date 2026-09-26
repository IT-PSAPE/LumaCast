// Shared fake-store helper for LumaChord renderer tests. Feature tests that
// render a component reading `useChordStore` mock the store module and
// return `createTestStore(...)` from it, so a component test never has to
// wire up a real Zustand store or a real/mock desktop API.
//
// Deliberately self-contained: the default project is a hand-built literal
// matching `ChordProject` (the stable, already-final contract in
// `shared/project.ts`) rather than built via `createEmptyProject`, so this
// helper — which most other Chord renderer tests transitively depend on —
// does not go down if `shared/project-schema.ts` is mid-flight.
import { vi } from 'vitest';
import { PROJECT_FORMAT_VERSION } from '../../../../apps/chord/shared/project';
import type { ChordProject, ProjectDocument } from '../../../../apps/chord/shared/project';
import type { ChordStore } from '../../../../apps/chord/renderer/store/types';

/** The store's own transaction helpers, beyond the `ChordStore` contract (see `create-store.ts`). */
export interface TestChordStore extends ChordStore {
  beginTransaction: (label: string) => void;
  endTransaction: () => void;
}

export function createTestProject(overrides: Partial<ChordProject> = {}): ChordProject {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: 'test-project',
    title: 'Untitled',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    composition: { width: 1920, height: 1080, fps: 30 },
    audio: null,
    background: { kind: 'color', color: '#000000' },
    theme: {
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
    },
    cues: [],
    ...overrides,
  };
}

export function createTestDocument(overrides: Partial<ChordProject> = {}): ProjectDocument {
  return { project: createTestProject(overrides), path: null };
}

export function createTestStore(overrides: Partial<TestChordStore> = {}): TestChordStore {
  const base: TestChordStore = {
    document: createTestDocument(),
    dirty: false,
    selection: [],
    playback: { playing: false, timeMs: 0, loop: false },
    timeline: { zoom: 80, scrollMs: 0, viewportWidth: 800 },
    tool: 'select',
    tapIndex: null,
    inspectorTab: 'cue',
    media: { audioUrl: null, backgroundUrl: null },
    canUndo: false,
    canRedo: false,
    exportJob: { status: 'idle', percent: 0, etaMs: null, outputPath: null, error: null },

    loadDocument: vi.fn(),
    newDocument: vi.fn(async () => {}),
    openDocument: vi.fn(async () => {}),
    saveDocument: vi.fn(async () => {}),
    updateProject: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),

    addCue: vi.fn(() => 'new-cue-id'),
    updateCue: vi.fn(),
    setCueText: vi.fn(),
    moveCues: vi.fn(),
    trimCue: vi.fn(),
    splitCueAt: vi.fn(),
    deleteCues: vi.fn(),
    detachCue: vi.fn(),
    relinkCue: vi.fn(),
    setCueOverride: vi.fn(),
    replaceCues: vi.fn(),

    setTheme: vi.fn(),
    applyPreset: vi.fn(),
    setBackground: vi.fn(),
    setComposition: vi.fn(),
    setAudio: vi.fn(),
    setTitle: vi.fn(),

    select: vi.fn(),
    clearSelection: vi.fn(),
    setTool: vi.fn(),
    setInspectorTab: vi.fn(),
    setTimelineView: vi.fn(),
    zoomBy: vi.fn(),
    zoomToFit: vi.fn(),

    play: vi.fn(),
    pause: vi.fn(),
    togglePlay: vi.fn(),
    seek: vi.fn(),
    stepFrames: vi.fn(),
    setLoop: vi.fn(),
    tick: vi.fn(),
    tapMark: vi.fn(),

    setExportJob: vi.fn(),
    exportCueFile: vi.fn(async () => {}),

    beginTransaction: vi.fn(),
    endTransaction: vi.fn(),
  };

  return { ...base, ...overrides };
}
