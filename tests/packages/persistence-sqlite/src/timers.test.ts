import { describe, expect, it } from 'vitest';
import { createTestRepository } from '../../../../packages/persistence-sqlite/src/test-support';
import { invertPatch } from '@lumacast/protocol';

describe('timer persistence (ADR-0042)', () => {
  it('creates with defaults, updates, reorders, and deletes timers through snapshot patches', () => {
    const target = createTestRepository({ seed: false });
    try {
      const first = target.repository.createTimer({}).upserts.timers![0]!;
      expect(first).toMatchObject({
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
      });

      const second = target.repository.createTimer({
        name: 'Sermon',
        kind: 'elapsed',
        elapsedEndSeconds: 1800,
      }).upserts.timers![0]!;
      expect(second).toMatchObject({ name: 'Sermon', kind: 'elapsed', elapsedEndSeconds: 1800, order: 1 });
      expect(target.repository.getSnapshot().timers!.map((timer) => timer.id)).toEqual([first.id, second.id]);

      const update = target.repository.updateTimer({
        id: first.id,
        name: 'Countdown',
        allowOverrun: true,
        thresholds: [{ id: 'th-1', atSeconds: 60, color: '#ff0000' }],
        order: 1,
      });
      const updatedFirst = update.upserts.timers?.find((timer) => timer.id === first.id);
      expect(updatedFirst).toMatchObject({
        name: 'Countdown',
        allowOverrun: true,
        thresholds: [{ id: 'th-1', atSeconds: 60, color: '#ff0000' }],
      });
      expect(target.repository.listTimers().map((timer) => timer.id)).toEqual([second.id, first.id]);

      const deletion = target.repository.deleteTimer(second.id);
      expect(deletion.deletes.timers).toEqual([second.id]);
      expect(target.repository.getSnapshot().timers!.map((timer) => timer.id)).toEqual([first.id]);
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('rejects unknown ids the same way updateSlideTag/deleteSlideTag do', () => {
    const target = createTestRepository({ seed: false });
    try {
      expect(() => target.repository.updateTimer({ id: 'missing', name: 'Nope' })).toThrow(/Timer not found/);
      expect(() => target.repository.deleteTimer('missing')).toThrow(/Timer not found/);
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('round-trips a delete through snapshot restore, apply, and invert', () => {
    const source = createTestRepository({ seed: false });
    const destination = createTestRepository({ seed: false });
    try {
      const timerId = source.repository.createTimer({ name: 'Worship' }).upserts.timers![0]!.id;
      const before = source.repository.getSnapshot();
      const deletion = source.repository.deleteTimer(timerId);
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

  it('keeps a linked text binding pointing at a deleted timer', () => {
    const target = createTestRepository({ seed: false });
    try {
      const item = target.repository.createItem({ type: 'presentation', title: 'Deck' });
      const slideId = item.patch.upserts.slides![0]!.id;
      const timerId = target.repository.createTimer({}).upserts.timers![0]!.id;

      target.repository.createElement({
        slideId,
        type: 'text',
        x: 0,
        y: 0,
        width: 200,
        height: 60,
        payload: {
          text: '',
          fontFamily: 'Inter',
          fontSize: 24,
          color: '#ffffff',
          alignment: 'left',
          binding: { kind: 'timer', timerId },
        },
      });

      target.repository.deleteTimer(timerId);

      const element = target.repository.getSnapshot().slideElements.find((candidate) => candidate.slideId === slideId);
      const binding = (element?.payload as { binding?: { timerId?: string } } | undefined)?.binding;
      expect(binding?.timerId).toBe(timerId);
    } finally {
      target.close();
      target.cleanup();
    }
  });
});
