import { describe, expect, it } from 'vitest';
import { applyPatch, createEmptyPatch, invertPatch, type SnapshotPatch } from '../../../../packages/protocol/src/snapshot-patch';
import type { AppSnapshot } from '../../../../packages/protocol/src/rpc-results';
import type { Timer } from '@lumacast/composition';

function emptySnapshot(): AppSnapshot {
  return {
    presentations: [],
    lyrics: [],
    slides: [],
    slideElements: [],
    mediaAssets: [],
    overlays: [],
    presentationThemes: [],
    lyricThemes: [],
    overlayThemes: [],
    stages: [],
    playlists: [],
    playlistEntries: [],
    cues: [],
    macros: [],
    triggerBindings: [],
    playbackSchedules: [],
    slideTags: [],
    timers: [],
  };
}

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 'timer-1',
    name: 'Timer 1',
    kind: 'countdown',
    durationSeconds: 300,
    targetTime: null,
    elapsedStartSeconds: 0,
    elapsedEndSeconds: null,
    allowOverrun: false,
    format: 'mm:ss',
    thresholds: [],
    order: 0,
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  };
}

describe('snapshot patch — timers (ADR-0042)', () => {
  it('applies a timers upsert, and inverting it removes the timer again', () => {
    const before = emptySnapshot();
    const timer = makeTimer();
    const patch: SnapshotPatch = { version: 1, upserts: { timers: [timer] }, deletes: {} };

    const after = applyPatch(before, patch);
    expect(after.timers).toEqual([timer]);
    // Every other table is untouched.
    expect(after.slideTags).toEqual(before.slideTags);

    const inverse = invertPatch(before, patch);
    expect(inverse.deletes.timers).toEqual([timer.id]);
    expect(applyPatch(after, inverse)).toEqual(before);
  });

  it('applies a timers delete, and inverting it restores the deleted row', () => {
    const timer = makeTimer();
    const before: AppSnapshot = { ...emptySnapshot(), timers: [timer] };
    const patch: SnapshotPatch = { version: 1, upserts: {}, deletes: { timers: [timer.id] } };

    const after = applyPatch(before, patch);
    expect(after.timers).toEqual([]);

    const inverse = invertPatch(before, patch);
    expect(inverse.upserts.timers).toEqual([timer]);
    expect(applyPatch(after, inverse)).toEqual(before);
  });

  it('inverts an update (an upsert over an existing row) back to the prior values', () => {
    const original = makeTimer({ name: 'Original', durationSeconds: 300 });
    const before: AppSnapshot = { ...emptySnapshot(), timers: [original] };
    const updated = { ...original, name: 'Updated', durationSeconds: 60, updatedAt: 'later' };
    const patch: SnapshotPatch = { version: 1, upserts: { timers: [updated] }, deletes: {} };

    const after = applyPatch(before, patch);
    expect(after.timers).toEqual([updated]);

    const inverse = invertPatch(before, patch);
    expect(inverse.upserts.timers).toEqual([original]);
    expect(applyPatch(after, inverse)).toEqual(before);
  });

  it('leaves timers alone when the patch never mentions them', () => {
    const timer = makeTimer();
    const before: AppSnapshot = { ...emptySnapshot(), timers: [timer] };
    const patch: SnapshotPatch = { version: 1, upserts: { slideTags: [] }, deletes: {} };

    expect(applyPatch(before, patch).timers).toEqual([timer]);
    expect(invertPatch(before, patch).upserts.timers).toBeUndefined();
    expect(invertPatch(before, patch).deletes.timers).toBeUndefined();
  });

  it('creates a version-stamped, empty patch', () => {
    expect(createEmptyPatch(5)).toEqual({ version: 5, upserts: {}, deletes: {} });
  });
});
