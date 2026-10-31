const assert = require('node:assert/strict');
const ndi = require('../../../../packages/ndi-native');

(async () => {
  const name = process.argv[2];
  assert.ok(name, 'expected the synthetic Program sender name');
  let source;
  let discovered = [];
  const discoveryDeadline = Date.now() + 20000;
  while (!source && Date.now() < discoveryDeadline) {
    discovered = await ndi.discoverSources(2000);
    source = discovered.find((item) => item.name.includes(name));
  }
  assert.ok(source, `Program output was not discovered; last source list: ${JSON.stringify(discovered)}`);
  const frameDeadline = Date.now() + 8000;
  const id = await ndi.createReceiver(source, { includeAudio: true });
  let video = false;
  let audio = false;
  try {
    while (Date.now() < frameDeadline && (!video || !audio)) {
      const frame = await ndi.receiveFrame(id, 30);
      if (frame?.kind === 'video') {
        const offset = Math.floor(frame.height / 2) * frame.stride + Math.floor(frame.width / 2) * 4;
        video = frame.width === 1920 && frame.height === 1080
          && frame.data[offset] < 40 && frame.data[offset + 1] < 40 && frame.data[offset + 2] > 200;
      } else if (frame?.kind === 'audio') {
        audio = frame.channels === 2 && frame.sampleRate === 48000
          && frame.data.some((sample) => Math.abs(sample) > 0.01);
      }
    }
    assert.ok(video, 'Program did not broadcast the synthetic red picture');
    assert.ok(audio, 'Program did not broadcast the selected mixer tone');
    console.log(JSON.stringify({ programVideo: true, programAudio: true }));
  } finally {
    await ndi.destroyReceiver(id);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
