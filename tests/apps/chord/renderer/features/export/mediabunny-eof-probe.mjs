// Disposable-process diagnostic for the installed dependency's public EOF API.
// Run with `node <this-file> sink` or `node <this-file> encoder`.
// Rejection observation is confined to this probe, never application code.
import { readFile } from 'node:fs/promises';
import {
  AudioSample, AudioSampleSource, BufferTarget, CustomAudioEncoder, EncodedAudioPacketSource,
  EncodedPacket, EncodedVideoPacketSource, MkvOutputFormat, Output, StreamTarget,
  WebMOutputFormat, registerEncoder,
} from 'mediabunny';

const version = JSON.parse(await readFile(new URL('../../../../../../node_modules/mediabunny/package.json', import.meta.url))).version;
const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(String(error)));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let terminal = 'pending';
let writes = 0;
let output;

if (process.argv[2] === 'sink') {
  let rejectWrite;
  const held = new Promise((_, reject) => { rejectWrite = reject; });
  let hold = false;
  output = new Output({
    format: new MkvOutputFormat(),
    target: new StreamTarget(new WritableStream({ write() { writes++; if (hold) return held; } }), { chunked: false }),
  });
  const video = new EncodedVideoPacketSource('vp9');
  const audio = new EncodedAudioPacketSource('opus');
  output.addVideoTrack(video, { frameRate: 30 });
  output.addAudioTrack(audio);
  await output.start();
  hold = true;
  await video.add(new EncodedPacket(new Uint8Array(16), 'key', 0, 1 / 30), {
    decoderConfig: { codec: 'vp09.00.10.08', codedWidth: 16, codedHeight: 16 },
  });
  await audio.add(new EncodedPacket(new Uint8Array(16), 'key', 0, 0.02), {
    decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 },
  });
  video.close();
  await wait(20);
  rejectWrite(new Error('synthetic delayed disk failure'));
} else if (process.argv[2] === 'encoder') {
  class SyntheticEncoder extends CustomAudioEncoder {
    static supports(codec) { return codec === 'opus'; }
    init() {}
    encode(sample) {
      this.onPacket(new EncodedPacket(new Uint8Array(16), 'key', sample.timestamp, sample.duration), {
        decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 1 },
      });
    }
    flush() { throw new Error('synthetic encoder flush failure'); }
    close() {}
  }
  registerEncoder(SyntheticEncoder);
  output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new AudioSampleSource({ codec: 'opus', bitrate: 64000 });
  output.addAudioTrack(source);
  await output.start();
  const sample = new AudioSample({ data: new Float32Array(960), format: 'f32-planar', sampleRate: 48000, numberOfChannels: 1, timestamp: 0 });
  await source.add(sample);
  sample.close();
  source.close();
  await wait(30);
} else throw new Error('Expected probe mode: sink or encoder');

output.finalize().then(() => { terminal = 'resolved'; }, (error) => { terminal = String(error); });
await wait(120);
console.log(JSON.stringify({ version, probe: process.argv[2], writes, terminal, unhandled }));
process.exit(0);
