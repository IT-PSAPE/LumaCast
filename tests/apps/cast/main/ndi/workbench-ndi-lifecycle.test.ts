import { describe, expect, it, vi } from 'vitest';
import type { NdiServiceLike } from '@lumacast/engine';
import { stopWorkbenchNdi } from '../../../../../apps/cast/main/ndi/workbench-ndi-lifecycle';
describe('operator output lifecycle', () => {
  it('waits for input leases, then disables both outputs through the normal state path', async () => {
    let release!: () => void;
    const stop = vi.fn(() => new Promise<void>((done) => { release = done; }));
    const enabled = { audience: true, stage: true };
    const setOutputEnabled = vi.fn((name: 'audience' | 'stage', value: boolean) => { enabled[name] = value; return { ...enabled }; });
    const service = { getOutputState: () => ({ ...enabled }), setOutputEnabled } as unknown as NdiServiceLike;
    const pending = stopWorkbenchNdi({ stop }, service);
    expect(setOutputEnabled).not.toHaveBeenCalled();
    release(); await pending;
    expect(setOutputEnabled.mock.calls).toEqual([['audience', false], ['stage', false]]);
    expect(service.getOutputState()).toEqual({ audience: false, stage: false });
  });
  it('does not create disabled senders or require a GPU manager during startup failure', async () => {
    const setOutputEnabled = vi.fn();
    await stopWorkbenchNdi(null, { getOutputState: () => ({ audience: false, stage: false }), setOutputEnabled } as unknown as NdiServiceLike);
    expect(setOutputEnabled).not.toHaveBeenCalled();
    await expect(stopWorkbenchNdi(null, null)).resolves.toBeUndefined();
  });
});
