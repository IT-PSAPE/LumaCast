// Synthetic packet/custom-encoder controls: no hardware codec, real media or I/O.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [mode, packageDir] = process.argv.slice(2);
if (!packageDir || !path.isAbsolute(packageDir)) throw new Error('An explicit owned package directory is required.');
const mb = await import(pathToFileURL(path.join(packageDir, 'dist/modules/src/index.js')).href);
const { Output, MkvOutputFormat, WebMOutputFormat, Mp4OutputFormat, StreamTarget, BufferTarget,
  EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket, AudioSampleSource, AudioSample,
  CustomAudioEncoder, registerEncoder, Input, BufferSource, ALL_FORMATS, EncodedPacketSink } = mb;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (promise) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('MediaBunny lifecycle did not settle')), 1_500);
  Promise.resolve(promise).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
const observe = (promise) => Promise.resolve(promise).then(() => ({ ok: true }), (reason) => ({ ok: false, reason }));
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(String(reason)));
let hooks = {};
let ordinal = 0;
class SyntheticEncoder extends CustomAudioEncoder {
  constructor() { super(); this.hooks = hooks; this.id = ordinal++; }
  static supports(codec) { return codec === 'opus'; }
  init() {}
  encode(sample) {
    this.onPacket(new EncodedPacket(new Uint8Array(16), 'key', sample.timestamp, sample.duration), {
      decoderConfig: { codec: 'opus', sampleRate: 48_000, numberOfChannels: 1 },
    });
  }
  flush() { return this.hooks.flush?.(this.id); }
  close() { return this.hooks.close?.(this.id); }
}
registerEncoder(SyntheticEncoder);
async function customOutput(behavior, count = 1, closeTarget = () => {}) {
  hooks = behavior; ordinal = 0;
  const output = new Output({ format: new WebMOutputFormat(), target: new StreamTarget(new WritableStream({ write() {}, close: closeTarget })) });
  const sources = Array.from({ length: count }, () => new AudioSampleSource({ codec: 'opus', bitrate: 64_000 }));
  for (const source of sources) output.addAudioTrack(source);
  await output.start();
  for (const source of sources) {
    const sample = new AudioSample({ data: new Float32Array(960), format: 'f32-planar', sampleRate: 48_000, numberOfChannels: 1, timestamp: 0 });
    try { await source.add(sample); } finally { sample.close(); }
  }
  return { output, sources };
}
const details = {};
if (mode === 'encoder-cleanup') {
  const primary = new Error('original encoder flush failure');
  let flushes = 0, closes = 0, targets = 0;
  const { output, sources: [source] } = await customOutput({ flush() { flushes++; throw primary; }, close() { closes++; } }, 1, () => targets++);
  const closing = source.close();
  assert(closing instanceof Promise);
  assert.equal(source.close(), closing);
  await assert.rejects(within(closing), (error) => error === primary);
  await assert.rejects(within(output.cancel()), (error) => error === primary);
  assert.equal(flushes, 1); assert.equal(closes, 1); assert.equal(targets, 1);
  Object.assign(details, { flushes, closes, targets });
} else if (['finalize-order', 'cancel-order', 'undefined-primary'].includes(mode)) {
  const primary = mode === 'undefined-primary' ? undefined : new Error('first observed failure');
  const later = new Error('later source failure');
  const events = [];
  const { output, sources } = await customOutput({
    async flush(id) { if (id === 0) { await delay(30); throw later; } throw primary; },
    async close(id) { events.push(`close-start:${id}`); if (id === 0) await delay(20); events.push(`close-end:${id}`); },
  }, 2, () => { events.push('target-close'); if (mode === 'cancel-order') throw new Error('secondary target failure'); });
  let result;
  if (mode === 'cancel-order') {
    const closeResults = sources.map((source) => observe(source.close()));
    result = await within(observe(output.cancel()));
    await Promise.all(closeResults);
  } else result = await within(observe(output.finalize()));
  assert.equal(result.ok, false); assert.equal(result.reason, primary);
  assert(events.indexOf('target-close') > events.indexOf('close-end:0'));
  assert(events.indexOf('target-close') > events.indexOf('close-end:1'));
  details.events = events;
} else if (mode === 'cancel-first') {
  let flushes = 0, closes = 0, targets = 0;
  const { output, sources: [source] } = await customOutput({ flush() { flushes++; return new Promise(() => {}); }, close() { closes++; } }, 1, () => targets++);
  const cancel = output.cancel();
  const lateClose = source.close();
  await within(Promise.all([cancel, lateClose]));
  assert.equal(flushes, 0); assert.equal(closes, 1); assert.equal(targets, 1);
  Object.assign(details, { flushes, closes, targets });
} else if (mode === 'cancel-during-close') {
  let startFlush, releaseFlush;
  const started = new Promise((resolve) => { startFlush = resolve; });
  const gate = new Promise((resolve) => { releaseFlush = resolve; });
  let closes = 0, targets = 0;
  const { output, sources: [source] } = await customOutput({ flush() { startFlush(); return gate; }, close() { closes++; } }, 1, () => targets++);
  const closing = source.close();
  await within(started);
  let settled = false;
  const cancel = output.cancel().then(() => { settled = true; });
  await delay(20);
  assert.equal(settled, false); assert.equal(targets, 0);
  releaseFlush();
  await within(Promise.all([closing, cancel]));
  assert.equal(closes, 1); assert.equal(targets, 1);
  Object.assign(details, { closes, targets });
} else if (mode === 'mkv-write-failure' || mode === 'mp4-write-failure') {
  const mp4 = mode === 'mp4-write-failure';
  let held = false, rejectWrite;
  const blocked = new Promise((_resolve, reject) => { rejectWrite = reject; });
  const primary = new Error('original positional write failure');
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 0 }) : new MkvOutputFormat(),
    target: new StreamTarget(new WritableStream({ write() { if (held) return blocked; } }), { chunked: false }) });
  const video = new EncodedVideoPacketSource(mp4 ? 'vp9' : 'vp8');
  const audio = new EncodedAudioPacketSource(mp4 ? 'opus' : 'pcm-s16');
  output.addVideoTrack(video, { frameRate: 30 }); output.addAudioTrack(audio); await output.start();
  if (!mp4) held = true;
  await video.add(new EncodedPacket(new Uint8Array(100), 'key', 0, 1 / 30), { decoderConfig: { codec: mp4 ? 'vp09.00.10.08' : 'vp8', codedWidth: 16, codedHeight: 16 } });
  await audio.add(new EncodedPacket(new Uint8Array(mp4 ? 16 : 3840), 'key', 0, .02), { decoderConfig: { codec: mp4 ? 'opus' : 'pcm-s16', sampleRate: 48_000, numberOfChannels: 2 } });
  if (mp4) {
    for (let timestamp = 1; timestamp <= 4; timestamp++) await video.add(new EncodedPacket(new Uint8Array(100), 'key', timestamp, 1 / 30));
    held = true;
  }
  const closing = observe((mp4 ? audio : video).close());
  await delay(20); rejectWrite(primary);
  const result = await within(closing);
  assert.equal(result.ok, false); assert.equal(result.reason, primary);
  await assert.rejects(within(output.finalize()), (error) => error === primary);
} else if (mode === 'bounded-eof') {
  const output = new Output({ format: new MkvOutputFormat(), target: new StreamTarget(new WritableStream({ write() {} }), { chunked: false }) });
  const video = new EncodedVideoPacketSource('vp8'), audio = new EncodedAudioPacketSource('pcm-s16');
  output.addVideoTrack(video, { frameRate: 30 }); output.addAudioTrack(audio); await output.start();
  let maxQueuedBytes = 0;
  for (let i = 0; i < 600; i++) {
    await video.add(new EncodedPacket(new Uint8Array(64 * 1024), 'key', i / 30, 1 / 30), i === 0 ? { decoderConfig: { codec: 'vp8', codedWidth: 16, codedHeight: 16 } } : undefined);
    if (i < 3) await audio.add(new EncodedPacket(new Uint8Array(3840), 'key', i * .02, .02), i === 0 ? { decoderConfig: { codec: 'pcm-s16', sampleRate: 48_000, numberOfChannels: 2 } } : undefined);
    if (i === 2) await audio.close();
    // Private diagnostics belong only in this regression, never the product scheduler.
    const queued = output._muxer.trackDatas.flatMap((track) => track.chunkQueue ?? track.sampleQueue ?? []).reduce((sum, packet) => sum + (packet.data?.byteLength ?? 0), 0);
    maxQueuedBytes = Math.max(maxQueuedBytes, queued);
  }
  await video.close(); await within(output.finalize());
  assert(maxQueuedBytes <= 64 * 1024); details.maxQueuedBytes = maxQueuedBytes;
} else if (mode === 'unchanged-content') {
  for (const longTrack of ['video', 'audio']) {
    const target = new BufferTarget();
    const output = new Output({ format: new MkvOutputFormat(), target });
    const video = new EncodedVideoPacketSource('vp8'), audio = new EncodedAudioPacketSource('pcm-s16');
    output.addVideoTrack(video, { frameRate: 30 }); output.addAudioTrack(audio); await output.start();
    const videoCount = longTrack === 'video' ? 30 : 2, audioCount = longTrack === 'audio' ? 50 : 2;
    let vi = 0, ai = 0;
    while (vi < videoCount || ai < audioCount) {
      if (vi < videoCount && (ai === audioCount || vi / 30 <= ai * .02)) {
        await video.add(new EncodedPacket(new Uint8Array(1024).fill((vi + 1) % 256), 'key', vi / 30, 1 / 30), vi === 0 ? { decoderConfig: { codec: 'vp8', codedWidth: 16, codedHeight: 16 } } : undefined);
        if (++vi === videoCount) await video.close();
      } else {
        await audio.add(new EncodedPacket(new Uint8Array(3840).fill((ai + 1) % 256), 'key', ai * .02, .02), ai === 0 ? { decoderConfig: { codec: 'pcm-s16', sampleRate: 48_000, numberOfChannels: 2 } } : undefined);
        if (++ai === audioCount) await audio.close();
      }
    }
    await within(output.finalize());
    const hash = createHash('sha256').update(new Uint8Array(target.buffer)).digest('hex');
    // Recorded against unmodified1.60.0: no padding/trimming or media bytes change.
    assert.equal(hash, longTrack === 'video' ? '08c2ac9153afd9c2dbd6d6fbd41971c85b060dde25f0f729710c945d06b0a4bd' : '60c244b24f323d0b9b999febdcb82bd33aaa544d261a4622f9c3d75954687649');
    const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(target.buffer) });
    try {
      const tracks = await input.getTracks();
      const counts = [];
      for (const track of tracks) { let count = 0; for await (const _packet of new EncodedPacketSink(track).packets()) count++; counts.push(count); }
      assert.deepEqual(counts, [videoCount, audioCount]);
    } finally { input.dispose(); }
    details[longTrack] = { hash, videoCount, audioCount };
  }
} else throw new Error(`Unknown lifecycle scenario: ${mode}`);
await delay(20);
assert.deepEqual(unhandled, []);
console.log(JSON.stringify({ mode, details, unhandled }));
