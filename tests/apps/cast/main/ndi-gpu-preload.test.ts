import { describe, expect, it, vi } from 'vitest';
import { NDI_GPU_SCENE_CHANNEL, NDI_GPU_SCENE_READY_CHANNEL, type NdiGpuOutputApi } from '@lumacast/protocol';
const mocks = vi.hoisted(() => ({ expose: vi.fn(), send: vi.fn(), on: vi.fn(), remove: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { send: mocks.send, on: mocks.on, removeListener: mocks.remove } }));
import '../../../../apps/cast/main/ndi-gpu-preload';
describe('sandboxed GPU output preload', () => {
  it('exposes only scene subscription and readiness on the protocol channels', () => {
    const [name, api] = mocks.expose.mock.calls[0] as [string, NdiGpuOutputApi];
    expect(name).toBe('ndiGpuApi'); expect(Object.keys(api).sort()).toEqual(['onScene', 'ready']);
    const callback = vi.fn(); const remove = api.onScene(callback);
    expect(mocks.on).toHaveBeenCalledWith(NDI_GPU_SCENE_CHANNEL, expect.any(Function));
    const listener = mocks.on.mock.calls[0]![1] as (event: unknown, value: unknown) => void;
    listener({}, { revisionId: 'revision' }); expect(callback).toHaveBeenCalledWith({ revisionId: 'revision' });
    remove(); expect(mocks.remove).toHaveBeenCalledWith(NDI_GPU_SCENE_CHANNEL, listener);
    api.ready('revision'); expect(mocks.send).toHaveBeenCalledWith(NDI_GPU_SCENE_READY_CHANNEL, 'revision');
  });
});
