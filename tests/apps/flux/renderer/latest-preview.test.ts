import { describe, expect, it } from 'vitest';
import { LatestPreview } from '../../../../apps/flux/renderer/latest-preview';

// The renderer keeps its own copy of the preview scheduler, so the scheduling
// contract is asserted against the copy the viewer actually drives.
describe('apps/flux renderer LatestPreview', () => {
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

  it('propagates a render failure to the waiting request and keeps draining', async () => {
    const queue = new LatestPreview(async (value: number) => {
      if (value === 1) throw new Error('render failed');
      return value;
    });

    await expect(queue.request(1)).rejects.toThrow(/render failed/);
    expect(await queue.request(2)).toBe(2);
  });
});
