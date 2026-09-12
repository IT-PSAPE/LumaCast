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
}

class MockWorkletPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
}

class MockWorkletNode extends MockNode {
  static latest: MockWorkletNode | null = null;
  port = new MockWorkletPort();

  constructor() {
    super();
    MockWorkletNode.latest = this;
  }
}

class MockBlob {
  static lastSource = '';

  constructor(parts: BlobPart[]) {
    MockBlob.lastSource = parts.join('');
  }
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
    MockWorkletNode.latest = null;
    MockBlob.lastSource = '';
    vi.stubGlobal('AudioContext', MockAudioContext as unknown as typeof AudioContext);
    vi.stubGlobal('GainNode', MockNode as unknown as typeof GainNode);
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode as unknown as typeof AudioWorkletNode);
    vi.stubGlobal('AnalyserNode', MockNode as unknown as typeof AnalyserNode);
    vi.stubGlobal('Blob', MockBlob as unknown as typeof Blob);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://ndi');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    Object.assign(window, {
      castApi: {
        requestNdiAudioTransport: vi.fn(),
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
    const module = await import('../../../../../app/renderer/features/playback/ndi-audio-capture');

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
    const module = await import('../../../../../app/renderer/features/playback/ndi-audio-capture');

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

  it('requests one direct transport per enabled output when capture starts and keeps IPC as the not-ready fallback', async () => {
    const module = await import('../../../../../app/renderer/features/playback/ndi-audio-capture');
    module.setNdiAudioEnabledOutputs(new Set(['audience', 'stage']));
    expect(window.castApi.requestNdiAudioTransport).not.toHaveBeenCalled();

    module.addNdiAudioElement(document.createElement('audio'));
    await flushAsyncAudioSetup();
    expect(window.castApi.requestNdiAudioTransport).toHaveBeenCalledTimes(2);
    const worklet = MockWorkletNode.latest!;
    expect(worklet.port.postMessage).toHaveBeenCalledWith({
      type: 'set-enabled-outputs',
      names: ['audience', 'stage'],
    });

    const samples = new Float32Array([1, 2, 3, 4]);
    worklet.port.onmessage?.({
      data: {
        type: 'fallback-audio',
        names: ['audience', 'stage'],
        samples: samples.buffer,
        sampleRate: 48_000,
        channels: 2,
        samplesPerChannel: 2,
      },
    } as MessageEvent);
    expect(window.castApi.sendNdiAudio).toHaveBeenCalledTimes(2);

    worklet.port.onmessage?.({ data: { type: 'transport-ready', name: 'audience' } } as MessageEvent);
    worklet.port.onmessage?.({
      data: {
        type: 'fallback-audio',
        names: ['audience', 'stage'],
        samples: samples.buffer,
        sampleRate: 48_000,
        channels: 2,
        samplesPerChannel: 2,
      },
    } as MessageEvent);
    expect(window.castApi.sendNdiAudio).toHaveBeenCalledTimes(3);
    expect(window.castApi.sendNdiAudio).toHaveBeenLastCalledWith(
      'stage',
      expect.any(Float32Array),
      48_000,
      2,
      2,
    );
    module.setNdiAudioEnabledOutputs(new Set());
  });

  it('transfers an announced audio port into the worklet and resets it when the output disables', async () => {
    const module = await import('../../../../../app/renderer/features/playback/ndi-audio-capture');
    module.setNdiAudioEnabledOutputs(new Set(['audience']));
    module.addNdiAudioElement(document.createElement('audio'));
    await flushAsyncAudioSetup();
    const worklet = MockWorkletNode.latest!;
    const close = vi.fn();
    const port = { close } as unknown as MessagePort;

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'lumacast:ndi-audio-transport-port', version: 1, name: 'audience' },
      origin: window.location.origin,
      source: window,
      ports: [port],
    }));

    expect(worklet.port.postMessage).toHaveBeenCalledWith(
      { type: 'attach-transport', name: 'audience', port },
      [port],
    );
    module.setNdiAudioEnabledOutputs(new Set());
    expect(worklet.port.postMessage).toHaveBeenCalledWith({ type: 'reset-transport', name: 'audience' });
  });

  it('gives each ready direct output its own transferred buffer in FIFO emission order', async () => {
    const module = await import('../../../../../app/renderer/features/playback/ndi-audio-capture');
    module.addNdiAudioElement(document.createElement('audio'));
    await flushAsyncAudioSetup();

    let Processor: (new (options: unknown) => {
      port: MockWorkletPort;
      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    }) | null = null;
    class ProcessorBase {
      port = new MockWorkletPort();
    }
    const loadProcessor = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', MockBlob.lastSource);
    loadProcessor(
      ProcessorBase,
      (_name: string, implementation: typeof Processor) => { Processor = implementation; },
      48_000,
    );
    expect(Processor).not.toBeNull();
    const ProcessorClass = Processor!;
    const processor = new ProcessorClass({ processorOptions: { frameSamples: 2, channels: 2 } });
    const makePort = () => ({
      onmessage: null as ((event: MessageEvent) => void) | null,
      onmessageerror: null as (() => void) | null,
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    });
    const audience = makePort();
    const stage = makePort();
    processor.port.onmessage?.({ data: { type: 'set-enabled-outputs', names: ['audience', 'stage'] } } as MessageEvent);
    processor.port.onmessage?.({ data: { type: 'attach-transport', name: 'audience', port: audience } } as MessageEvent);
    processor.port.onmessage?.({ data: { type: 'attach-transport', name: 'stage', port: stage } } as MessageEvent);
    audience.onmessage?.({ data: { type: 'ready', version: 1, name: 'audience' } } as MessageEvent);
    stage.onmessage?.({ data: { type: 'ready', version: 1, name: 'stage' } } as MessageEvent);

    processor.process(
      [[new Float32Array([1, 2]), new Float32Array([3, 4])]],
      [[new Float32Array(2), new Float32Array(2)]],
    );

    const audienceFrame = audience.postMessage.mock.calls.at(-1)?.[0] as { type: string; buffer: ArrayBuffer };
    const stageFrame = stage.postMessage.mock.calls.at(-1)?.[0] as { type: string; buffer: ArrayBuffer };
    expect(audienceFrame.type).toBe('audio');
    expect(stageFrame.type).toBe('audio');
    expect(audienceFrame.buffer).not.toBe(stageFrame.buffer);
    expect([...new Float32Array(audienceFrame.buffer)]).toEqual([1, 2, 3, 4]);
    expect([...new Float32Array(stageFrame.buffer)]).toEqual([1, 2, 3, 4]);
    expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'fallback-audio' }), expect.anything());
  });
});
