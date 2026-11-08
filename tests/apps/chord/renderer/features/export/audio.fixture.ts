import { ALL_FORMATS, AudioBufferSink, AudioBufferSource, AudioSampleSource, BlobSource, EncodedAudioPacketSource, Input, Output } from 'mediabunny';
import { createEmptyProject } from '../../../../../../apps/chord/shared/project-schema';
import { runExport } from '../../../../../../apps/chord/renderer/features/export/export-engine';

declare global { interface Window { __chordExportProof?: Record<string, unknown>; __chordExportPartial?: Record<string, unknown> } }

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function reachesWrite(entered: Promise<void>, task: Promise<void>) {
  await Promise.race([entered, task.then(() => { throw new Error('Export ended before its expected write'); })]);
}

// Observe public input/terminal methods without changing their results.
const inputs = new Set<Input>();
const outputs = new Set<Output>();
const cleanupErrors: string[] = [];
let observeAdmissions = false, admissions = 0;
for (const source of [AudioBufferSource, AudioSampleSource, EncodedAudioPacketSource]) {
  const prototype = source.prototype as unknown as { add(...args: unknown[]): Promise<void> };
  const original = prototype.add;
  prototype.add = function (this: unknown, ...args: unknown[]) {
    if (observeAdmissions) admissions++;
    return Reflect.apply(original, this, args);
  };
}
const format = Input.prototype.getFormat;
Input.prototype.getFormat = function (...args) { inputs.add(this); return format.apply(this, args); };
const tracks = Input.prototype.getTracks;
Input.prototype.getTracks = function (...args) { inputs.add(this); return tracks.apply(this, args); };
const dispose = Input.prototype.dispose;
Input.prototype.dispose = function () { inputs.delete(this); dispose.call(this); };
const start = Output.prototype.start;
Output.prototype.start = function () { outputs.add(this); return start.call(this); };
for (const method of ['cancel', 'finalize'] as const) {
  const original = Output.prototype[method];
  Output.prototype[method] = async function () {
    try { await original.call(this); }
    catch (error) { if (method === 'cancel') cleanupErrors.push(String(error)); throw error; }
    finally { if (this.state === 'canceled' || this.state === 'finalized') outputs.delete(this); }
  };
}

function wav(seconds: number) {
  const frames = Math.round(seconds * 48000);
  const bytes = new Uint8Array(44 + frames * 4);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 192000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 8000);
    view.setInt16(44 + i * 4, value, true); view.setInt16(46 + i * 4, value, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

function destination() {
  const chunks: { position: number; data: Uint8Array }[] = [];
  let pending = 0, peak = 0;
  return {
    async write(position: number, data: Uint8Array) {
      peak = Math.max(peak, ++pending);
      await wait(2);
      chunks.push({ position, data: data.slice() });
      pending--;
    },
    peak: () => peak,
    bytes() {
      const result = new Uint8Array(Math.max(0, ...chunks.map((chunk) => chunk.position + chunk.data.length)));
      for (const chunk of chunks) result.set(chunk.data, chunk.position);
      return result;
    },
  };
}

async function inspect(bytes: Uint8Array<ArrayBuffer>, duration: number) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes])) });
  try {
    const track = await input.getPrimaryAudioTrack();
    check(track, 'Export has no audio track');
    const codec = await track.getCodec();
    let frames = 0, rate = 0, peak = 0, crossings = 0, sign = 0;
    for await (const { buffer } of new AudioBufferSink(track).buffers()) {
      check(buffer.numberOfChannels === 2, 'Audio channel count changed');
      const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      for (let index = 0; index < left.length; index++) {
        const value = left[index]!;
        if (codec === 'pcm-s16') {
          const expected = Math.round(Math.sin((frames + index) * 2 * Math.PI * 440 / 48000) * 8000) / 32768;
          check(value === expected && right[index] === expected, 'PCM sample content changed');
        }
        peak = Math.max(peak, Math.abs(value));
        if (value > 0.01 && sign !== 1) { crossings++; sign = 1; }
        else if (value < -0.01) sign = -1;
      }
      frames += buffer.length; rate = buffer.sampleRate;
    }
    check(rate === 48000, 'Audio sample rate changed');
    check(Math.abs(frames / rate - duration) < 0.1, `Audio duration ${frames / rate} differs from ${duration}`);
    check(Math.abs(crossings - duration * 440) <= 4, `Tone content changed: ${crossings} cycles`);
    check(peak > 0.1 && peak < 0.4, 'Audio amplitude changed');
    return { codec, frames, rate, duration: frames / rate, peak, toneCycles: crossings, ...(codec === 'pcm-s16' ? { exactPcmSamples: true } : {}) };
  } finally { input.dispose(); }
}

function released() {
  check(inputs.size === 0, `${inputs.size} media inputs remain active`);
  check(outputs.size === 0, `${outputs.size} media outputs remain active`);
  check(!document.querySelector('[style*="-100000px"]'), 'An export renderer remains mounted');
}

