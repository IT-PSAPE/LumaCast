import { describe, expect, it } from 'vitest';
import { resolveStageArmedAt } from './stage-arming';

describe('resolveStageArmedAt', () => {
  it('arms with the given timestamp when a stage is selected', () => {
    expect(resolveStageArmedAt('stage-1', 1_000)).toBe(1_000);
  });

  it('disarms when no stage is selected', () => {
    expect(resolveStageArmedAt(null, 1_000)).toBeNull();
  });
});
