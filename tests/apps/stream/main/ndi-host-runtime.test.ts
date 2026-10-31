// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createNdiHostRuntime, type NdiNativeApi } from '../../../../apps/stream/main/ndi-host-runtime';

describe('NDI isolated host runtime', () => {
  it('loads the optional addon lazily and uses its bounded receive and send contracts', async () => {
    const native = {
      discoverSources: vi.fn(async () => [{ name: 'Camera A' }]),
      createReceiver: vi.fn(async () => 'native-receiver-1'),
      receiveFrame: vi.fn(async () => null),
      destroyReceiver: vi.fn(async () => undefined),
      initializeSender: vi.fn(),
      sendRgbaFrame: vi.fn(),
      sendAudioFrame: vi.fn(),
      destroySender: vi.fn(),
    };
    const loadNative = vi.fn(() => native as unknown as NdiNativeApi);
    const runtime = createNdiHostRuntime(loadNative);

    expect(loadNative).not.toHaveBeenCalled();
    await expect(runtime.handle({ requestId: '1', type: 'discover' })).resolves.toEqual([{ name: 'Camera A' }]);
    expect(native.discoverSources).toHaveBeenCalledWith(2000);

    await expect(runtime.handle({ requestId: '2', type: 'startReceive', source: { name: 'Camera A' }, includeAudio: false })).resolves.toBe('native-receiver-1');
    expect(native.createReceiver).toHaveBeenCalledWith({ name: 'Camera A' }, { includeAudio: false });
    await runtime.handle({ requestId: '3', type: 'readFrame', receiverId: 'native-receiver-1' });
    expect(native.receiveFrame).toHaveBeenCalledWith('native-receiver-1', 0);
    await runtime.handle({ requestId: '4', type: 'stopReceive', receiverId: 'native-receiver-1' });
    expect(native.destroyReceiver).toHaveBeenCalledWith('native-receiver-1');

    const settings = { senderName: 'Program', width: 2, height: 2, frameRateN: 30, frameRateD: 1 };
    await expect(runtime.handle({ requestId: '5', type: 'startSend', settings })).resolves.toBe('Program');
    expect(native.initializeSender).toHaveBeenCalledWith({ ...settings, withAlpha: false });
    const rgba = new Uint8Array(16);
    await runtime.handle({ requestId: '6', type: 'sendVideo', senderName: 'Program', width: 2, height: 2, data: rgba });
    expect(native.sendRgbaFrame).toHaveBeenCalledWith('Program', rgba, 2, 2);
    const audio = new Float32Array([0, 0, 0.25, -0.25]);
    await runtime.handle({ requestId: '7', type: 'sendAudio', senderName: 'Program', sampleRate: 48000, channels: 2, samplesPerChannel: 2, data: audio });
    expect(native.sendAudioFrame).toHaveBeenCalledWith('Program', audio, 48000, 2, 2);
    await runtime.handle({ requestId: '8', type: 'stopSend', senderName: 'Program' });
    expect(native.destroySender).toHaveBeenCalledWith('Program');
  });

  it('destroys native sessions on host shutdown and rejects unknown receiver reads', async () => {
    const native = {
      discoverSources: vi.fn(async () => []),
      createReceiver: vi.fn(async () => 'native-receiver-1'),
      receiveFrame: vi.fn(async () => null),
      destroyReceiver: vi.fn(async () => undefined),
      initializeSender: vi.fn(),
      sendRgbaFrame: vi.fn(),
      sendAudioFrame: vi.fn(),
      destroySender: vi.fn(),
    };
    const runtime = createNdiHostRuntime(() => native as unknown as NdiNativeApi);
    await runtime.handle({ requestId: '1', type: 'startReceive', source: { name: 'Camera A' }, includeAudio: true });
    await expect(runtime.handle({ requestId: '2', type: 'readFrame', receiverId: 'unknown' })).rejects.toThrow(/no longer active/);
    await runtime.handle({ requestId: '3', type: 'startSend', settings: { senderName: 'Program', width: 2, height: 2, frameRateN: 30, frameRateD: 1 } });
    await runtime.handle({ requestId: '4', type: 'destroy' });
    expect(native.destroyReceiver).toHaveBeenCalledWith('native-receiver-1');
    expect(native.destroySender).toHaveBeenCalledWith('Program');
  });
});