async function proof() {
  const project = createEmptyProject('2026-01-01T00:00:00.000Z', 'synthetic-audio-proof');
  const short = URL.createObjectURL(wav(2));
  // Exceed several production chunks, so reaching EOF cannot explain the stall.
  const largeDuration = 180;
  const large = URL.createObjectURL(wav(largeDuration));
  const observations: Record<string, unknown> = {};
  window.__chordExportPartial = observations;
  const request = (format: 'wav' | 'mp3' | 'm4a', url: string, sink: { write(position: number, bytes: Uint8Array): Promise<void> }, signal = new AbortController().signal, onProgress: Parameters<typeof runExport>[0]['onProgress'] = () => {}) => ({
    project, settings: { kind: 'audio' as const, format, quality: 'medium' as const }, audioUrl: url, backgroundUrl: null, sink, signal, onProgress,
  });
  try {
    let nativeMp3 = false;
    try { nativeMp3 = (await AudioEncoder.isConfigSupported({ codec: 'mp3', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported ?? false; }
    catch { /* Unsupported native codec: the app registers its software encoder. */ }
    observations.nativeMp3EncoderSupported = nativeMp3;
    for (const format of ['wav', 'mp3', 'm4a'] as const) {
      document.title = `Audio-only ${format}`;
      const sink = destination();
      await runExport(request(format, short, sink));
      released();
      observations[format] = { decoded: await inspect(sink.bytes(), 2), bytes: sink.bytes().length, peakSinkWrites: sink.peak() };
      released();
    }

    document.title = 'Holding production 8 MiB WAV write';
    const entered = deferred<void>(), held = deferred<void>();
    const sink = destination();
    let writes = 0, firstBytes = 0, settled = false, stage = '', percent = 0;
    admissions = 0; observeAdmissions = true;
    const exporting = runExport(request('wav', large, { async write(position, bytes) {
      writes++;
      if (writes === 1) { firstBytes = bytes.byteLength; entered.resolve(); await held.promise; }
      await sink.write(position, bytes);
    } }, undefined, (value) => { stage = value.stage; percent = value.percent; })).finally(() => { settled = true; });
    await reachesWrite(entered.promise, exporting);
    const packetsAtHold = admissions;
    let atHold = 0, stableAdmissions = 0, furtherAdmissionsAfterSettling = 0;
    try {
      await wait(50);
      atHold = percent;
      stableAdmissions = admissions;
      await wait(50);
      check(!settled && writes === 1, 'Large WAV export did not honor the held write');
      check(firstBytes === 8 * 1024 * 1024, `Expected production chunk, got ${firstBytes}`);
      check(stage === 'rendering' && percent < 100, 'Large write was deferred until producer completion');
      check(percent === atHold, 'Producer advanced while its output write was blocked');
      // Enqueuing a write resolves that packet's flush; the next admitted packet
      // then waits for WritableStream.ready. Count that bounded in-flight add.
      check(stableAdmissions <= packetsAtHold + 1, 'Audio admission did not reach a bounded sink wait');
      furtherAdmissionsAfterSettling = admissions - stableAdmissions;
      check(admissions === stableAdmissions, 'Audio packet admission continued through sink backpressure');
    } finally { held.resolve(); await exporting; }
    observeAdmissions = false;
    released();
    observations.largeWrite = { firstBytes, producerPercentWhileHeld: atHold, audioAdmissionsAtWriteEntry: packetsAtHold, stableAudioAdmissionsWhileHeld: stableAdmissions, furtherAdmissionsAfterSettling, writes, decoded: await inspect(sink.bytes(), largeDuration), bytes: sink.bytes().length, peakSinkWrites: sink.peak() };
    released();

    document.title = 'Rejecting held WAV write';
    const failedWrite = deferred<void>(), rejectGate = deferred<void>();
    const primary = new Error('Synthetic delayed export write failure');
    const beforeWriteFailure = cleanupErrors.length;
    let failedSettled = false, caught: unknown;
    const failed = runExport(request('wav', large, { async write() { failedWrite.resolve(); await rejectGate.promise; } }))
      .catch((error: unknown) => { caught = error; }).finally(() => { failedSettled = true; });
    await reachesWrite(failedWrite.promise, failed);
    try { await wait(20); check(!failedSettled, 'Rejected-write probe settled before the write was released'); }
    finally { rejectGate.reject(primary); await failed; }
    check(caught === primary, 'Cleanup masked the original write error');
    released();
    observations.failedWrite = { samePrimaryError: caught === primary, primaryMessage: primary.message, cleanupErrors: cleanupErrors.slice(beforeWriteFailure), activeInputs: inputs.size, activeOutputs: outputs.size };

    document.title = 'Cancelling a held WAV write';
    const cancelWrite = deferred<void>(), cancelGate = deferred<void>();
    const controller = new AbortController();
    const beforeCancellation = cleanupErrors.length;
    let cancelWrites = 0, cancelledSettled = false, cancellationResult: unknown;
    const cancelled = runExport(request('wav', large, { async write() {
      if (++cancelWrites === 1) { cancelWrite.resolve(); await cancelGate.promise; }
      else if (controller.signal.aborted) throw new Error('Synthetic sink retired after cancellation');
    } }, controller.signal)).catch((error: unknown) => { cancellationResult = error; }).finally(() => { cancelledSettled = true; });
    await reachesWrite(cancelWrite.promise, cancelled);
    controller.abort();
    try { await wait(30); check(!cancelledSettled, 'Cancellation did not join its accepted held write'); }
    finally { cancelGate.resolve(); await cancelled; }
    released();
    observations.cancelledWrite = { aborted: controller.signal.aborted, joinedHeldWrite: true, writes: cancelWrites, result: cancellationResult instanceof Error ? cancellationResult.message : 'resolved', cleanupErrors: cleanupErrors.slice(beforeCancellation), activeInputs: inputs.size, activeOutputs: outputs.size };

    document.title = 'Recovering after failed export';
    const recovery = destination();
    await runExport(request('wav', short, recovery));
    released();
    observations.recovery = await inspect(recovery.bytes(), 2);
    released();
    return { ok: true, observations, scope: 'Actual audio-only conversions and production8MiB WAV write pressure/error/recovery; no large A/V or performance claim.' };
  } finally { URL.revokeObjectURL(short); URL.revokeObjectURL(large); }
}

void proof().then((result) => { window.__chordExportProof = result; }, (error: unknown) => {
  window.__chordExportProof = { ok: false, error: error instanceof Error ? error.stack : String(error) };
});
