import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..', '..', '..');
const packageDir = join(root, 'packages', 'ndi-native');
const addonPath = join(packageDir, 'build', 'Release', 'ndi_native.node');
const fixtureDir = join(import.meta.dirname, 'fixtures');
const runtimeName = process.platform === 'win32'
  ? 'Processing.NDI.Lib.x64.dll'
  : process.platform === 'darwin'
    ? 'libndi_mock.dylib'
    : 'libndi_mock.so';
const mockRuntime = join(fixtureDir, runtimeName);
const reportPath = join(fixtureDir, 'receive_mock_report.json');

test('NDI native receive and rational sender rate contracts', {
  skip: !existsSync(addonPath) || !existsSync(mockRuntime)
    ? 'requires a locally built addon and the compiled mock NDI runtime'
    : false,
}, async () => {
  rmSync(reportPath, { force: true });
  process.env.CAST_NDI_RUNTIME_PATH = mockRuntime;
  process.env.NDI_MOCK_REPORT_PATH = reportPath;
  const ndi = require(addonPath);

  assert.deepEqual(await ndi.discoverSources(0), [
    { name: 'Mock NDI Source', urlAddress: 'ndi://mock/source' },
    { name: 'Oversized NDI Source', urlAddress: 'ndi://mock/oversized' },
    { name: 'Overflow NDI Source', urlAddress: 'ndi://mock/overflow' },
    { name: 'BGRX NDI Source', urlAddress: 'ndi://mock/bgrx' },
  ]);

  const discoveryStarted = performance.now();
  const sourcesAfterChanges = await ndi.discoverSources(60);
  const discoveryElapsed = performance.now() - discoveryStarted;
  assert.ok(discoveryElapsed >= 50, 'discovery should use its remaining timeout after early source changes');
  assert.equal(sourcesAfterChanges.length, 4, 'discovery should return the complete list after multiple source changes');

  const receiverId = await ndi.createReceiver({ name: 'Mock NDI Source', urlAddress: 'ndi://mock/source' });
  const video = await ndi.receiveFrame(receiverId, 0);
  assert.equal(video.kind, 'video');
  assert.equal(video.width, 2);
  assert.equal(video.height, 2);
  assert.equal(video.stride, 8);
  assert.equal(video.frameRateN, 60);
  assert.equal(video.frameRateD, 1);
  assert.ok(video.data instanceof Uint8Array);
  assert.deepEqual(Array.from(video.data), [
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
  ]);

  const audio = await ndi.receiveFrame(receiverId, 0);
  assert.equal(audio.kind, 'audio');
  assert.equal(audio.sampleRate, 48_000);
  assert.equal(audio.channels, 2);
  assert.equal(audio.samplesPerChannel, 4);
  assert.equal(audio.channelStrideBytes, 16);
  assert.ok(audio.data instanceof Float32Array);
  const expectedAudio = [0.1, 0.2, 0.3, 0.4, -0.1, -0.2, -0.3, -0.4];
  assert.equal(audio.data.length, expectedAudio.length);
  for (let index = 0; index < expectedAudio.length; index += 1) {
    assert.ok(Math.abs(audio.data[index] - expectedAudio[index]) < 1e-6);
  }
  assert.equal(await ndi.receiveFrame(receiverId, 0), null);
  await ndi.destroyReceiver(receiverId);

  const videoOnlyId = await ndi.createReceiver(
    { name: 'Mock NDI Source' },
    { includeAudio: false },
  );
  assert.equal((await ndi.receiveFrame(videoOnlyId, 0)).kind, 'video');
  assert.equal(await ndi.receiveFrame(videoOnlyId, 0), null);
  await ndi.destroyReceiver(videoOnlyId);

  const bgrxId = await ndi.createReceiver({ name: 'BGRX NDI Source' }, { includeAudio: false });
  const bgrxVideo = await ndi.receiveFrame(bgrxId, 0);
  assert.equal(bgrxVideo.kind, 'video');
  assert.deepEqual(Array.from(bgrxVideo.data), [
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
  ], 'BGRX input must be exposed with opaque alpha under the BGRA contract');
  await ndi.destroyReceiver(bgrxId);

  const closingId = await ndi.createReceiver({ name: 'Mock NDI Source' }, { includeAudio: false });
  process.env.NDI_MOCK_RECEIVE_DELAY_MS = '40';
  const inFlightReceive = ndi.receiveFrame(closingId, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ndi.destroyReceiver(closingId);
  const inFlightFrame = await inFlightReceive;
  delete process.env.NDI_MOCK_RECEIVE_DELAY_MS;
  assert.ok(inFlightFrame === null || inFlightFrame.kind === 'video');
  await ndi.destroyReceiver(closingId); // Destroy is idempotent.
  assert.throws(() => ndi.receiveFrame(closingId, 0), /receiver was not found/);

  const oversizedId = await ndi.createReceiver({ name: 'Oversized NDI Source' });
  await assert.rejects(ndi.receiveFrame(oversizedId, 0), /8\.3 megapixel receive limit/);
  await ndi.destroyReceiver(oversizedId);

  const overflowId = await ndi.createReceiver({ name: 'Overflow NDI Source' });
  await assert.rejects(ndi.receiveFrame(overflowId, 0), /8\.3 megapixel receive limit/);
  await ndi.destroyReceiver(overflowId);

  const senderConfig = { senderName: 'default-rate', width: 2, height: 2, withAlpha: false };
  assert.throws(() => ndi.initializeSender({ ...senderConfig, frameRateN: 60 }), /provided together/);
  assert.throws(() => ndi.initializeSender({ ...senderConfig, frameRateN: '60', frameRateD: 1 }), /must be numbers/);
  assert.throws(() => ndi.initializeSender({ ...senderConfig, frameRateN: 60.5, frameRateD: 1 }), /valid rational/);
  assert.throws(() => ndi.initializeSender({ ...senderConfig, frameRateN: 121, frameRateD: 1 }), /valid rational/);

  const pixels = new Uint8Array(16);
  ndi.initializeSender(senderConfig);
  ndi.sendBgraFrame('default-rate', pixels, 2, 2, 8);
  ndi.initializeSender({ ...senderConfig, senderName: 'custom-rate', frameRateN: 60, frameRateD: 1 });
  ndi.sendBgraFrame('custom-rate', pixels, 2, 2, 8);
  ndi.destroySender('default-rate');
  ndi.destroySender('custom-rate');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.invalidFrameRateFrames, 0);
  assert.ok(report.customFrameRateFrames >= 2, 'custom rate should be used for send and teardown frames');
});
