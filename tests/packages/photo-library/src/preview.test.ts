// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LatestPreview } from '../../../../packages/photo-library/src/preview';

describe('LatestPreview', () => {
  it('preview scheduling keeps only the newest waiting request', async () => {
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const queue = new LatestPreview(async (value: number) => {
      started.push(value);
      if (value === 1) await gate;
      return value;
    });
    const first = queue.request(1);
    const second = queue.request(2);
    const rejected = expect(second).rejects.toThrow(/SUPERSEDED/);
    const third = queue.request(3);
    release();
    expect(await first).toBe(1);
    await rejected;
    expect(await third).toBe(3);
    expect(started).toEqual([1, 3]);
  });
});
