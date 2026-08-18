import { describe, expect, it, vi } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { CollectionBinKind } from '@lumacast/composition';
import { createTestRepository } from './test-support';
import { CollectionDeletionError } from './store';
import type { CastRepository } from './store';
import type { SqliteDatabase } from './sqlite';

// The eight collection kinds this operation must handle exhaustively (#112).
// Kept as a literal list (rather than importing the private COLLECTION_BIN_KINDS
// constant from store.ts) so this test independently pins the contract from
// @core/types and fails loudly if either side drifts.
const ALL_BIN_KINDS: CollectionBinKind[] = ['deck', 'image', 'video', 'audio', 'theme', 'overlay', 'stage', 'macro'];

function rawDb(repository: CastRepository): SqliteDatabase {
  return (repository as unknown as { db: SqliteDatabase }).db;
}

function foreignKeyViolations(repository: CastRepository): unknown {
  return rawDb(repository).pragma('foreign_key_check');
}

function defaultCollectionId(repository: CastRepository, binKind: CollectionBinKind): Id {
  const collection = repository.getSnapshot().collections.find((c) => c.binKind === binKind && c.isDefault);
  if (!collection) throw new Error(`no default collection seeded for bin: ${binKind}`);
  return collection.id;
}

function newCollectionId(repository: CastRepository, binKind: CollectionBinKind, name: string): Id {
  const patch = repository.createCollection({ binKind, name });
  const collection = patch.upserts.collections?.find((c) => c.name === name && c.binKind === binKind);
  if (!collection) throw new Error(`createCollection did not return a collection named ${name}`);
  return collection.id;
}

describe('deleteCollection — exhaustiveness across every bin kind (#112)', () => {
  it.each(ALL_BIN_KINDS)('reassigns members and passes foreign-key checks for bin kind %s', (binKind) => {
    const { repository, close, cleanup } = createTestRepository();
    try {
      const defaultId = defaultCollectionId(repository, binKind);
      const targetId = newCollectionId(repository, binKind, `Custom ${binKind}`);

      let memberId: Id;
      switch (binKind) {
        case 'deck': {
          const patch = repository.createPresentation('Slides');
          memberId = patch.upserts.presentations![0].id;
          repository.setItemCollection({ itemType: 'presentation', itemId: memberId, collectionId: targetId });
          break;
        }
        case 'image':
        case 'video':
        case 'audio': {
          const patch = repository.createMediaAsset({ name: 'Asset', type: binKind, src: 'file:///asset', collectionId: targetId });
          memberId = patch.upserts.mediaAssets![0].id;
          break;
        }
        case 'theme': {
          const patch = repository.createTheme({ name: 'Theme', kind: 'slides', collectionId: targetId });
          memberId = patch.upserts.themes![0].id;
          break;
        }
        case 'overlay': {
          const patch = repository.createOverlay({ name: 'Overlay', collectionId: targetId });
          memberId = patch.upserts.overlays![0].id;
          break;
        }
        case 'stage': {
          const patch = repository.createStage({ name: 'Stage', collectionId: targetId });
          memberId = patch.upserts.stages![0].id;
          break;
        }
        case 'macro': {
          const patch = repository.createMacro({ name: 'Macro', collectionId: targetId });
          memberId = patch.upserts.macros![0].id;
          break;
        }
      }

      const deletePatch = repository.deleteCollection({ binKind, id: targetId });
      expect(deletePatch.deletes.collections).toEqual([targetId]);

      const snapshot = repository.getSnapshot();
      expect(snapshot.collections.some((c) => c.id === targetId)).toBe(false);

      const memberCollectionId = (() => {
        switch (binKind) {
          case 'deck': return snapshot.presentations.find((p) => p.id === memberId)?.collectionId;
          case 'image':
          case 'video':
          case 'audio': return snapshot.mediaAssets.find((m) => m.id === memberId)?.collectionId;
          case 'theme': return snapshot.themes.find((t) => t.id === memberId)?.collectionId;
          case 'overlay': return snapshot.overlays.find((o) => o.id === memberId)?.collectionId;
          case 'stage': return snapshot.stages.find((s) => s.id === memberId)?.collectionId;
          case 'macro': return snapshot.macros.find((m) => m.id === memberId)?.collectionId;
        }
      })();
      expect(memberCollectionId).toBe(defaultId);

      // The concrete #112 regression: before this fix, deleting a non-empty
      // macro collection left `actions.collection_id` pointing at the row
      // about to be deleted, and the DELETE below violated its FK.
      expect(foreignKeyViolations(repository)).toBeUndefined();
    } finally {
      close();
      cleanup();
    }
  });
});

