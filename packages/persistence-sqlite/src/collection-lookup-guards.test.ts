import { describe, expect, it } from 'vitest';
import { createTestRepository } from './test-support';

// Covers the collections slice of #214's group 1: `renameCollection`
// silently returned an empty patch for an unresolvable collection id, even
// though `createDeckItemWithFirstSlide` already throws `Collection not
// found` for the identical lookup failure against the same deck_collections
// table shape. `renameCollection` already threw for its *other* guard
// (renaming the protected default collection), so the not-found branch was
// its only remaining silent no-op — there is no genuine no-op left to
// preserve for this method.
//
// `deleteCollection` has the identical guard shape and is cataloged
// alongside `renameCollection` in #214, but is deliberately NOT converted
// here: `delete-collection.test.ts` (#112, an existing test file outside
// this change's write boundary) pins "is a no-op for an id that does not
// exist" as the current contract for that exact branch. Converting it would
// require updating that test, which needs its own authorized change.

describe('CastRepository.renameCollection (#214)', () => {
  it('throws for an unresolvable collection id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.renameCollection({ binKind: 'theme', id: 'no-such-collection', name: 'New name' }))
        .toThrow(/Collection not found: no-such-collection/);
    } finally {
      close();
      cleanup();
    }
  });

  it('renames an existing collection without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const created = repo.createCollection({ binKind: 'theme', name: 'Sunday' });
      const collectionId = created.upserts.collections?.[0]?.id;
      if (!collectionId) throw new Error('createCollection returned no collection');

      const patch = repo.renameCollection({ binKind: 'theme', id: collectionId, name: 'Renamed' });
      expect(patch.upserts.collections?.[0]?.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});
