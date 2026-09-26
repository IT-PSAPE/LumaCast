import { describe, expect, it } from 'vitest';
import { timelineEndMs } from '../../../../../../apps/chord/renderer/features/playback/timeline-end';
import { createTestProject } from '../../test-store';
import type { ChordCue } from '../../../../../../apps/chord/shared/project';

function cue(id: string, startMs: number, endMs: number | null): ChordCue {
  return { id, startMs, endMs, text: id, override: null };
}

describe('timelineEndMs', () => {
  it('uses the audio duration when audio is loaded', () => {
    const project = createTestProject({
      audio: { path: '/song.mp3', name: 'song.mp3', durationMs: 15_000 },
    });
    expect(timelineEndMs(project)).toBe(15_000);
  });

  it('clamps a short audio duration up to the minimum', () => {
    const project = createTestProject({
      audio: { path: '/song.mp3', name: 'song.mp3', durationMs: 5_000 },
    });
    expect(timelineEndMs(project)).toBe(10_000);
  });

  it('falls back to the last cue when there is no audio duration yet', () => {
    const project = createTestProject({
      audio: { path: '/song.mp3', name: 'song.mp3', durationMs: null },
      cues: [cue('a', 0, 2000), cue('b', 20_000, null)],
    });
    // `b` has no explicit end: it holds for an implicit 4s.
    expect(timelineEndMs(project)).toBe(24_000);
  });

  it('uses the last cue\'s explicit end when it has one', () => {
    const project = createTestProject({
      cues: [cue('a', 0, 2000), cue('b', 20_000, 25_000)],
    });
    expect(timelineEndMs(project)).toBe(25_000);
  });

  it('clamps a last cue that ends early up to the minimum', () => {
    const project = createTestProject({ cues: [cue('a', 0, 1000)] });
    expect(timelineEndMs(project)).toBe(10_000);
  });

  it('returns the minimum for an empty, audio-less project', () => {
    const project = createTestProject({ cues: [] });
    expect(timelineEndMs(project)).toBe(10_000);
  });
});
