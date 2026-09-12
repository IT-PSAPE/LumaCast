import { describe, expect, it } from 'vitest';
import {
  PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION,
  validateProjectBackup,
} from '@lumacast/protocol';
import type { ProjectBackup } from '@lumacast/protocol';
import type { PlaybackSchedule } from '@lumacast/automation';
import { createTestRepository } from '../../../../packages/persistence-sqlite/src/test-support';
import type { CastRepository } from '../../../../packages/persistence-sqlite/src/store';
import type { SqliteDatabase } from '../../../../packages/persistence-sqlite/src/sqlite';

function rawDb(target: CastRepository): SqliteDatabase {
  return (target as unknown as { db: SqliteDatabase }).db;
}

function closeAndCleanup(target: ReturnType<typeof createTestRepository>): void {
  target.close();
  target.cleanup();
}

function seedPresentation(repo: CastRepository, title = 'Deck'): { itemId: string; slideIds: string[] } {
  const itemId = repo.createItem({ type: 'presentation', title }).itemId;
  repo.createSlide({ presentationId: itemId });
  const slideIds = repo
    .getSnapshot()
    .slides.filter((slide) => slide.presentationId === itemId)
    .map((slide) => slide.id)
    .sort();
  return { itemId, slideIds };
}

function seedAudioAsset(repo: CastRepository, name = 'Sting'): string {
  const patch = repo.createMediaAsset({ name, type: 'audio', src: `cast-media://${name}` });
  return patch.upserts.mediaAssets![0]!.id;
}

function timingSchedule(itemId: string, slideIds: string[], enabled = true): Extract<PlaybackSchedule, { kind: 'slide-timing' }> {
  return {
    id: `timing:presentation:${itemId}`,
    itemRef: { type: 'presentation', id: itemId },
    enabled,
    kind: 'slide-timing',
    steps: slideIds.map((slideId, index) => ({ slideId, durationMs: (index + 1) * 1000 })),
  };
}

function audioSchedule(assetId: string, itemId: string, slideIds: string[], enabled = true): Extract<PlaybackSchedule, { kind: 'audio-sync' }> {
  return {
    id: `audio:${assetId}`,
    itemRef: { type: 'presentation', id: itemId },
    enabled,
    kind: 'audio-sync',
    audioAssetId: assetId,
    markers: slideIds.map((slideId, index) => ({ id: `m-${index}`, timeMs: index * 1000, slideId })),
  };
}

