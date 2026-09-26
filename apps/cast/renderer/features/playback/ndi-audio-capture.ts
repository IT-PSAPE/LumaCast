// Renderer-side NDI audio capture pipeline.
//
// We tap each <audio> / <video> element the playback context exposes via a
// MediaElementAudioSourceNode, mix them through a single GainNode, and run an
// AudioWorklet that pulls planar Float32 PCM in fixed-size frames. The worklet
// sends those frames directly to the NDI utility process when its versioned
// MessagePort is ready, with the existing IPC route retained per output as a
// fail-safe.
//
// Crucially we also fan the mix back to ctx.destination so the user still
// hears the elements through their speakers — `createMediaElementSource`
// otherwise hijacks the element's native output.

import {
  NDI_AUDIO_TRANSPORT_VERSION,
  isNdiAudioTransportPortAnnouncement,
  type NdiOutputName,
} from '@lumacast/protocol';

const TARGET_SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 1024; // ~21 ms at 48 kHz
const CHANNELS = 2;
const AUDIO_TRANSPORT_RETRY_MS = 1_000;

type EnabledOutputs = ReadonlySet<NdiOutputName>;

// Inlined AudioWorklet processor. Buffers per-channel samples until we have
// FRAME_SAMPLES, then sends a separately owned planar Float32Array (ch0 then
// ch1) to each ready direct output. Outputs without a ready port are returned
// to renderer JS in one fallback message and keep using the existing IPC path.
// The worklet declares one output and writes silence to it so the audio graph
// keeps it scheduled — a worklet with zero outputs is considered unreachable
// from the destination and won't be processed.
// Inlining as a string + Blob URL avoids pulling Vite into the
// AudioWorklet module-loading path.
const WORKLET_CODE = `
const NDI_AUDIO_TRANSPORT_VERSION = ${NDI_AUDIO_TRANSPORT_VERSION};
class NdiAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.frameSamples = opts.frameSamples || 1024;
    this.channels = opts.channels || 2;
    this.buffers = [];
    for (let ch = 0; ch < this.channels; ch++) {
      this.buffers.push(new Float32Array(this.frameSamples));
    }
    this.write = 0;
    this.enabledOutputs = new Set();
    this.transports = new Map();
    this.port.onmessage = (event) => this.handleControl(event.data);
  }
  handleControl(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'set-enabled-outputs' && Array.isArray(data.names)) {
      const next = new Set(data.names.filter((name) => name === 'audience' || name === 'stage'));
      for (const name of this.transports.keys()) {
        if (!next.has(name)) this.closeTransport(name, false);
      }
      this.enabledOutputs = next;
      return;
    }
    if (data.type === 'attach-transport' && (data.name === 'audience' || data.name === 'stage') && data.port) {
      this.attachTransport(data.name, data.port);
      return;
    }
    if (data.type === 'reset-transport' && (data.name === 'audience' || data.name === 'stage')) {
      this.closeTransport(data.name, false);
      return;
    }
    if (data.type === 'reset-transports') {
      for (const name of [...this.transports.keys()]) this.closeTransport(name, false);
    }
  }
  attachTransport(name, port) {
    this.closeTransport(name, false);
    const transport = { port, ready: false };
    this.transports.set(name, transport);
    port.onmessage = (event) => {
      const message = event.data;
      if (
        message
        && message.type === 'ready'
        && message.version === NDI_AUDIO_TRANSPORT_VERSION
        && message.name === name
      ) {
        transport.ready = true;
        this.port.postMessage({ type: 'transport-ready', name });
        return;
      }
      this.failTransport(name, transport);
    };
    port.onmessageerror = () => this.failTransport(name, transport);
    port.start();
    try {
      port.postMessage({ type: 'handshake', version: NDI_AUDIO_TRANSPORT_VERSION, name });
    } catch {
      this.failTransport(name, transport);
    }
  }
  failTransport(name, transport) {
    if (this.transports.get(name) !== transport) return;
    this.closeTransport(name, true);
  }
  closeTransport(name, reportFallback) {
    const transport = this.transports.get(name);
    if (!transport) return;
    this.transports.delete(name);
    transport.port.onmessage = null;
    transport.port.onmessageerror = null;
    try { transport.port.postMessage({ type: 'close', name }); } catch {}
    try { transport.port.close(); } catch {}
    if (reportFallback) this.port.postMessage({ type: 'transport-fallback', name });
  }
  copyPlanarFrame() {
    const frame = new Float32Array(this.channels * this.frameSamples);
    for (let ch = 0; ch < this.channels; ch++) {
      frame.set(this.buffers[ch], ch * this.frameSamples);
    }
    return frame;
  }
  emitFrame() {
    const fallbackNames = [];
    for (const name of this.enabledOutputs) {
      const transport = this.transports.get(name);
      if (!transport || !transport.ready) {
        fallbackNames.push(name);
        continue;
      }
      const frame = this.copyPlanarFrame();
      try {
        transport.port.postMessage({
          type: 'audio',
          name,
          buffer: frame.buffer,
          sampleRate: Math.round(sampleRate),
          channels: this.channels,
          samplesPerChannel: this.frameSamples,
        }, [frame.buffer]);
      } catch {
        this.failTransport(name, transport);
        fallbackNames.push(name);
      }
    }
    if (fallbackNames.length > 0) {
      const fallback = this.copyPlanarFrame();
      this.port.postMessage({
        type: 'fallback-audio',
        names: fallbackNames,
        samples: fallback.buffer,
        sampleRate: Math.round(sampleRate),
        channels: this.channels,
        samplesPerChannel: this.frameSamples,
      }, [fallback.buffer]);
    }
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    // Always write silence to our output — we exist purely to capture, not
    // to contribute to the local mix.
    if (output) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
    }
    if (!input || input.length === 0) return true;
    const inCh = input.length;
    const blockSize = input[0] ? input[0].length : 0;
    for (let i = 0; i < blockSize; i++) {
      for (let ch = 0; ch < this.channels; ch++) {
        const src = input[Math.min(ch, inCh - 1)];
        this.buffers[ch][this.write] = src ? src[i] : 0;
      }
      this.write++;
      if (this.write >= this.frameSamples) {
        this.emitFrame();
        this.write = 0;
      }
    }
    return true;
  }
}
registerProcessor('ndi-audio-processor', NdiAudioProcessor);
`;

