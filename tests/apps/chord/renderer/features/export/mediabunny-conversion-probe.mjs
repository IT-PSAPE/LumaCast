// Public-API diagnostic. Optional argument selects a temporary candidate ESM
// entry; this never patches packages or suppresses errors in application code.
import { pathToFileURL } from 'node:url';
const { ALL_FORMATS, BlobSource, Conversion, Input, Output, StreamTarget, WavOutputFormat } = await import(
  process.argv[2] ? pathToFileURL(process.argv[2]).href : 'mediabunny'
);
const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(String(error)));
const bytes = new Uint8Array(44 + 60 * 48000 * 4);
const view = new DataView(bytes.buffer);
const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
view.setUint32(24, 48000, true); view.setUint32(28, 192000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes])) });
let enter, reject;
const entered = new Promise((resolve) => { enter = resolve; });
const gate = new Promise((_, no) => { reject = no; });
let firstBytes = 0;
const output = new Output({ format: new WavOutputFormat(), target: new StreamTarget(new WritableStream({
  async write(chunk) { firstBytes = chunk.data.byteLength; enter(); await gate; },
}), { chunked: true, chunkSize: 8 * 1024 * 1024 }) });
const conversion = await Conversion.init({ input, output, video: { discard: true }, audio: {} });
if (!conversion.isValid) throw new Error('Synthetic PCM conversion is invalid');
const primary = new Error('Synthetic delayed export write failure');
let received;
try {
  const executing = conversion.execute().catch((error) => { received = error; });
  await entered;
  reject(primary);
  await executing;
  let cancelError = null;
  await conversion.cancel().catch((error) => { cancelError = String(error); });
  await new Promise((resolve) => setTimeout(resolve, 30));
  console.log(JSON.stringify({ firstBytes, primaryPreserved: received === primary, executeError: String(received), cancelError, outputState: output.state, unhandled }));
} finally { input.dispose(); }
