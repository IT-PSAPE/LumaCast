import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..', '..', '..');
const addonPath = join(root, 'packages', 'ndi-native', 'build', 'Release', 'ndi_native.node');
const runtimePath = process.env.CAST_NDI_RUNTIME_PATH
  ?? 'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\Processing.NDI.Lib.x64.dll';

test('NDI6 synthetic local loopback survives full shutdown and restart', {
  skip: process.env.NDI_LOCAL_LOOPBACK_TEST !== '1'
    ? 'set NDI_LOCAL_LOOPBACK_TEST=1 to publish only a synthetic local NDI test source'
    : !existsSync(addonPath) || !existsSync(runtimePath)
      ? `requires a local addon build and NDI runtime at ${runtimePath}`
      : false,
}, async () => {
  process.env.CAST_NDI_RUNTIME_PATH = runtimePath;
  const ndi = require(addonPath);

  const runCycle = async (cycle, globalShutdown) => {
    const senderName = `LumaCast local loopback ${process.pid} ${cycle}`;
    const width = 64;
    const height = 36;
    const fps = cycle === 1 ? [30, 1] : [30000, 1001];
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = (x * 3) & 0xff;
        pixels[offset + 1] = (y * 5) & 0xff;
        pixels[offset + 2] = 180;
        pixels[offset + 3] = 255;
      }
    }

    const samplesPerChannel = 1600;
    const audio = new Float32Array(samplesPerChannel * 2);
    for (let index = 0; index < samplesPerChannel; index += 1) {
      const sample = Math.sin((2 * Math.PI * 440 * index) / 48_000) * 0.15;
      audio[index] = sample;
      audio[samplesPerChannel + index] = sample;
    }

    ndi.initializeSender({
      senderName,
      width,
      height,
      withAlpha: false,
      frameRateN: fps[0],
      frameRateD: fps[1],
    });

    let sendError;
    let sendCount = 0;
    let sending = true;
    const sendFrame = () => {
      if (!sending) return;
      try {
        ndi.sendBgraFrame(senderName, pixels, width, height, width * 4);
        ndi.sendAudioFrame(senderName, audio, 48_000, 2, samplesPerChannel);
        sendCount += 1;
        setTimeout(sendFrame, 34);
      } catch (error) {
        sendError = error;
      }
    };
    sendFrame();

    let receiverId;
    try {
      let sources = [];
      let source;
      const discoveryDeadline = Date.now() + 12_000;
      while (Date.now() < discoveryDeadline && !source) {
        sources = await ndi.discoverSources(1000);
        source = sources.find((candidate) => candidate.name.includes(senderName));
        if (!source) await new Promise((resolve) => setTimeout(resolve, 300));
      }
      assert.ok(source, `NDI-FIND did not discover synthetic source ${senderName} after ${sendCount} sends; found: ${JSON.stringify(sources)}`);
      receiverId = await ndi.createReceiver(source, { includeAudio: true, receiverName: `LumaCast QA ${cycle}` });

      let video;
      let audioFrame;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && (!video || !audioFrame)) {
        if (sendError) throw sendError;
        const frame = await ndi.receiveFrame(receiverId, 100);
        if (frame?.kind === 'video') video = frame;
        if (frame?.kind === 'audio') audioFrame = frame;
      }

      assert.ok(video, 'receiver did not deliver synthetic video');
      assert.equal(video.width, width);
      assert.equal(video.height, height);
      assert.equal(video.frameRateN, fps[0]);
      assert.equal(video.frameRateD, fps[1]);
      assert.equal(video.data.length, width * height * 4);
      assert.ok(video.data.some((value) => value !== 0), 'received video is not the synthetic test pattern');

      assert.ok(audioFrame, 'receiver did not deliver synthetic tone audio');
      assert.equal(audioFrame.sampleRate, 48_000);
      assert.equal(audioFrame.channels, 2);
      assert.ok(audioFrame.samplesPerChannel > 0);
      assert.ok(audioFrame.data.some((value) => Math.abs(value) > 0.01), 'received audio contains the synthetic tone');

      const runtime = ndi.getRuntimeInfo();
      assert.equal(runtime.receive, true);
      assert.equal(runtime.path, runtimePath);
    } finally {
      sending = false;
      if (receiverId && !globalShutdown) await ndi.destroyReceiver(receiverId);
      if (globalShutdown) ndi.destroySender();
      else ndi.destroySender(senderName);
    }

    assert.equal(ndi.getRuntimeInfo().loaded, false, 'full sender/receiver shutdown unloads the runtime');
    if (globalShutdown && receiverId) {
      assert.throws(() => ndi.receiveFrame(receiverId, 0), /receiver was not found/);
    }
  };

  await runCycle(1, true);
  await runCycle(2, false);
});