interface AudioCaptureContext {
  ctx: AudioContext;
  mixGain: GainNode;
  worklet: AudioWorkletNode;
  analyser: AnalyserNode;
}

interface SourceRecord {
  desiredConnected: boolean;
  source: MediaElementAudioSourceNode | null;
  connected: boolean;
  context: AudioContext | null;
}

let initPromise: Promise<AudioCaptureContext | null> | null = null;
let activeContext: AudioCaptureContext | null = null;
const sources = new WeakMap<HTMLMediaElement, SourceRecord>();
const pendingTransportPorts = new Map<NdiOutputName, MessagePort>();
const requestedTransportOutputs = new Set<NdiOutputName>();
const readyTransportOutputs = new Set<NdiOutputName>();
const transportRetryTimers = new Map<NdiOutputName, ReturnType<typeof setTimeout>>();

// Read-only handle for the observability page so it can sample the same
// AudioContext we're using for capture. Returns null when capture hasn't
// initialized yet (no media has been hooked up).
export function getActiveNdiAudioContext():
  | { ctx: AudioContext; analyser: AnalyserNode }
  | null {
  if (!activeContext) return null;
  return { ctx: activeContext.ctx, analyser: activeContext.analyser };
}

// Outputs that should receive audio. Updated externally when the user toggles
// NDI outputs on/off. We always run capture (so the speaker output stays
// hooked up via Web Audio) but only ship frames to outputs in this set.
let enabledOutputs: EnabledOutputs = new Set();

export function setNdiAudioEnabledOutputs(outputs: EnabledOutputs): void {
  const next = new Set(outputs);
  for (const name of enabledOutputs) {
    if (next.has(name)) continue;
    disableAudioTransport(name);
  }
  enabledOutputs = next;
  activeContext?.worklet.port.postMessage({ type: 'set-enabled-outputs', names: [...next] });
  if (activeContext) {
    for (const name of next) requestAudioTransport(name);
  }
}

