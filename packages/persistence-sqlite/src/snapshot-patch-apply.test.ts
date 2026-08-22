import { describe, expect, it, vi } from 'vitest';
import { createTestRepository } from './test-support';
import type { CastRepository } from './store';
import { invertPatch } from '@lumacast/protocol';

function foreignKeyViolations(target: CastRepository): unknown[] {
  const db = (target as unknown as {
    db: {
      prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] };
    };
  }).db;
  return db.prepare('PRAGMA foreign_key_check').all();
}

function failOnPrepare(target: CastRepository, match: string, occurrence = 1): () => void {
  const db = (target as unknown as { db: { prepare: (sql: string) => unknown } }).db;
  const original = db.prepare.bind(db);
  let seen = 0;
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    if (sql.includes(match)) {
      seen += 1;
      if (seen === occurrence) {
        throw new Error(`forced failure: ${match} #${occurrence}`);
      }
    }
    return original(sql);
  });
  return () => spy.mockRestore();
}

function closeAndCleanup(target: ReturnType<typeof createTestRepository>): void {
  target.close();
  target.cleanup();
}

describe('applyPatch (#239 targeted undo/redo persistence path)', () => {
  it('applies a single-field slide-notes patch without rebuilding the rest of the snapshot', () => {
    const source = createTestRepository({ seed: false });
    const dest = createTestRepository({ seed: false });
    try {
      const itemId = source.repository.createItem({ type: 'presentation', title: 'Deck' }).itemId;
      const slideId = source.repository.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!.id;
      const before = source.repository.getSnapshot();
      const patch = source.repository.updateSlideNotes({ slideId, notes: 'Updated notes' });
      const after = source.repository.getSnapshot();

      dest.repository.restoreFromSnapshot(before);

      expect(() => dest.repository.applyPatch(patch)).not.toThrow();
      expect(dest.repository.getSnapshot()).toEqual(after);
      expect(foreignKeyViolations(dest.repository)).toEqual([]);
    } finally {
      closeAndCleanup(source);
      closeAndCleanup(dest);
    }
  });

  it('keeps foreign keys valid when a cue delete patch also rewrites dependent macro steps', () => {
    const source = createTestRepository({ seed: false });
    const dest = createTestRepository({ seed: false });
    try {
      const cueId = source.repository.createCue({ kind: 'overlay.clearAll', payload: {} }).upserts.cues![0]!.id;
      source.repository.createCue({ kind: 'flow.lifecycle', payload: { action: 'cancel', target: '*' } });
      source.repository.createMacro({
        name: 'Macro',
        description: '',
        cues: [{ cueId, orderIndex: 0, delayBeforeMs: 0, delayAfterMs: 0 }],
      });

      const before = source.repository.getSnapshot();
      const patch = source.repository.deleteCue(cueId);
      const after = source.repository.getSnapshot();

      dest.repository.restoreFromSnapshot(before);

      expect(() => dest.repository.applyPatch(patch)).not.toThrow();
      expect(dest.repository.getSnapshot()).toEqual(after);
      expect(foreignKeyViolations(dest.repository)).toEqual([]);
    } finally {
      closeAndCleanup(source);
      closeAndCleanup(dest);
    }
  });

  it('rolls the transaction back if a later patch write fails', () => {
    const source = createTestRepository({ seed: false });
    const dest = createTestRepository({ seed: false });
    try {
      const before = source.repository.getSnapshot();
      const patch = source.repository.createTheme({
        name: 'Rollback Theme',
        themeType: 'presentation',
        width: 1920,
        height: 1080,
      });

      dest.repository.restoreFromSnapshot(before);
      const restore = failOnPrepare(dest.repository, 'INSERT INTO slide_elements');
      try {
        expect(() => dest.repository.applyPatch(patch)).toThrow(/forced failure/);
      } finally {
        restore();
      }

      expect(dest.repository.getSnapshot()).toEqual(before);
      expect(foreignKeyViolations(dest.repository)).toEqual([]);
    } finally {
      closeAndCleanup(source);
      closeAndCleanup(dest);
    }
  });

  it('preserves sequential undo/redo semantics across several patch mutations', () => {
    const source = createTestRepository({ seed: false });
    const dest = createTestRepository({ seed: false });
    try {
      const itemId = source.repository.createItem({ type: 'presentation', title: 'Deck' }).itemId;
      const slideId = source.repository.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!.id;

      const snapshot0 = source.repository.getSnapshot();
      const patch1 = source.repository.updateSlideNotes({ slideId, notes: 'Step 1' });
      const snapshot1 = source.repository.getSnapshot();
      const patch2 = source.repository.createPlaylist('Sunday');
      const snapshot2 = source.repository.getSnapshot();
      const patch3 = source.repository.createCue({ kind: 'overlay.clearAll', payload: {} });
      const snapshot3 = source.repository.getSnapshot();

      const undo3 = invertPatch(snapshot2, patch3);
      const undo2 = invertPatch(snapshot1, patch2);
      const undo1 = invertPatch(snapshot0, patch1);

      dest.repository.restoreFromSnapshot(snapshot0);

      dest.repository.applyPatch(patch1);
      dest.repository.applyPatch(patch2);
      dest.repository.applyPatch(patch3);
      expect(dest.repository.getSnapshot()).toEqual(snapshot3);

      dest.repository.applyPatch(undo3);
      dest.repository.applyPatch(undo2);
      dest.repository.applyPatch(undo1);
      expect(dest.repository.getSnapshot()).toEqual(snapshot0);

      dest.repository.applyPatch(patch1);
      dest.repository.applyPatch(patch2);
      dest.repository.applyPatch(patch3);
      expect(dest.repository.getSnapshot()).toEqual(snapshot3);
      expect(foreignKeyViolations(dest.repository)).toEqual([]);
    } finally {
      closeAndCleanup(source);
      closeAndCleanup(dest);
    }
  });
});
