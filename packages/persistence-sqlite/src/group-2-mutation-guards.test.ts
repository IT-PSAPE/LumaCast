import { describe, expect, it } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { CastRepository } from './store';
import { createTestRepository } from './test-support';

// Covers #214's group 2: `updateMacro`, `deleteMediaAsset`,
// `updateMediaAssetSrc`, `updateOverlay`, `updateStage`, and
// `duplicateStage` each silently returned an empty patch when an id failed
// to resolve, making a failed mutation indistinguishable from success for
// the command/undo layers (#121-#126) that call them. None of these
// methods has a genuine no-op branch left after conversion — the old empty
// patch was always a masked lookup failure — so each test pins the throw
// and the successful path, and where the old no-op could be confused with
// "nothing to do", proves failure and no-change are distinguishable rather
// than relying on reading the guard.
//
// None of these entities were touched by the #219 item-model refactor
// (macros/media assets/overlays/stages never had a collection_id-carrying
// concept dissolve underneath them the way items/themes/playlists did), so
// this file's assertions are unchanged in substance from before the
// refactor — only the surrounding fixtures were confirmed against the real
// store.ts exports.

function createMacro(repo: CastRepository, name = 'Macro'): Id {
  const patch = repo.createMacro({ name, description: '', cues: [] });
  const macro = patch.upserts.macros?.[0];
  if (!macro) throw new Error('createMacro returned no macro');
  return macro.id;
}

function createMediaAsset(repo: CastRepository, type: 'image' | 'video' | 'audio' = 'image', name = 'Asset'): Id {
  const patch = repo.createMediaAsset({ name, type, src: 'file:///asset' });
  const asset = patch.upserts.mediaAssets?.[0];
  if (!asset) throw new Error('createMediaAsset returned no asset');
  return asset.id;
}

function createOverlay(repo: CastRepository, name = 'Overlay'): Id {
  const patch = repo.createOverlay({ name });
  const overlay = patch.upserts.overlays?.[0];
  if (!overlay) throw new Error('createOverlay returned no overlay');
  return overlay.id;
}

function createStage(repo: CastRepository, name = 'Stage'): Id {
  const patch = repo.createStage({ name });
  const stage = patch.upserts.stages?.[0];
  if (!stage) throw new Error('createStage returned no stage');
  return stage.id;
}

describe('CastRepository.updateMacro (#214)', () => {
  it('throws for an unresolvable macro id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.updateMacro({ id: 'no-such-macro', name: 'Renamed' }))
        .toThrow(/Macro not found: no-such-macro/);
    } finally {
      close();
      cleanup();
    }
  });

  it('updates an existing macro without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const macroId = createMacro(repo);
      const patch = repo.updateMacro({ id: macroId, name: 'Renamed' });
      expect(patch.upserts.macros?.[0]?.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.deleteMediaAsset (#214)', () => {
  it('throws for an unresolvable asset id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.deleteMediaAsset('no-such-asset'))
        .toThrow(/Media asset not found: no-such-asset/);
    } finally {
      close();
      cleanup();
    }
  });

  it('deletes an existing asset without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const assetId = createMediaAsset(repo);
      const patch = repo.deleteMediaAsset(assetId);
      expect(patch.deletes.mediaAssets).toContain(assetId);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an id that was already deleted, distinguishing failure from no-change', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const assetId = createMediaAsset(repo);
      repo.deleteMediaAsset(assetId);
      // The first delete removed the row; a second delete of the same id is
      // a failed lookup, not a repeatable no-op.
      expect(() => repo.deleteMediaAsset(assetId))
        .toThrow(/Media asset not found: /);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.updateMediaAssetSrc (#214)', () => {
  it('throws for an unresolvable asset id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.updateMediaAssetSrc('no-such-asset', 'file:///replacement'))
        .toThrow(/Media asset not found: no-such-asset/);
    } finally {
      close();
      cleanup();
    }
  });

  it('updates an existing asset without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const assetId = createMediaAsset(repo);
      const patch = repo.updateMediaAssetSrc(assetId, 'file:///replacement');
      expect(patch.upserts.mediaAssets?.[0]?.src).toBe('file:///replacement');
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for a missing id while leaving an existing asset untouched', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const assetId = createMediaAsset(repo);
      expect(() => repo.updateMediaAssetSrc('no-such-asset', 'file:///replacement'))
        .toThrow(/Media asset not found: no-such-asset/);
      const patch = repo.updateMediaAssetSrc(assetId, 'file:///same');
      expect(patch.upserts.mediaAssets?.[0]?.src).toBe('file:///same');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.updateOverlay (#214)', () => {
  it('throws for an unresolvable overlay id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.updateOverlay({ id: 'no-such-overlay', name: 'Renamed' }))
        .toThrow(/Overlay not found: no-such-overlay/);
    } finally {
      close();
      cleanup();
    }
  });

  it('updates an existing overlay without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const overlayId = createOverlay(repo);
      const patch = repo.updateOverlay({ id: overlayId, name: 'Renamed' });
      expect(patch.upserts.overlays?.[0]?.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.updateStage (#214)', () => {
  it('throws for an unresolvable stage id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.updateStage({ id: 'no-such-stage', name: 'Renamed' }))
        .toThrow(/Stage not found: no-such-stage/);
    } finally {
      close();
      cleanup();
    }
  });

  it('updates an existing stage without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const stageId = createStage(repo);
      const patch = repo.updateStage({ id: stageId, name: 'Renamed' });
      expect(patch.upserts.stages?.[0]?.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.duplicateStage (#214)', () => {
  it('throws for an unresolvable stage id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.duplicateStage('no-such-stage'))
        .toThrow(/Stage not found: no-such-stage/);
    } finally {
      close();
      cleanup();
    }
  });

  it('duplicates an existing stage without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const stageId = createStage(repo, 'Sunday');
      const patch = repo.duplicateStage(stageId);
      const duplicate = patch.upserts.stages?.find((stage) => stage.id !== stageId);
      expect(duplicate?.name).toBe('Sunday copy');
    } finally {
      close();
      cleanup();
    }
  });
});