function clearTransportRetry(name: NdiOutputName): void {
  const timer = transportRetryTimers.get(name);
  if (timer) clearTimeout(timer);
  transportRetryTimers.delete(name);
}

function scheduleTransportRetry(name: NdiOutputName): void {
  if (!enabledOutputs.has(name)) return;
  clearTransportRetry(name);
  transportRetryTimers.set(name, setTimeout(() => {
    transportRetryTimers.delete(name);
    requestedTransportOutputs.delete(name);
    readyTransportOutputs.delete(name);
    activeContext?.worklet.port.postMessage({ type: 'reset-transport', name });
    requestAudioTransport(name);
  }, AUDIO_TRANSPORT_RETRY_MS));
}

function requestAudioTransport(name: NdiOutputName): void {
  if (!enabledOutputs.has(name) || readyTransportOutputs.has(name) || requestedTransportOutputs.has(name)) return;
  requestedTransportOutputs.add(name);
  window.castApi.requestNdiAudioTransport(name);
  scheduleTransportRetry(name);
}

function attachAudioTransport(name: NdiOutputName, port: MessagePort): void {
  if (!enabledOutputs.has(name)) {
    port.close();
    return;
  }
  const capture = activeContext;
  if (!capture) {
    pendingTransportPorts.get(name)?.close();
    pendingTransportPorts.set(name, port);
    return;
  }
  try {
    capture.worklet.port.postMessage({ type: 'attach-transport', name, port }, [port]);
  } catch {
    port.close();
    scheduleTransportRetry(name);
  }
}

function disableAudioTransport(name: NdiOutputName): void {
  clearTransportRetry(name);
  requestedTransportOutputs.delete(name);
  readyTransportOutputs.delete(name);
  pendingTransportPorts.get(name)?.close();
  pendingTransportPorts.delete(name);
  activeContext?.worklet.port.postMessage({ type: 'reset-transport', name });
}

function closeUnexpectedPorts(ports: readonly MessagePort[]): void {
  for (const port of ports) port.close();
}

function handleAudioTransportPort(event: MessageEvent<unknown>): void {
  if (event.source !== window || event.origin !== window.location.origin) {
    closeUnexpectedPorts(event.ports);
    return;
  }
  if (!isNdiAudioTransportPortAnnouncement(event.data) || event.ports.length !== 1) {
    closeUnexpectedPorts(event.ports);
    return;
  }
  requestedTransportOutputs.delete(event.data.name);
  attachAudioTransport(event.data.name, event.ports[0]!);
}

const transportListenerWindow = window as typeof window & {
  __lumacastNdiAudioTransportHandler?: (event: MessageEvent<unknown>) => void;
};
if (transportListenerWindow.__lumacastNdiAudioTransportHandler) {
  window.removeEventListener('message', transportListenerWindow.__lumacastNdiAudioTransportHandler);
}
transportListenerWindow.__lumacastNdiAudioTransportHandler = handleAudioTransportPort;
window.addEventListener('message', handleAudioTransportPort);

function resetClosedContext(capture: AudioCaptureContext): void {
  try { capture.worklet.port.postMessage({ type: 'reset-transports' }); } catch { /* closed context */ }
  readyTransportOutputs.clear();
  activeContext = null;
  initPromise = null;
  for (const name of enabledOutputs) scheduleTransportRetry(name);
}

