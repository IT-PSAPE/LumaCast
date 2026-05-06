// Renderer-side NDI audio capture pipeline.
//
// We tap each <audio> / <video> element the playback context exposes via a
// MediaElementAudioSourceNode, mix them through a single GainNode, and run an
// AudioWorklet that pulls planar Float32 PCM in fixed-size frames. Each frame
// is shipped over IPC to the NDI utility process.
//
// Crucially we also fan the mix back to ctx.destination so the user still
// hears the elements through their speakers — `createMediaElementSource`
// otherwise hijacks the element's native output.

import type { NdiOutputName } from '@core/types';

const TARGET_SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 1024; // ~21 ms at 48 kHz
const CHANNELS = 2;

type EnabledOutputs = ReadonlySet<NdiOutputName>;

// Inlined AudioWorklet processor. Buffers per-channel samples until we have
// FRAME_SAMPLES, then ships a planar Float32Array (ch0 then ch1) back to the
// main thread. Inlining as a string + Blob URL avoids pulling Vite into the
// AudioWorklet module-loading path.
const WORKLET_CODE = `
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
  }
  process(inputs) {
    const input = inputs[0];
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
        const out = new Float32Array(this.channels * this.frameSamples);
        for (let ch = 0; ch < this.channels; ch++) {
          out.set(this.buffers[ch], ch * this.frameSamples);
        }
        this.port.postMessage(
          { samples: out.buffer, channels: this.channels, samplesPerChannel: this.frameSamples },
          [out.buffer],
        );
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
}

let initPromise: Promise<AudioCaptureContext | null> | null = null;
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

// Outputs that should receive audio. Updated externally when the user toggles
// NDI outputs on/off. We always run capture (so the speaker output stays
// hooked up via Web Audio) but only ship frames to outputs in this set.
let enabledOutputs: EnabledOutputs = new Set();

export function setNdiAudioEnabledOutputs(outputs: EnabledOutputs): void {
  enabledOutputs = outputs;
}

async function ensureContext(): Promise<AudioCaptureContext | null> {
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
      numberOfOutputs: 0,
      channelCount: CHANNELS,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { frameSamples: FRAME_SAMPLES, channels: CHANNELS },
    });

    worklet.port.onmessage = (event) => {
      const data = event.data as
        | { samples: ArrayBuffer; channels: number; samplesPerChannel: number }
        | undefined;
      if (!data?.samples) return;
      if (enabledOutputs.size === 0) return;
      const samples = new Float32Array(data.samples);
      for (const name of enabledOutputs) {
        window.castApi.sendNdiAudio(
          name,
          samples,
          Math.round(ctx.sampleRate),
          data.channels,
          data.samplesPerChannel,
        );
      }
    };

    mixGain.connect(worklet);
    // Keep speaker output alive — without this connection the elements that
    // are routed through the source nodes would be silent locally.
    mixGain.connect(ctx.destination);

    return { ctx, mixGain, worklet };
  })();
  return initPromise;
}

export function addNdiAudioElement(element: HTMLMediaElement): void {
  void ensureContext().then((capture) => {
    if (!capture) return;
    if (sources.has(element)) return;
    try {
      const source = capture.ctx.createMediaElementSource(element);
      source.connect(capture.mixGain);
      sources.set(element, source);
    } catch (error) {
      // createMediaElementSource throws if the element was already routed by
      // someone else — there's no way to recover, the audio will just play
      // through the speakers but won't be captured for NDI.
      console.error('[ndi-audio-capture] createMediaElementSource failed:', error);
    }
    // Browsers start AudioContexts suspended until the page sees a gesture.
    // The renderer is interactive by the time we're capturing, but resume
    // defensively in case we got hooked up before a click.
    if (capture.ctx.state === 'suspended') {
      void capture.ctx.resume().catch(() => undefined);
    }
  });
}

export function removeNdiAudioElement(element: HTMLMediaElement): void {
  const source = sources.get(element);
  if (!source) return;
  try {
    source.disconnect();
  } catch { /* ignore */ }
  sources.delete(element);
}
