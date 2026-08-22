import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildNdiTakeScopeKey,
  claimNdiTakeCorrelation,
  consumeNdiTakeCorrelation,
  doesTakeCorrelationMatch,
  hasPendingNdiTakeCorrelation,
  noteNdiTakeCorrelation,
  resetNdiTakeCorrelationsForTest,
} from './ndi-take-correlation';

describe('ndi take correlation', () => {
  beforeEach(() => {
    resetNdiTakeCorrelationsForTest();
  });

  it('builds a stable output scope key from playlist-entry or item scope', () => {
    expect(buildNdiTakeScopeKey('entry-1', { type: 'presentation', id: 'item-1' })).toBe('entry:entry-1');
    expect(buildNdiTakeScopeKey(null, { type: 'presentation', id: 'item-1' })).toBe('item:presentation:item-1');
    expect(buildNdiTakeScopeKey(null, null)).toBeNull();
  });

  it('retains FIFO order for repeated same-slide takes and consumes per sender only on success', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T10:00:00Z'));

    noteNdiTakeCorrelation({
      kind: 'take',
      slideId: 'slide-1',
      outputScopeKey: 'entry:playlist-1',
      reason: 'jump',
    });
    vi.advanceTimersByTime(100);
    noteNdiTakeCorrelation({
      kind: 'take',
      slideId: 'slide-1',
      outputScopeKey: 'entry:playlist-1',
      reason: 'jump',
    });

    expect(hasPendingNdiTakeCorrelation('audience', 'slide-1', 'entry:playlist-1')).toBe(true);

    const first = claimNdiTakeCorrelation('audience', 'slide-1', 'entry:playlist-1');
    expect(first).toEqual({
      sessionId: expect.any(String),
      sequenceId: 1,
      slideId: 'slide-1',
      outputScopeKey: 'entry:playlist-1',
      kind: 'take',
      reason: 'jump',
      takeIssuedAtMs: Date.parse('2026-08-21T10:00:00Z'),
    });

    // Failed attempts do not consume the claim; the same sequence remains pending.
    expect(claimNdiTakeCorrelation('audience', 'slide-1', 'entry:playlist-1')).toEqual(first);

    consumeNdiTakeCorrelation('audience', first!.sequenceId);

    const second = claimNdiTakeCorrelation('audience', 'slide-1', 'entry:playlist-1');
    expect(second?.sequenceId).toBe(2);
    expect(hasPendingNdiTakeCorrelation('stage', 'slide-1', 'entry:playlist-1')).toBe(true);

    vi.useRealTimers();
  });

  it('rejects stale output-scope matches and supports exact scene/output matching checks', () => {
    noteNdiTakeCorrelation({
      kind: 'activate',
      slideId: 'slide-2',
      outputScopeKey: 'entry:playlist-2',
      reason: 'crossItem',
    });

    expect(claimNdiTakeCorrelation('audience', 'slide-2', 'entry:playlist-3')).toBeNull();

    const claim = claimNdiTakeCorrelation('audience', 'slide-2', 'entry:playlist-2');
    expect(doesTakeCorrelationMatch(claim, 'slide-2', 'entry:playlist-2')).toBe(true);
    expect(doesTakeCorrelationMatch(claim, 'slide-2', 'entry:playlist-3')).toBe(false);
    expect(doesTakeCorrelationMatch(claim, 'slide-3', 'entry:playlist-2')).toBe(false);
  });
});
