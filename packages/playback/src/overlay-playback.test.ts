import { describe, expect, it } from 'vitest';
import type { Overlay } from '@lumacast/composition';
import {
  activateOverlayPlayback,
  advanceOverlayPlayback,
  clearAllOverlayPlayback,
  clearOverlayPlayback,
  collapseOverlayPlaybackToSingle,
  getNextOverlayPlaybackDelay,
  getOverlayRenderLayers,
  type ActiveOverlayEntry,
} from './overlay-playback';

function makeOverlay(id: string, overrides: Partial<Overlay> = {}): Overlay {
  return {
    id,
    slideId: 'slide-1',
    name: `Overlay ${id}`,
    enabled: true,
    elements: [],
    animation: { kind: 'none', durationMs: 0, autoClearDurationMs: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('activateOverlayPlayback', () => {
  it('activates an instant (no-animation) overlay as immediately live', () => {
    const overlay = makeOverlay('o1');
    const overlaysById = new Map([[overlay.id, overlay]]);
    const entries = activateOverlayPlayback([], overlaysById, 'o1', 'single', 1_000);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ overlayId: 'o1', state: 'live', startedAt: 1_000 });
  });

  it('single mode begins exiting any other active overlay with an animation, dropping instant ones outright', () => {
    const instant = makeOverlay('o1');
    const animated = makeOverlay('o2', { animation: { kind: 'dissolve', durationMs: 200, autoClearDurationMs: null } });
    const overlaysById = new Map([[instant.id, instant], [animated.id, animated]]);

    const afterFirst = activateOverlayPlayback([], overlaysById, 'o1', 'single', 0);
    const afterSecond = activateOverlayPlayback(afterFirst, overlaysById, 'o2', 'single', 100);

    // o1 (instant) is dropped outright rather than parked as "exiting".
    expect(afterSecond.find((e) => e.overlayId === 'o1')).toBeUndefined();
    expect(afterSecond.find((e) => e.overlayId === 'o2')).toMatchObject({ state: 'entering' });
  });

  it('multiple mode stacks overlays instead of exiting existing ones', () => {
    const a = makeOverlay('a');
    const b = makeOverlay('b');
    const overlaysById = new Map([[a.id, a], [b.id, b]]);
    const afterA = activateOverlayPlayback([], overlaysById, 'a', 'multiple', 0);
    const afterB = activateOverlayPlayback(afterA, overlaysById, 'b', 'multiple', 0);
    expect(afterB.map((e) => e.overlayId).sort()).toEqual(['a', 'b']);
  });

  it('is a no-op when the overlay id is unknown', () => {
    const entries: ActiveOverlayEntry[] = [];
    expect(activateOverlayPlayback(entries, new Map(), 'missing', 'single', 0)).toBe(entries);
  });
});

describe('clearOverlayPlayback / clearAllOverlayPlayback', () => {
  it('drops an instant overlay outright and keeps others untouched', () => {
    const a = makeOverlay('a');
    const b = makeOverlay('b');
    const overlaysById = new Map([[a.id, a], [b.id, b]]);
    const active = activateOverlayPlayback(
      activateOverlayPlayback([], overlaysById, 'a', 'multiple', 0),
      overlaysById,
      'b',
      'multiple',
      0,
    );
    const cleared = clearOverlayPlayback(active, overlaysById, 'a', 10);
    expect(cleared.map((e) => e.overlayId)).toEqual(['b']);
  });

  it('clears every active overlay', () => {
    const a = makeOverlay('a');
    const overlaysById = new Map([[a.id, a]]);
    const active = activateOverlayPlayback([], overlaysById, 'a', 'single', 0);
    expect(clearAllOverlayPlayback(active, overlaysById, 0)).toEqual([]);
  });
});

describe('collapseOverlayPlaybackToSingle', () => {
  it('keeps only the most recently stacked overlay, exiting the rest', () => {
    const animated = (id: string) => makeOverlay(id, { animation: { kind: 'dissolve', durationMs: 200, autoClearDurationMs: null } });
    const a = animated('a');
    const b = animated('b');
    const overlaysById = new Map([[a.id, a], [b.id, b]]);
    const active = activateOverlayPlayback(
      activateOverlayPlayback([], overlaysById, 'a', 'multiple', 0),
      overlaysById,
      'b',
      'multiple',
      0,
    );
    const collapsed = collapseOverlayPlaybackToSingle(active, overlaysById, 0);
    expect(collapsed.find((e) => e.overlayId === 'b')).toMatchObject({ state: 'entering' });
    expect(collapsed.find((e) => e.overlayId === 'a')).toMatchObject({ state: 'exiting' });
  });

  it('is a no-op with zero or one active overlay', () => {
    expect(collapseOverlayPlaybackToSingle([], new Map(), 0)).toEqual([]);
  });
});

describe('advanceOverlayPlayback', () => {
  it('promotes an entering overlay to live once its animation duration elapses', () => {
    const overlay = makeOverlay('a', { animation: { kind: 'dissolve', durationMs: 200, autoClearDurationMs: null } });
    const overlaysById = new Map([[overlay.id, overlay]]);
    const entering = activateOverlayPlayback([], overlaysById, 'a', 'single', 0);
    expect(entering[0].state).toBe('entering');
    const advanced = advanceOverlayPlayback(entering, overlaysById, 200);
    expect(advanced[0].state).toBe('live');
  });

  it('drops an overlay once its exit animation finishes', () => {
    const overlay = makeOverlay('a', { animation: { kind: 'dissolve', durationMs: 100, autoClearDurationMs: null } });
    const overlaysById = new Map([[overlay.id, overlay]]);
    const live = advanceOverlayPlayback(activateOverlayPlayback([], overlaysById, 'a', 'single', 0), overlaysById, 100);
    const exiting = clearOverlayPlayback(live, overlaysById, 'a', 100);
    expect(exiting[0].state).toBe('exiting');
    expect(advanceOverlayPlayback(exiting, overlaysById, 199)).toHaveLength(1);
    expect(advanceOverlayPlayback(exiting, overlaysById, 200)).toEqual([]);
  });
});

describe('getOverlayRenderLayers', () => {
  it('reports full opacity for a live, instant overlay, ordered by stack order', () => {
    const a = makeOverlay('a');
    const b = makeOverlay('b');
    const overlaysById = new Map([[a.id, a], [b.id, b]]);
    const active = activateOverlayPlayback(
      activateOverlayPlayback([], overlaysById, 'b', 'multiple', 0),
      overlaysById,
      'a',
      'multiple',
      0,
    );
    const layers = getOverlayRenderLayers(active, overlaysById, 0);
    expect(layers.map((l) => l.overlayId)).toEqual(['b', 'a']);
    expect(layers.every((l) => l.opacityMultiplier === 1)).toBe(true);
  });

  it('fades in a mid-animation entering overlay proportionally', () => {
    const overlay = makeOverlay('a', { animation: { kind: 'dissolve', durationMs: 200, autoClearDurationMs: null } });
    const overlaysById = new Map([[overlay.id, overlay]]);
    const active = activateOverlayPlayback([], overlaysById, 'a', 'single', 0);
    const layers = getOverlayRenderLayers(active, overlaysById, 100);
    expect(layers[0].opacityMultiplier).toBeCloseTo(0.5);
  });
});

describe('getNextOverlayPlaybackDelay', () => {
  it('returns null when nothing needs to be re-evaluated', () => {
    expect(getNextOverlayPlaybackDelay([], new Map(), 0)).toBeNull();
  });

  it('schedules a wakeup while an animated overlay is entering', () => {
    const overlay = makeOverlay('a', { animation: { kind: 'dissolve', durationMs: 200, autoClearDurationMs: null } });
    const overlaysById = new Map([[overlay.id, overlay]]);
    const active = activateOverlayPlayback([], overlaysById, 'a', 'single', 0);
    expect(getNextOverlayPlaybackDelay(active, overlaysById, 50)).toBe(33);
  });

  it('schedules a wakeup for a pending auto-clear', () => {
    const overlay = makeOverlay('a', { animation: { kind: 'none', durationMs: 0, autoClearDurationMs: 500 } });
    const overlaysById = new Map([[overlay.id, overlay]]);
    const active = activateOverlayPlayback([], overlaysById, 'a', 'single', 0);
    expect(getNextOverlayPlaybackDelay(active, overlaysById, 100)).toBe(400);
  });
});