async function ensureContext(): Promise<AudioCaptureContext | null> {
  if (activeContext?.ctx.state === 'closed') {
    resetClosedContext(activeContext);
  }
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    } catch (error) {
      console.error('[ndi-audio-capture] AudioContext init failed:', error);
      return null;
    }

    const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } catch (error) {
      console.error('[ndi-audio-capture] addModule failed:', error);
      URL.revokeObjectURL(url);
      try { await ctx.close(); } catch { /* ignore */ }
      return null;
    }
    URL.revokeObjectURL(url);

    const mixGain = new GainNode(ctx, { gain: 1 });
    const worklet = new AudioWorkletNode(ctx, 'ndi-audio-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [CHANNELS],
      channelCount: CHANNELS,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { frameSamples: FRAME_SAMPLES, channels: CHANNELS },
    });

    worklet.port.onmessage = (event) => {
      const data = event.data as
        | {
            type: 'fallback-audio';
            names: NdiOutputName[];
            samples: ArrayBuffer;
            sampleRate: number;
            channels: number;
            samplesPerChannel: number;
          }
        | { type: 'transport-ready' | 'transport-fallback'; name: NdiOutputName }
        | undefined;
      if (!data) return;
      if (data.type === 'transport-ready') {
        if (!enabledOutputs.has(data.name)) {
          worklet.port.postMessage({ type: 'reset-transport', name: data.name });
          return;
        }
        requestedTransportOutputs.delete(data.name);
        readyTransportOutputs.add(data.name);
        clearTransportRetry(data.name);
        return;
      }
      if (data.type === 'transport-fallback') {
        requestedTransportOutputs.delete(data.name);
        readyTransportOutputs.delete(data.name);
        scheduleTransportRetry(data.name);
        return;
      }
      if (data.type !== 'fallback-audio' || !(data.samples instanceof ArrayBuffer)) return;
      const samples = new Float32Array(data.samples);
      for (const name of data.names) {
        if (!enabledOutputs.has(name) || readyTransportOutputs.has(name)) continue;
        window.castApi.sendNdiAudio(
          name,
          samples,
          data.sampleRate,
          data.channels,
          data.samplesPerChannel,
        );
      }
    };

    mixGain.connect(worklet);
    // The worklet writes silence to its output — connect it to destination
    // anyway so the audio graph keeps it reachable and scheduled.
    worklet.connect(ctx.destination);
    // Keep audible speaker output alive — without this connection the
    // elements routed through the source nodes would be silent locally.
    mixGain.connect(ctx.destination);

    // Side-tap: the observability page sniffs peak/RMS levels off this
    // analyser. Connecting the mix into it (no further routing) doesn't
    // contribute to playback but keeps the analyser fed.
    const analyser = new AnalyserNode(ctx, { fftSize: 1024 });
    mixGain.connect(analyser);

    const capture: AudioCaptureContext = { ctx, mixGain, worklet, analyser };
    activeContext = capture;
    worklet.port.postMessage({ type: 'set-enabled-outputs', names: [...enabledOutputs] });
    for (const [name, port] of pendingTransportPorts) {
      pendingTransportPorts.delete(name);
      attachAudioTransport(name, port);
    }
    for (const name of enabledOutputs) requestAudioTransport(name);
    return capture;
  })();
  return initPromise;
}

export function addNdiAudioElement(element: HTMLMediaElement): void {
  const record = sources.get(element) ?? {
    desiredConnected: false,
    source: null,
    connected: false,
    context: null,
  } satisfies SourceRecord;
  record.desiredConnected = true;
  sources.set(element, record);

  void ensureContext().then((capture) => {
    if (!capture) return;
    if (!record.desiredConnected) return;
    if (record.context && record.context !== capture.ctx) {
      if (record.connected && record.source) {
        try { record.source.disconnect(); } catch { /* ignore */ }
      }
      record.source = null;
      record.connected = false;
      record.context = null;
    }
    record.context = capture.ctx;
    if (!record.source) {
      try {
        record.source = capture.ctx.createMediaElementSource(element);
      } catch (error) {
        console.error('[ndi-audio-capture] createMediaElementSource failed:', error);
        return;
      }
    }
    if (!record.desiredConnected || record.connected || !record.source) return;
    try {
      record.source.connect(capture.mixGain);
      record.connected = true;
    } catch (error) {
      console.error('[ndi-audio-capture] source connect failed:', error);
    }
    if (capture.ctx.state === 'suspended') {
      void capture.ctx.resume().catch(() => undefined);
    }
  });
}

export function removeNdiAudioElement(element: HTMLMediaElement): void {
  const record = sources.get(element);
  if (!record) return;
  record.desiredConnected = false;
  if (!record.source || !record.connected) return;
  try {
    record.source.disconnect();
  } catch { /* ignore */ }
  record.connected = false;
}