describe('playback-schedule persistence', () => {
  it('saves, lists, and deletes slide-timing and audio-sync schedules with snapshot patches', () => {
    const target = createTestRepository({ seed: false });
    try {
      const { itemId, slideIds } = seedPresentation(target.repository);
      const assetId = seedAudioAsset(target.repository);

      const timingPatch = target.repository.savePlaybackSchedule(timingSchedule(itemId, slideIds));
      expect(timingPatch.upserts.playbackSchedules).toHaveLength(1);
      expect(timingPatch.upserts.playbackSchedules![0]).toMatchObject({ id: `timing:presentation:${itemId}`, enabled: true });

      target.repository.savePlaybackSchedule(audioSchedule(assetId, itemId, slideIds));
      expect(target.repository.listPlaybackSchedules()).toHaveLength(2);
      expect(target.repository.getSnapshot().playbackSchedules).toHaveLength(2);

      const deletePatch = target.repository.deletePlaybackSchedule(`timing:presentation:${itemId}`);
      expect(deletePatch.deletes.playbackSchedules).toEqual([`timing:presentation:${itemId}`]);
      expect(target.repository.listPlaybackSchedules().map((schedule) => schedule.id)).toEqual([`audio:${assetId}`]);

      // Idempotent: deleting again still evicts the id without failing.
      expect(() => target.repository.deletePlaybackSchedule(`timing:presentation:${itemId}`)).not.toThrow();
    } finally {
      closeAndCleanup(target);
    }
  });

  it('round-trips schedules through snapshot restore, including stale references', () => {
    const source = createTestRepository({ seed: false });
    const dest = createTestRepository({ seed: false });
    try {
      const { itemId, slideIds } = seedPresentation(source.repository);
      const assetId = seedAudioAsset(source.repository);
      source.repository.savePlaybackSchedule(timingSchedule(itemId, slideIds));
      source.repository.savePlaybackSchedule(audioSchedule(assetId, itemId, slideIds));
      const before = source.repository.getSnapshot();

      // Delete a referenced slide after saving: the restore path must still
      // accept the snapshot verbatim (stale records permitted on undo/read).
      source.repository.deleteSlide(slideIds[0]!);
      dest.repository.restoreFromSnapshot(before);

      expect(dest.repository.getSnapshot().playbackSchedules).toHaveLength(2);

      // A stale schedule also applies as a targeted patch without failing.
      const staleSchedule: PlaybackSchedule = {
        id: 'timing:presentation:stale',
        itemRef: { type: 'presentation', id: itemId },
        enabled: false,
        kind: 'slide-timing',
        steps: [{ slideId: 'ghost-slide', durationMs: 1000 }],
      };
      expect(() => dest.repository.applyPatch({ version: 1, upserts: { playbackSchedules: [staleSchedule] }, deletes: {} })).not.toThrow();
      expect(dest.repository.listPlaybackSchedules().some((schedule) => schedule.id === 'timing:presentation:stale')).toBe(true);
    } finally {
      closeAndCleanup(source);
      closeAndCleanup(dest);
    }
  });

  it('enforces stable schedule ids', () => {
    const target = createTestRepository({ seed: false });
    try {
      const { itemId, slideIds } = seedPresentation(target.repository);
      const assetId = seedAudioAsset(target.repository);

      expect(() => target.repository.savePlaybackSchedule({
        ...timingSchedule(itemId, slideIds),
        id: 'random-id',
      })).toThrow(/must be timing:presentation:/);

      expect(() => target.repository.savePlaybackSchedule({
        ...audioSchedule(assetId, itemId, slideIds),
        id: 'random-id',
      })).toThrow(/must be audio:/);
    } finally {
      closeAndCleanup(target);
    }
  });

  it('requires bindings for enabled schedules but permits null bindings on disabled drafts', () => {
    const target = createTestRepository({ seed: false });
    try {
      const { itemId, slideIds } = seedPresentation(target.repository);
      const assetId = seedAudioAsset(target.repository);

      // Enabled timing with no item or no steps fails.
      expect(() => target.repository.savePlaybackSchedule({
        id: 'timing:draft', itemRef: null, enabled: true, kind: 'slide-timing', steps: [],
      })).toThrow(/must be bound to an item/);
      expect(() => target.repository.savePlaybackSchedule({
        ...timingSchedule(itemId, []),
      })).toThrow(/at least one step/);

      // Disabled timing draft with null bindings saves.
      expect(() => target.repository.savePlaybackSchedule({
        id: 'timing:draft', itemRef: null, enabled: false, kind: 'slide-timing', steps: [],
      })).not.toThrow();

      // Enabled audio with no item, no markers, or an unassigned marker fails.
      expect(() => target.repository.savePlaybackSchedule({
        id: `audio:${assetId}`, itemRef: null, enabled: true, kind: 'audio-sync', audioAssetId: assetId, markers: [{ id: 'm-0', timeMs: 0, slideId: slideIds[0]! }],
      })).toThrow(/must be bound to an item/);
      expect(() => target.repository.savePlaybackSchedule(audioSchedule(assetId, itemId, []))).toThrow(/at least one marker/);
      expect(() => target.repository.savePlaybackSchedule({
        ...audioSchedule(assetId, itemId, slideIds),
        markers: [{ id: 'm-0', timeMs: 0, slideId: null }],
      })).toThrow(/assign every marker/);

      // Disabled audio draft with null bindings saves.
      expect(() => target.repository.savePlaybackSchedule({
        id: `audio:${assetId}`, itemRef: null, enabled: false, kind: 'audio-sync', audioAssetId: assetId, markers: [{ id: 'm-0', timeMs: 0, slideId: null }],
      })).not.toThrow();
    } finally {
      closeAndCleanup(target);
    }
  });

  it('rejects saves against missing items, foreign slides, and non-audio assets', () => {
    const target = createTestRepository({ seed: false });
    try {
      const { itemId, slideIds } = seedPresentation(target.repository);
      const other = seedPresentation(target.repository, 'Other');
      const imagePatch = target.repository.createMediaAsset({ name: 'Logo', type: 'image', src: 'cast-media://logo' });
      const imageId = imagePatch.upserts.mediaAssets![0]!.id;

      expect(() => target.repository.savePlaybackSchedule(timingSchedule('ghost-item', slideIds))).toThrow(/missing item/);
      expect(() => target.repository.savePlaybackSchedule({
        ...timingSchedule(itemId, slideIds),
        steps: [{ slideId: other.slideIds[0]!, durationMs: 1000 }],
      })).toThrow(/does not belong to/);
      expect(() => target.repository.savePlaybackSchedule({
        ...timingSchedule(itemId, slideIds),
        steps: [{ slideId: 'ghost-slide', durationMs: 1000 }],
      })).toThrow(/missing slide/);

      expect(() => target.repository.savePlaybackSchedule(audioSchedule('ghost-asset', itemId, slideIds))).toThrow(/missing audio asset/);
      expect(() => target.repository.savePlaybackSchedule(audioSchedule(imageId, itemId, slideIds))).toThrow(/not an audio asset/);
    } finally {
      closeAndCleanup(target);
    }
  });

  it('disables a conflicting enabled schedule saved outside the stable id', () => {
    const target = createTestRepository({ seed: false });
    try {
      const { itemId, slideIds } = seedPresentation(target.repository);
      // A legacy row with a non-stable id, inserted before id enforcement.
      rawDb(target.repository).prepare(
        `INSERT INTO playback_schedules (id, item_ref_json, enabled, kind, steps_json, audio_asset_id, markers_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'legacy-row',
        JSON.stringify({ type: 'presentation', id: itemId }),
        1,
        'slide-timing',
        JSON.stringify(slideIds.map((slideId) => ({ slideId, durationMs: 1000 }))),
        null,
        null,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );

      const patch = target.repository.savePlaybackSchedule(timingSchedule(itemId, slideIds));
      const upserted = patch.upserts.playbackSchedules ?? [];
      expect(upserted.map((schedule) => schedule.id).sort()).toEqual([`timing:presentation:${itemId}`, 'legacy-row'].sort());
      expect(upserted.find((schedule) => schedule.id === 'legacy-row')!.enabled).toBe(false);
      expect(target.repository.listPlaybackSchedules().filter((schedule) => schedule.enabled)).toHaveLength(1);
    } finally {
      closeAndCleanup(target);
    }
  });

  it('preserves schedules in full project backups and restores them', () => {
    const target = createTestRepository({ seed: false });
    try {
      const { itemId, slideIds } = seedPresentation(target.repository);
      const assetId = seedAudioAsset(target.repository);
      target.repository.savePlaybackSchedule(timingSchedule(itemId, slideIds));
      target.repository.savePlaybackSchedule({ ...audioSchedule(assetId, itemId, slideIds), enabled: false });

      const backup = target.repository.exportProjectBackup();
      expect(backup.tables.playback_schedules).toHaveLength(2);
      expect(validateProjectBackup(backup)).toBe(backup);

      const restored = target.repository.restoreProjectBackup(backup);
      expect(restored.snapshot.playbackSchedules).toHaveLength(2);
      expect(target.repository.listPlaybackSchedules()).toHaveLength(2);
    } finally {
      closeAndCleanup(target);
    }
  });

  it('imports pre-slide-tag schema-33 backups without changing their schedule list', () => {
    const target = createTestRepository({ seed: false });
    try {
      seedPresentation(target.repository);
      const backup = target.repository.exportProjectBackup();
      expect(backup.schemaVersion).toBe(PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION);

      const legacyTables = JSON.parse(JSON.stringify(backup.tables)) as Record<string, unknown>;
      delete legacyTables.slide_tags;
      legacyTables.slides = (legacyTables.slides as Array<Record<string, unknown>>)
        .map(({ tag_id: _tagId, ...slide }) => slide);
      const legacy = {
        ...backup,
        schemaVersion: PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION - 1,
        tables: legacyTables,
      } as unknown as ProjectBackup;
      const normalized = validateProjectBackup(legacy);
      expect(normalized.schemaVersion).toBe(PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION);
      expect(normalized.tables.playback_schedules).toEqual(backup.tables.playback_schedules);

      const restored = target.repository.restoreProjectBackup(legacy);
      expect(restored.snapshot.playbackSchedules).toEqual([]);
    } finally {
      closeAndCleanup(target);
    }
  });
});
