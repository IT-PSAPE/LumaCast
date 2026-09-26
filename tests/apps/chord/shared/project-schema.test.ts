import { describe, expect, it } from 'vitest';
import {
  ProjectFileError,
  chordProjectSchema,
  createEmptyProject,
  parseProjectFile,
  serializeProject,
  touchProject,
} from '../../../../apps/chord/shared/project-schema';
import type { ChordCue, ChordProject } from '../../../../apps/chord/shared/project';

const NOW = '2026-01-01T00:00:00.000Z';

function cue(overrides: Partial<ChordCue> = {}): ChordCue {
  return {
    id: 'cue-1',
    startMs: 0,
    endMs: null,
    text: 'Hello',
    override: null,
    ...overrides,
  };
}

function fullProject(): ChordProject {
  const base = createEmptyProject(NOW, 'project-1');
  return {
    ...base,
    title: 'My Song',
    background: {
      kind: 'image',
      media: { path: '/tmp/bg.png', name: 'bg.png', durationMs: null, width: 1920, height: 1080 },
      fit: 'cover',
      dim: 0.4,
      blur: 8,
      loop: false,
    },
    audio: { path: '/tmp/song.wav', name: 'song.wav', durationMs: 180000 },
    cues: [
      cue({ id: 'a', startMs: 0, endMs: 4000, text: 'Line one' }),
      cue({
        id: 'b',
        startMs: 4000,
        endMs: null,
        text: 'Line two',
        richBody: [{ runs: [{ text: 'Line two', color: '#FF0000' }], indent: 0 }],
        override: { text: { color: '#FF0000' }, box: { x: 100 } },
      }),
    ],
  };
}

describe('chordProjectSchema / parseProjectFile round trip', () => {
  it('round-trips an empty project', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const text = serializeProject(project);
    const parsed = parseProjectFile(text);
    expect(parsed).toEqual(project);
  });

  it('round-trips a project with background media, audio, overrides, and rich text', () => {
    const project = fullProject();
    const text = serializeProject(project);
    const parsed = parseProjectFile(text);
    expect(parsed).toEqual(project);
  });

  it('serializes with 2-space indentation and a trailing newline', () => {
    const text = serializeProject(createEmptyProject(NOW, 'project-1'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text.slice(0, 2)).toBe('{\n');
    expect(text).toContain('\n  "formatVersion": 1,\n');
  });

  it('produces a stable key order regardless of input key order', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const reordered: ChordProject = {
      cues: project.cues,
      theme: project.theme,
      background: project.background,
      audio: project.audio,
      composition: project.composition,
      updatedAt: project.updatedAt,
      createdAt: project.createdAt,
      title: project.title,
      id: project.id,
      formatVersion: project.formatVersion,
    };
    expect(serializeProject(reordered)).toBe(serializeProject(project));
  });
});

describe('parseProjectFile error handling', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseProjectFile('not json{')).toThrow(ProjectFileError);
    expect(() => parseProjectFile('not json{')).toThrow('This file is not a LumaChord project');
  });

  it('rejects JSON that is not an object', () => {
    expect(() => parseProjectFile('[]')).toThrow('This file is not a LumaChord project');
    expect(() => parseProjectFile('"hello"')).toThrow('This file is not a LumaChord project');
    expect(() => parseProjectFile('42')).toThrow('This file is not a LumaChord project');
  });

  it('rejects garbage objects with no formatVersion', () => {
    expect(() => parseProjectFile(JSON.stringify({ foo: 'bar' }))).toThrow('This file is not a LumaChord project');
  });

  it('rejects an unsupported version with a readable message', () => {
    const project = { ...createEmptyProject(NOW, 'project-1'), formatVersion: 3 };
    expect(() => parseProjectFile(JSON.stringify(project))).toThrow('Unsupported project version 3');
  });

  it('reports a field path for an invalid field', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const raw = { ...project, composition: { ...project.composition, fps: 29 } };
    let error: unknown;
    try {
      parseProjectFile(JSON.stringify(raw));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProjectFileError);
    expect((error as Error).message).toContain('composition.fps');
  });

  it('rejects unknown top-level keys', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const raw = { ...project, unknownField: true };
    expect(() => parseProjectFile(JSON.stringify(raw))).toThrow(ProjectFileError);
  });
});

describe('cue defensiveness during validation', () => {
  it('sorts unsorted cues', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const raw = {
      ...project,
      cues: [cue({ id: 'b', startMs: 4000 }), cue({ id: 'a', startMs: 0 })],
    };
    const parsed = parseProjectFile(JSON.stringify(raw));
    expect(parsed.cues.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('drops duplicate cue ids, keeping the earliest by startMs', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const raw = {
      ...project,
      cues: [cue({ id: 'dup', startMs: 2000, text: 'second' }), cue({ id: 'dup', startMs: 0, text: 'first' })],
    };
    const parsed = parseProjectFile(JSON.stringify(raw));
    expect(parsed.cues).toHaveLength(1);
    expect(parsed.cues[0]).toMatchObject({ startMs: 0, text: 'first' });
  });

  it('clears an endMs that is not greater than startMs', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const raw = {
      ...project,
      cues: [cue({ id: 'a', startMs: 1000, endMs: 1000 }), cue({ id: 'b', startMs: 2000, endMs: 500 })],
    };
    const parsed = parseProjectFile(JSON.stringify(raw));
    expect(parsed.cues.find((c) => c.id === 'a')?.endMs).toBeNull();
    expect(parsed.cues.find((c) => c.id === 'b')?.endMs).toBeNull();
  });

  it('clamps a negative startMs to 0', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const raw = { ...project, cues: [cue({ id: 'a', startMs: -500 })] };
    const parsed = parseProjectFile(JSON.stringify(raw));
    expect(parsed.cues[0].startMs).toBe(0);
  });
});

describe('chordProjectSchema.safeParse', () => {
  it('accepts a color background', () => {
    const project = createEmptyProject(NOW, 'project-1');
    expect(chordProjectSchema.safeParse(project).success).toBe(true);
  });

  it('rejects a video background missing required fields', () => {
    const project = createEmptyProject(NOW, 'project-1');
    const raw = { ...project, background: { kind: 'video', media: project.background } };
    expect(chordProjectSchema.safeParse(raw).success).toBe(false);
  });
});

describe('createEmptyProject', () => {
  it('creates a blank, untitled 1080p30 project with the classic theme and no cues', () => {
    const project = createEmptyProject(NOW, 'id-1');
    expect(project.formatVersion).toBe(1);
    expect(project.title).toBe('Untitled');
    expect(project.composition).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(project.background).toEqual({ kind: 'color', color: '#000000' });
    expect(project.theme.presetId).toBe('classic');
    expect(project.cues).toEqual([]);
    expect(project.createdAt).toBe(NOW);
    expect(project.updatedAt).toBe(NOW);
  });

  it('never shares the preset theme object by reference', () => {
    const a = createEmptyProject(NOW, 'id-1');
    const b = createEmptyProject(NOW, 'id-2');
    a.theme.text.color = '#ABCDEF';
    expect(b.theme.text.color).not.toBe('#ABCDEF');
  });
});

describe('touchProject', () => {
  it('updates only updatedAt', () => {
    const project = createEmptyProject(NOW, 'id-1');
    const touched = touchProject(project, '2026-02-02T00:00:00.000Z');
    expect(touched.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(touched.createdAt).toBe(NOW);
    expect(touched).not.toBe(project);
    expect(touched.cues).toBe(project.cues);
  });
});