describe('deleteCollection — protected/default collections', () => {
  it('refuses to delete a default collection with a typed protected-default error, writing nothing', () => {
    const { repository, close, cleanup } = createTestRepository();
    try {
      const defaultId = defaultCollectionId(repository, 'deck');
      const before = repository.getSnapshot().collections;

      let caught: unknown;
      try {
        repository.deleteCollection({ binKind: 'deck', id: defaultId });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CollectionDeletionError);
      expect((caught as CollectionDeletionError).code).toBe('protected-default');
      expect((caught as CollectionDeletionError).binKind).toBe('deck');
      expect((caught as CollectionDeletionError).collectionId).toBe(defaultId);

      expect(repository.getSnapshot().collections).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a no-op for an id that does not exist', () => {
    const { repository, close, cleanup } = createTestRepository();
    try {
      const before = repository.getSnapshot().collections;
      const patch = repository.deleteCollection({ binKind: 'stage', id: 'not-a-real-id' });
      expect(patch.deletes.collections ?? []).toEqual([]);
      expect(repository.getSnapshot().collections).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('aborts before any write when the bin has no default collection to fall back to', () => {
    const { repository, close, cleanup } = createTestRepository();
    try {
      const missingDefaultId = defaultCollectionId(repository, 'stage');
      // Simulate data corruption: the only default stage collection is gone.
      rawDb(repository).prepare('DELETE FROM stage_collections WHERE id = ?').run(missingDefaultId);

      const targetId = newCollectionId(repository, 'stage', 'Orphaned Stage Bin');
      const stagePatch = repository.createStage({ name: 'Stray Stage', collectionId: targetId });
      const stageId = stagePatch.upserts.stages![0].id;

      let caught: unknown;
      try {
        repository.deleteCollection({ binKind: 'stage', id: targetId });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CollectionDeletionError);
      expect((caught as CollectionDeletionError).code).toBe('default-collection-missing');

      // Nothing moved and nothing was deleted — the check ran before any write.
      const snapshot = repository.getSnapshot();
      expect(snapshot.collections.some((c) => c.id === targetId)).toBe(true);
      expect(snapshot.stages.find((s) => s.id === stageId)?.collectionId).toBe(targetId);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('deleteCollection — atomicity and ordering', () => {
  it('rolls back reassignment and deletion together when a later step in the transaction fails', () => {
    const { repository, close, cleanup } = createTestRepository();
    try {
      const targetId = newCollectionId(repository, 'overlay', 'Rollback Bin');
      const overlayPatch = repository.createOverlay({ name: 'Overlay', collectionId: targetId });
      const overlayId = overlayPatch.upserts.overlays![0].id;

      const repoInternal = repository as unknown as {
        compactCollectionOrdering: (binKind: CollectionBinKind) => Id[];
      };
      const spy = vi.spyOn(repoInternal, 'compactCollectionOrdering').mockImplementation(() => {
        throw new Error('injected write failure');
      });

      try {
        expect(() => repository.deleteCollection({ binKind: 'overlay', id: targetId })).toThrow('injected write failure');
      } finally {
        spy.mockRestore();
      }

      // The whole transaction (reassignment + delete) rolled back: the
      // collection is still there and the overlay never moved.
      const snapshot = repository.getSnapshot();
      expect(snapshot.collections.some((c) => c.id === targetId)).toBe(true);
      expect(snapshot.overlays.find((o) => o.id === overlayId)?.collectionId).toBe(targetId);
      expect(foreignKeyViolations(repository)).toBeUndefined();
    } finally {
      close();
      cleanup();
    }
  });

  it('compacts collection ordering to a contiguous range, preserving relative order of survivors', () => {
    const { repository, close, cleanup } = createTestRepository();
    try {
      const first = newCollectionId(repository, 'video', 'First');
      const second = newCollectionId(repository, 'video', 'Second');
      const third = newCollectionId(repository, 'video', 'Third');
      const fourth = newCollectionId(repository, 'video', 'Fourth');

      const before = repository.getSnapshot().collections.filter((c) => c.binKind === 'video');
      const orderOf = (id: Id) => before.find((c) => c.id === id)!.order;
      expect(orderOf(first)).toBeLessThan(orderOf(second));
      expect(orderOf(second)).toBeLessThan(orderOf(third));
      expect(orderOf(third)).toBeLessThan(orderOf(fourth));

      const deletePatch = repository.deleteCollection({ binKind: 'video', id: second });

      const after = repository.getSnapshot().collections.filter((c) => c.binKind === 'video');
      const survivorIds = [first, third, fourth];
      const orders = survivorIds.map((id) => after.find((c) => c.id === id)!.order);

      // Contiguous, strictly increasing, and starting no lower than before.
      expect(orders[0]).toBeLessThan(orders[1]);
      expect(orders[1]).toBeLessThan(orders[2]);
      expect(orders[2] - orders[0]).toBe(2);

      // The patch reports exactly which surviving collections had their order
      // change (third and fourth shifted down; first and the default did not).
      const reportedIds = new Set(deletePatch.upserts.collections?.map((c) => c.id) ?? []);
      expect(reportedIds.has(third)).toBe(true);
      expect(reportedIds.has(fourth)).toBe(true);
      expect(reportedIds.has(first)).toBe(false);
    } finally {
      close();
      cleanup();
    }
  });

  it('preserves member identity and relative order when reassigning to the default collection', () => {
    const { repository, close, cleanup } = createTestRepository();
    try {
      const targetId = newCollectionId(repository, 'audio', 'Custom Audio Bin');
      const a = repository.createMediaAsset({ name: 'A', type: 'audio', src: 'file:///a', collectionId: targetId }).upserts.mediaAssets![0];
      const b = repository.createMediaAsset({ name: 'B', type: 'audio', src: 'file:///b', collectionId: targetId }).upserts.mediaAssets![0];
      const c = repository.createMediaAsset({ name: 'C', type: 'audio', src: 'file:///c', collectionId: targetId }).upserts.mediaAssets![0];
      const originalOrders = { a: a.order, b: b.order, c: c.order };

      repository.deleteCollection({ binKind: 'audio', id: targetId });

      const defaultId = defaultCollectionId(repository, 'audio');
      const snapshot = repository.getSnapshot();
      const after = {
        a: snapshot.mediaAssets.find((m) => m.id === a.id)!,
        b: snapshot.mediaAssets.find((m) => m.id === b.id)!,
        c: snapshot.mediaAssets.find((m) => m.id === c.id)!,
      };

      // Identity and relative order (their own `order` fields) survive the
      // move untouched — only ownership (`collectionId`) changed.
      expect(after.a.collectionId).toBe(defaultId);
      expect(after.b.collectionId).toBe(defaultId);
      expect(after.c.collectionId).toBe(defaultId);
      expect(after.a.order).toBe(originalOrders.a);
      expect(after.b.order).toBe(originalOrders.b);
      expect(after.c.order).toBe(originalOrders.c);
      expect([after.a.order, after.b.order, after.c.order]).toEqual(
        [...[after.a.order, after.b.order, after.c.order]].sort((x, y) => x - y),
      );
    } finally {
      close();
      cleanup();
    }
  });
});
