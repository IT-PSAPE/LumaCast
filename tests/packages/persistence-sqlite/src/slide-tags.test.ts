import { describe, expect, it } from 'vitest';
import { createTestRepository } from '../../../../packages/persistence-sqlite/src/test-support';
import { invertPatch } from '@lumacast/protocol';

describe('slide-tag persistence', () => {
  it('creates, updates, reorders, assigns, and deletes reusable tags through snapshot patches', () => {
    const target = createTestRepository({ seed: false });
    try {
      const itemId = target.repository.createItem({ type: 'presentation', title: 'Deck' }).itemId;
      target.repository.createSlide({ presentationId: itemId });
      const slideIds = target.repository.getSnapshot().slides
        .filter((slide) => slide.presentationId === itemId)
        .map((slide) => slide.id);

      const redPatch = target.repository.createSlideTag({ name: 'Verse', colorKey: 'red' });
      const redTag = redPatch.upserts.slideTags![0]!;
      const blueTag = target.repository.createSlideTag({ name: 'Chorus', colorKey: 'blue' }).upserts.slideTags![0]!;
      expect(target.repository.getSnapshot().slideTags).toEqual([redTag, blueTag]);

      const assignment = target.repository.assignSlideTags({ slideIds, tagId: redTag.id });
      expect(assignment.upserts.slides?.map((slide) => slide.tagId)).toEqual(slideIds.map(() => redTag.id));

      const update = target.repository.updateSlideTag({ id: blueTag.id, name: 'Bridge', colorKey: 'teal', order: 0 });
      expect(update.upserts.slideTags?.find((tag) => tag.id === blueTag.id)).toMatchObject({ name: 'Bridge', colorKey: 'teal', order: 0 });
      expect(target.repository.listSlideTags().map((tag) => tag.id)).toEqual([blueTag.id, redTag.id]);

      const deletion = target.repository.deleteSlideTag(redTag.id);
      expect(deletion.deletes.slideTags).toEqual([redTag.id]);
      expect(deletion.upserts.slides?.every((slide) => slide.tagId === null)).toBe(true);
      expect(target.repository.getSnapshot().slides.filter((slide) => slideIds.includes(slide.id)).every((slide) => slide.tagId === null)).toBe(true);
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('copies assignments when duplicating slides and items, and round-trips them through snapshot restore', () => {
    const source = createTestRepository({ seed: false });
    const destination = createTestRepository({ seed: false });
    try {
      const item = source.repository.createItem({ type: 'lyric', title: 'Song' });
      const slideId = item.patch.upserts.slides![0]!.id;
      const tagId = source.repository.createSlideTag({ name: 'Chorus', colorKey: 'indigo' }).upserts.slideTags![0]!.id;
      source.repository.assignSlideTags({ slideIds: [slideId], tagId });

      const duplicatedSlide = source.repository.duplicateSlide(slideId).upserts.slides!.find((slide) => slide.id !== slideId)!;
      expect(duplicatedSlide.tagId).toBe(tagId);

      const duplicateItem = source.repository.duplicateItem({ type: 'lyric', id: item.itemId });
      expect(duplicateItem.patch.upserts.slides?.every((slide) => slide.tagId === tagId)).toBe(true);

      const snapshot = source.repository.getSnapshot();
      destination.repository.restoreFromSnapshot(snapshot);
      expect(destination.repository.getSnapshot()).toEqual(snapshot);
    } finally {
      source.close();
      source.cleanup();
      destination.close();
      destination.cleanup();
    }
  });

  it('rejects missing tags, missing slides, container slides, and missing updates', () => {
    const target = createTestRepository({ seed: false });
    try {
      const item = target.repository.createItem({ type: 'presentation', title: 'Deck' });
      const slideId = item.patch.upserts.slides![0]!.id;
      expect(() => target.repository.assignSlideTags({ slideIds: [slideId], tagId: 'missing' })).toThrow(/Slide tag not found/);
      expect(() => target.repository.assignSlideTags({ slideIds: ['missing'], tagId: null })).toThrow(/Slide not found/);
      expect(() => target.repository.updateSlideTag({ id: 'missing', name: 'Nope' })).toThrow(/Slide tag not found/);
      expect(() => target.repository.deleteSlideTag('missing')).toThrow(/Slide tag not found/);
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('applies and inverts a delete patch in foreign-key-safe order', () => {
    const source = createTestRepository({ seed: false });
    const destination = createTestRepository({ seed: false });
    try {
      const item = source.repository.createItem({ type: 'presentation', title: 'Deck' });
      const slideId = item.patch.upserts.slides![0]!.id;
      const tagId = source.repository.createSlideTag({ name: 'Verse', colorKey: 'red' }).upserts.slideTags![0]!.id;
      source.repository.assignSlideTags({ slideIds: [slideId], tagId });
      const before = source.repository.getSnapshot();
      const deletion = source.repository.deleteSlideTag(tagId);
      const after = source.repository.getSnapshot();

      destination.repository.restoreFromSnapshot(before);
      destination.repository.applyPatch(deletion);
      expect(destination.repository.getSnapshot()).toEqual(after);

      destination.repository.applyPatch(invertPatch(before, deletion));
      expect(destination.repository.getSnapshot()).toEqual(before);
    } finally {
      source.close();
      source.cleanup();
      destination.close();
      destination.cleanup();
    }
  });
});
