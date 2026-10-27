import { AUDIO_TRACKS, type AudioMonitoring, type AudioTrack, type StreamSource } from '../shared/desktop-api';
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?inline';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?inline';
import audioFiltersProcessorUrl from './audio-filters-processor.js?url';
import applicationAudioInputProcessorUrl from './application-audio-input-processor.js?url';
import { audioRouteOutputGains, connectAudioInput, gainFromDecibels, replaceAudioInputConnection } from './audio-route';
import { audioTrackGainValues } from './audio-track-routing';
import { routeMonitorToDevice } from './monitor-device-routing';

interface AudioRoute {
  input: AudioNode;
  inputGain: GainNode;
  gain: GainNode;
  gainFilter: GainNode;
  noiseSuppressionNode: RnnoiseWorkletNode | null;
  noiseSuppressionGeneration: number;
  filterProcessor: AudioWorkletNode | null;
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
  meter: AnalyserNode;
  panner: StereoPannerNode;
  programGain: GainNode;
  trackGains: GainNode[];
  monitorGain: GainNode;
  audioMonitoring: AudioMonitoring;
  programActive: boolean;
  samples: Float32Array<ArrayBuffer>;
  mediaElement?: HTMLMediaElement;
}

type AudioRouteSettings = Pick<StreamSource, 'volume' | 'muted' | 'balance' | 'audioFilters' | 'audioMonitoring' | 'audioTracks'> & { programActive?: boolean };

export interface AudioMixerEngineOptions {
  /** Injected contexts keep the routing graph testable with real WebAudio. */
  context?: AudioContext;
  /** A same-context sink used for monitoring; defaults to the real output. */
  monitorDestination?: AudioNode;
}

export class AudioMixerEngine {
  readonly context: AudioContext;
  readonly destinations: readonly MediaStreamAudioDestinationNode[];
  private readonly routes = new Map<string, AudioRoute>();
  private readonly routeGenerations = new Map<string, number>();
  private monitorDeviceQueue: Promise<void> = Promise.resolve();
  private readonly mediaElementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private readonly audioFiltersModuleReady: Promise<boolean>;
  private readonly applicationAudioInputReady: Promise<boolean>;
  private readonly monitorDestination: AudioNode;
  private rnnoiseWorkletReady: Promise<void> | null = null;
  private rnnoiseWasmReady: Promise<ArrayBuffer> | null = null;

  constructor(options: AudioMixerEngineOptions = {}) {
    this.context = options.context ?? new AudioContext({ sampleRate: 48_000 });
    this.monitorDestination = options.monitorDestination ?? this.context.destination;
    this.destinations = AUDIO_TRACKS.map(() => this.context.createMediaStreamDestination());
    this.audioFiltersModuleReady = this.context.audioWorklet
      ? this.context.audioWorklet.addModule(audioFiltersProcessorUrl).then(() => true).catch(() => false)
      : Promise.resolve(false);
    this.applicationAudioInputReady = this.context.audioWorklet
      ? this.context.audioWorklet.addModule(applicationAudioInputProcessorUrl).then(() => true).catch(() => false)
      : Promise.resolve(false);
  }

  get destination(): MediaStreamAudioDestinationNode { return this.destinations[0]!; }

  destinationFor(track: AudioTrack): MediaStreamAudioDestinationNode { return this.destinations[track - 1]!; }

