import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioContext {
  static addModulePromise: Promise<void> = Promise.resolve();
  static sourceNode = new MockSourceNode();

  sampleRate = 48_000;
  state: AudioContextState = 'running';
  audioWorklet = {
    addModule: vi.fn(() => MockAudioContext.addModulePromise),
  };
  destination = {};
  createMediaElementSource = vi.fn(() => MockAudioContext.sourceNode as unknown as MediaElementAudioSourceNode);
  close = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
}

class MockNode {
  connect = vi.fn();
  disconnect = vi.fn();
  port = { onmessage: null as ((event: MessageEvent) => void) | null };
}

describe('ndi-audio-capture', () => {
  async function flushAsyncAudioSetup() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }

  beforeEach(() => {
    vi.resetModules();
    MockAudioContext.addModulePromise = Promise.resolve();
    MockAudioContext.sourceNode = new MockSourceNode();
    vi.stubGlobal('AudioContext', MockAudioContext as unknown as typeof AudioContext);
    vi.stubGlobal('GainNode', MockNode as unknown as typeof GainNode);
    vi.stubGlobal('AudioWorkletNode', MockNode as unknown as typeof AudioWorkletNode);
    vi.stubGlobal('AnalyserNode', MockNode as unknown as typeof AnalyserNode);
    vi.stubGlobal('Blob', class MockBlob {} as unknown as typeof Blob);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://ndi');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    Object.assign(window, {
      castApi: {
        sendNdiAudio: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not create or connect a source node when the element is removed before context setup resolves', async () => {
    let resolveModule!: () => void;
    MockAudioContext.addModulePromise = new Promise<void>((resolve) => {
      resolveModule = resolve;
    });
    const media = document.createElement('video');
    const module = await import('./ndi-audio-capture');

    module.addNdiAudioElement(media);
    module.removeNdiAudioElement(media);
    resolveModule();
    await flushAsyncAudioSetup();

    const ctx = module.getActiveNdiAudioContext();
    const audioContext = ctx?.ctx as unknown as MockAudioContext | undefined;
    expect(audioContext?.createMediaElementSource).not.toHaveBeenCalled();
    expect(MockAudioContext.sourceNode.connect).not.toHaveBeenCalled();
  });

  it('reuses the same MediaElementAudioSourceNode when an element is removed and added again', async () => {
    const media = document.createElement('video');
    const module = await import('./ndi-audio-capture');

    module.addNdiAudioElement(media);
    await flushAsyncAudioSetup();

    const ctx = module.getActiveNdiAudioContext();
    const audioContext = ctx?.ctx as unknown as MockAudioContext | undefined;
    expect(audioContext?.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(MockAudioContext.sourceNode.connect).toHaveBeenCalledTimes(1);

    module.removeNdiAudioElement(media);
    expect(MockAudioContext.sourceNode.disconnect).toHaveBeenCalledTimes(1);

    module.addNdiAudioElement(media);
    await flushAsyncAudioSetup();

    expect(audioContext?.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(MockAudioContext.sourceNode.connect).toHaveBeenCalledTimes(2);
  });
});
