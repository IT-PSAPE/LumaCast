import { describe, expect, it } from 'vitest';
import { createTestRepository } from './test-support';

// Covers the cue slice of #214's group 1: `updateCue` silently returned an
// empty patch for an unresolvable cue id, even though the private `getCue`
// helper in this same file already throws `Cue not found` for the identical
// lookup failure (used by createMacro/updateMacro when resolving a macro's
// cue references). `updateCue`'s not-found branch was its only early
// return, so there is no genuine no-op to preserve here.

describe('CastRepository.updateCue (#214)', () => {
  it('throws for an unresolvable cue id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.updateCue({ id: 'no-such-cue', failurePolicy: 'abort' }))
        .toThrow(/Cue not found: no-such-cue/);
    } finally {
      close();
      cleanup();
    }
  });

  it('updates an existing cue without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const created = repo.createCue({ kind: 'overlay.clearAll', payload: {} });
      const cueId = created.upserts.cues?.[0]?.id;
      if (!cueId) throw new Error('createCue returned no cue');

      const patch = repo.updateCue({ id: cueId, failurePolicy: 'abort' });
      expect(patch.upserts.cues?.[0]?.failurePolicy).toBe('abort');
    } finally {
      close();
      cleanup();
    }
  });
});