  async createApplicationAudioInput(): Promise<{ stream: MediaStream; node: AudioWorkletNode; close: () => void }> {
    if (!await this.applicationAudioInputReady) throw new Error('Application audio capture is unavailable in this audio runtime.');
    const node = new AudioWorkletNode(this.context, 'stream-application-audio-input', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    const destination = this.context.createMediaStreamDestination();
    node.connect(destination);
    return {
      stream: destination.stream,
      node,
      close: () => {
        node.port.postMessage({ type: 'stop' });
        node.disconnect();
        destination.stream.getTracks().forEach((track) => track.stop());
        destination.disconnect();
      },
    };
  }

  async add(sourceId: string, stream: MediaStream, settings: AudioRouteSettings): Promise<boolean> {
    const generation = this.beginRouteReplacement(sourceId);
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return true;
    const audioOnlyStream = new MediaStream(tracks);
    const input = this.context.createMediaStreamSource(audioOnlyStream);
    const inputGain = this.context.createGain();
    const gain = this.context.createGain();
    const gainFilter = this.context.createGain();
    const noiseSuppressionNode = await this.createNoiseSuppressionNode(settings.audioFilters?.noiseSuppression === true);
    const filterProcessor = await this.createAudioFiltersProcessor(settings.audioFilters);
    if (this.routeGenerations.get(sourceId) !== generation) {
      noiseSuppressionNode?.destroy();
      filterProcessor?.disconnect();
      input.disconnect();
      inputGain.disconnect();
      gain.disconnect();
      gainFilter.disconnect();
      return false;
    }
    const compressor = this.context.createDynamicsCompressor();
    const limiter = this.context.createDynamicsCompressor();
    const meter = this.context.createAnalyser();
    const panner = this.context.createStereoPanner();
    const programGain = this.context.createGain();
    const monitorGain = this.context.createGain();
    meter.fftSize = 512;
    const samples = new Float32Array(meter.fftSize);
    const audioMonitoring = settings.audioMonitoring ?? 'off';
    const programActive = settings.programActive === true;
    gain.gain.value = settings.muted ? 0 : settings.volume;
    const outputGains = audioRouteOutputGains(programActive, audioMonitoring);
    programGain.gain.value = outputGains.program;
    monitorGain.gain.value = outputGains.monitor;
    this.applyAudioFilters(gainFilter, compressor, limiter, settings.audioFilters);
    panner.pan.value = settings.balance ?? 0;
    connectAudioInput(input, inputGain, noiseSuppressionNode);
    if (filterProcessor) {
      inputGain.connect(filterProcessor);
      filterProcessor.connect(gainFilter);
    } else inputGain.connect(gainFilter);
    gainFilter.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(meter);
    meter.connect(gain);
    gain.connect(panner);
    panner.connect(programGain);
    const trackGains = this.createTrackGains(programGain, settings.audioTracks ?? [1]);
    panner.connect(monitorGain);
    monitorGain.connect(this.monitorDestination);
    this.routes.set(sourceId, { input, inputGain, gain, gainFilter, noiseSuppressionNode, noiseSuppressionGeneration: 0, filterProcessor, compressor, limiter, meter, panner, programGain, trackGains, monitorGain, audioMonitoring, programActive, samples });
    return settings.audioFilters?.noiseSuppression !== true || noiseSuppressionNode !== null;
  }

  async addMediaElement(sourceId: string, element: HTMLMediaElement, settings: AudioRouteSettings): Promise<boolean> {
    const existing = this.routes.get(sourceId);
    if (existing?.mediaElement === element) {
      this.setSettings(sourceId, settings);
      this.setBalance(sourceId, settings.balance ?? 0);
      this.setAudioFilters(sourceId, settings.audioFilters);
      this.setProgramActive(sourceId, settings.programActive === true);
      this.setAudioMonitoring(sourceId, settings.audioMonitoring ?? 'off');
      return this.setNoiseSuppression(sourceId, settings.audioFilters?.noiseSuppression === true);
    }
    const generation = this.beginRouteReplacement(sourceId);
    let input = this.mediaElementSources.get(element);
    if (!input) {
      input = this.context.createMediaElementSource(element);
      this.mediaElementSources.set(element, input);
    }
    const inputGain = this.context.createGain();
    const gain = this.context.createGain();
    const gainFilter = this.context.createGain();
    const noiseSuppressionNode = await this.createNoiseSuppressionNode(settings.audioFilters?.noiseSuppression === true);
    const filterProcessor = await this.createAudioFiltersProcessor(settings.audioFilters);
    if (this.routeGenerations.get(sourceId) !== generation) {
      noiseSuppressionNode?.destroy();
      filterProcessor?.disconnect();
      // MediaElementAudioSourceNode is cached per element and may already be
      // serving a newer route for this source id. It was not connected by this
      // stale operation, so leave the shared input alone.
      inputGain.disconnect();
      gain.disconnect();
      gainFilter.disconnect();
      return false;
    }
    const compressor = this.context.createDynamicsCompressor();
    const limiter = this.context.createDynamicsCompressor();
    const meter = this.context.createAnalyser();
    const panner = this.context.createStereoPanner();
    const programGain = this.context.createGain();
    const monitorGain = this.context.createGain();
    meter.fftSize = 512;
    const samples = new Float32Array(meter.fftSize);
    const audioMonitoring = settings.audioMonitoring ?? 'off';
    const programActive = settings.programActive === true;
    gain.gain.value = settings.muted ? 0 : settings.volume;
    const outputGains = audioRouteOutputGains(programActive, audioMonitoring);
    programGain.gain.value = outputGains.program;
    monitorGain.gain.value = outputGains.monitor;
    this.applyAudioFilters(gainFilter, compressor, limiter, settings.audioFilters);
    panner.pan.value = settings.balance ?? 0;
    connectAudioInput(input, inputGain, noiseSuppressionNode);
    if (filterProcessor) {
      inputGain.connect(filterProcessor);
      filterProcessor.connect(gainFilter);
    } else inputGain.connect(gainFilter);
    gainFilter.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(meter);
    meter.connect(gain);
    gain.connect(panner);
    panner.connect(programGain);
    const trackGains = this.createTrackGains(programGain, settings.audioTracks ?? [1]);
    panner.connect(monitorGain);
    monitorGain.connect(this.monitorDestination);
    this.routes.set(sourceId, { input, inputGain, gain, gainFilter, noiseSuppressionNode, noiseSuppressionGeneration: 0, filterProcessor, compressor, limiter, meter, panner, programGain, trackGains, monitorGain, audioMonitoring, programActive, samples, mediaElement: element });
    return settings.audioFilters?.noiseSuppression !== true || noiseSuppressionNode !== null;
  }

  setSettings(sourceId: string, settings: Pick<StreamSource, 'volume' | 'muted'>): void {
    const route = this.routes.get(sourceId);
    if (!route) return;
    route.gain.gain.setTargetAtTime(settings.muted ? 0 : settings.volume, this.context.currentTime, 0.015);
  }

  setBalance(sourceId: string, balance: number): void {
    const route = this.routes.get(sourceId);
    if (!route) return;
    route.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, balance)), this.context.currentTime, 0.015);
  }

  setAudioTracks(sourceId: string, tracks: readonly AudioTrack[]): void {
    const route = this.routes.get(sourceId);
    if (!route) return;
    const now = this.context.currentTime;
    const gainValues = audioTrackGainValues(tracks);
    route.trackGains.forEach((gain, index) => gain.gain.setTargetAtTime(gainValues[index] ?? 0, now, 0.015));
  }

  setAudioFilters(sourceId: string, filters: StreamSource['audioFilters']): boolean {
    const route = this.routes.get(sourceId);
    const needsWorklet = filters?.noiseGate === true || filters?.expander === true;
    if (!route) return !needsWorklet;
    this.applyAudioFilters(route.gainFilter, route.compressor, route.limiter, filters);
    route.filterProcessor?.port.postMessage(this.audioFilterSettings(filters));
    return !needsWorklet || route.filterProcessor !== null;
  }

  async setNoiseSuppression(sourceId: string, enabled: boolean): Promise<boolean> {
    const route = this.routes.get(sourceId);
    if (!route) return !enabled;
    const generation = ++route.noiseSuppressionGeneration;
    if (enabled === (route.noiseSuppressionNode !== null)) return true;

    if (!enabled) {
      const current = route.noiseSuppressionNode;
      if (!current) return true;
      replaceAudioInputConnection(route.input, route.inputGain, current, null);
      current.destroy();
      route.noiseSuppressionNode = null;
      return true;
    }

    const next = await this.createNoiseSuppressionNode(true);
    if (this.routes.get(sourceId) !== route || route.noiseSuppressionGeneration !== generation) {
      next?.destroy();
      return this.routes.get(sourceId) === route;
    }
    if (!next) return false;
    replaceAudioInputConnection(route.input, route.inputGain, null, next);
    route.noiseSuppressionNode = next;
    return true;
  }

  setProgramActive(sourceId: string, active: boolean): void {
    const route = this.routes.get(sourceId);
    if (!route) return;
    route.programActive = active;
    this.applyOutputGains(route);
  }

  setAudioMonitoring(sourceId: string, audioMonitoring: AudioMonitoring): void {
    const route = this.routes.get(sourceId);
    if (!route) return;
    route.audioMonitoring = audioMonitoring;
    this.applyOutputGains(route);
  }

  level(sourceId: string): number {
    const route = this.routes.get(sourceId);
    if (!route) return 0;
    route.meter.getFloatTimeDomainData(route.samples);
    let sum = 0;
    for (const value of route.samples) sum += value * value;
    return Math.min(1, Math.sqrt(sum / route.samples.length) * 2.4);
  }

  remove(sourceId: string): void {
    this.routeGenerations.set(sourceId, (this.routeGenerations.get(sourceId) ?? 0) + 1);
    this.removeRoute(sourceId);
  }

  private beginRouteReplacement(sourceId: string): number {
    const generation = (this.routeGenerations.get(sourceId) ?? 0) + 1;
    this.routeGenerations.set(sourceId, generation);
    this.removeRoute(sourceId);
    return generation;
  }

  private removeRoute(sourceId: string): void {
    const route = this.routes.get(sourceId);
    if (!route) return;
    route.input.disconnect();
    route.inputGain.disconnect();
    route.gain.disconnect();
    route.gainFilter.disconnect();
    route.noiseSuppressionNode?.disconnect();
    route.noiseSuppressionNode?.destroy();
    route.filterProcessor?.disconnect();
    route.compressor.disconnect();
    route.limiter.disconnect();
    route.meter.disconnect();
    route.panner.disconnect();
    route.programGain.disconnect();
    route.trackGains.forEach((gain) => gain.disconnect());
    route.monitorGain.disconnect();
    this.routes.delete(sourceId);
  }

  async resume(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  setMonitoringDevice(deviceId: string): Promise<void> {
    const routing = this.monitorDeviceQueue.then(() => routeMonitorToDevice(this.context, deviceId));
    this.monitorDeviceQueue = routing.catch(() => undefined);
    return routing;
  }

  sourceIds(): string[] {
    return [...this.routes.keys()];
  }

  async close(): Promise<void> {
    for (const id of this.routes.keys()) this.remove(id);
    await this.context.close();
  }

  private applyAudioFilters(gainFilter: GainNode, compressor: DynamicsCompressorNode, limiter: DynamicsCompressorNode, filters: StreamSource['audioFilters']): void {
    const now = this.context.currentTime;
    gainFilter.gain.setTargetAtTime(gainFromDecibels(filters?.gainDb ?? 0), now, 0.015);
    compressor.knee.setTargetAtTime(4, now, 0.02);
    compressor.attack.setTargetAtTime(0.003, now, 0.02);
    compressor.release.setTargetAtTime(0.25, now, 0.02);
    compressor.threshold.setTargetAtTime(filters?.compressorThresholdDb ?? -18, now, 0.02);
    compressor.ratio.setTargetAtTime(filters?.compressor ? filters.compressorRatio : 1, now, 0.02);
    limiter.knee.setTargetAtTime(0, now, 0.02);
    limiter.attack.setTargetAtTime(0.001, now, 0.02);
    limiter.release.setTargetAtTime(0.1, now, 0.02);
    limiter.threshold.setTargetAtTime(-1, now, 0.02);
    limiter.ratio.setTargetAtTime(filters?.limiter ? 20 : 1, now, 0.02);
  }

  private createTrackGains(programGain: GainNode, tracks: readonly AudioTrack[]): GainNode[] {
    const gainValues = audioTrackGainValues(tracks);
    return this.destinations.map((destination, index) => {
      const gain = this.context.createGain();
      gain.gain.value = gainValues[index] ?? 0;
      programGain.connect(gain);
      gain.connect(destination);
      return gain;
    });
  }

  private applyOutputGains(route: AudioRoute): void {
    const gains = audioRouteOutputGains(route.programActive, route.audioMonitoring);
    const now = this.context.currentTime;
    route.programGain.gain.setTargetAtTime(gains.program, now, 0.015);
    route.monitorGain.gain.setTargetAtTime(gains.monitor, now, 0.015);
  }

  private async createAudioFiltersProcessor(filters: StreamSource['audioFilters']): Promise<AudioWorkletNode | null> {
    if (!await this.audioFiltersModuleReady) return null;
    try {
      const node = new AudioWorkletNode(this.context, 'lumastream-audio-filters');
      node.port.postMessage(this.audioFilterSettings(filters));
      return node;
    } catch {
      return null;
    }
  }

  private async createNoiseSuppressionNode(enabled: boolean): Promise<RnnoiseWorkletNode | null> {
    if (!enabled) return null;
    try {
      this.rnnoiseWorkletReady ??= this.context.audioWorklet.addModule(rnnoiseWorkletUrl);
      this.rnnoiseWasmReady ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
      const [wasmBinary] = await Promise.all([this.rnnoiseWasmReady, this.rnnoiseWorkletReady]);
      return new RnnoiseWorkletNode(this.context, { wasmBinary, maxChannels: 2 });
    } catch {
      this.rnnoiseWorkletReady = null;
      this.rnnoiseWasmReady = null;
      return null;
    }
  }

  private audioFilterSettings(filters: StreamSource['audioFilters']) {
    return {
      enabled: filters?.noiseGate ?? false,
      openThresholdDb: filters?.noiseGateOpenThresholdDb ?? -26,
      closeThresholdDb: filters?.noiseGateCloseThresholdDb ?? -32,
      attackMs: filters?.noiseGateAttackMs ?? 10,
      holdMs: filters?.noiseGateHoldMs ?? 150,
      releaseMs: filters?.noiseGateReleaseMs ?? 250,
      expanderEnabled: filters?.expander ?? false,
      expanderThresholdDb: filters?.expanderThresholdDb ?? -40,
      expanderRatio: filters?.expanderRatio ?? 2,
      expanderAttackMs: filters?.expanderAttackMs ?? 10,
      expanderReleaseMs: filters?.expanderReleaseMs ?? 150,
    };
  }
}
