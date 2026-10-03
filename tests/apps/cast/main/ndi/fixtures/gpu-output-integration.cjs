'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../../../../../..');
const { NdiGpuOutput, NdiServiceProxy } = require(path.join(root, 'node_modules/.cache/ndi-gpu-integration/manager.cjs'));
let service, output;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (check()) return; await delay(25); }
  console.error('GPU output state', [...(output?.outputs?.values() ?? [])].map((entry) => ({ name: entry.snapshot.name, ready: entry.ready, committed: !!entry.committed, queue: entry.queue.report() })));
  throw new Error(`Timed out: ${label}; ${JSON.stringify(service?.getDiagnostics())}`);
}
function snapshot(name, color, revisionId) {
  return { name, revisionId, scene: { width: 1920, height: 1080, slide: { id: 'gpu-test-slide', background: { type: 'color', color } }, nodes: [] }, binding: { currentSlideText: null, nextSlideText: null, slideNotes: null, timerReadings: {} }, layerVideo: null };
}
async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-ndi-gpu-'));
  const frames = path.join(temporary, 'frames.ndjson');
  process.env.CAST_NDI_RUNTIME_PATH = path.join(root, 'tests/packages/ndi-native/fixtures/libndi_mock.dylib');
  process.env.NDI_MOCK_FRAME_REPORT_PATH = frames;
  service = new NdiServiceProxy({ hostModulePath: path.join(root, 'apps/cast/out/main/ndi-host.js'), outputConfigs: { audience: { senderName: 'GPU integration audience', withAlpha: false }, stage: { senderName: 'GPU integration stage', withAlpha: true } }, onOutputConfigsChanged: () => output?.invalidate() });
  output = new NdiGpuOutput(service, path.join(root, 'apps/cast/out/main'));
  await until(() => service.getGpuTransport()?.supported, 'native GPU support');
  service.setOutputEnabled('audience', true); service.setOutputEnabled('stage', true);
  output.publish(snapshot('audience', '#ff0000', 'integration-red'));
  output.publish(snapshot('stage', 'rgba(255,0,0,0.5)', 'integration-alpha'));
  // Simulate a lost initial paint; a static scene must recover without new scene IPC.
  for (const entry of output.outputs.values()) {
    const offer = entry.queue.offer.bind(entry.queue); let first = true;
    entry.queue.offer = (frame) => { if (first) { first = false; frame.release(); } else offer(frame); };
  }
  await until(() => (service.getDiagnostics().senders.audience?.performance.framesSent ?? 0) > 2 && (service.getDiagnostics().senders.stage?.performance.framesSent ?? 0) > 2, 'both shared texture outputs');
  const stats = service.getDiagnostics();
  assert.equal(stats.senders.audience.performance.bytesReceived, 0);
  assert.equal(stats.senders.audience.performance.cacheCopyBytes, 0);
  assert.ok(stats.senders.audience.performance.framesReplayed > 0, 'static output must replay the native cache');
  const reports = fs.readFileSync(frames, 'utf8').trim().split('\n').map(JSON.parse);
  const uyvy = reports.find((frame) => frame.fourCC === 0x59565955);
  const uyva = reports.find((frame) => frame.fourCC === 0x41565955);
  assert.ok(uyvy, 'Chromium opaque frame must reach the NDI SDK as UYVY');
  assert.ok(uyva, 'Chromium alpha frame must reach the NDI SDK as UYVA');
  assert.equal(uyvy.width, 1920); assert.equal(uyvy.height, 1080); assert.equal(uyvy.stride, 3840);
  assert.ok(Math.abs(uyvy.uyvy1 - 63) <= 2, 'rendered red luma');
  assert.ok(Math.abs(uyva.alphaFirst - 128) <= 2, 'rendered alpha');
  const audienceWindow = BrowserWindow.getAllWindows().find((win) => new URL(win.webContents.getURL()).searchParams.get('output') === 'audience');
  assert.ok(audienceWindow);
  await audienceWindow.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('canvas'); const context = canvas.getContext('2d'); let tick = 0;
    window.__gpuAnimation = true;
    function draw() { if (!window.__gpuAnimation) return; context.fillStyle = 'rgb(' + (tick++ % 256) + ',0,255)'; context.fillRect(0,0,canvas.width,canvas.height); requestAnimationFrame(draw); }
    draw();
  })()`);
  const initial = service.getDiagnostics().senders.audience.performance.framesCaptured;
  await delay(2500);
  const completed = service.getDiagnostics().senders.audience.performance;
  assert.ok(completed.framesCaptured - initial >= 35, 'moving Chromium frames should reach native output continuously');
  console.log('GPU integration measurements', JSON.stringify({ freshFrames: completed.framesCaptured-initial, seconds: 2.5, nativeSendP95Ms: completed.p95SendDurationMs, nativeReadbackAverageMs: completed.avgReadbackDurationMs, sendIntervalJitterMs: completed.sendIntervalJitterMs, jsPixelBytes: completed.bytesReceived }));
  await audienceWindow.webContents.executeJavaScript('window.__gpuAnimation = false');
  const beforeRebuild = service.getDiagnostics().senders.stage.performance.framesCaptured;
  service.updateOutputConfig('stage', { senderName: 'GPU integration stage rebuilt' });
  await until(() => service.getDiagnostics().senders.stage?.senderName === 'GPU integration stage rebuilt' && (service.getDiagnostics().senders.stage?.performance.framesCaptured ?? 0) > beforeRebuild, 'static frame after sender rebuild');
  const lateTake = snapshot('stage', 'rgba(255,0,0,0.5)', 'integration-alpha');
  lateTake.telemetry = { captureDurationMs: 0, readbackDurationMs: 0, skippedCaptures: 0, framesDroppedBackpressure: 0, correctiveFrameRetries: 0, takeKind: 'take', takeReason: 'sequential', takeSessionId: 'gpu-integration', takeSequenceId: 1, takeIssuedAtMs: Date.now() };
  output.publish(lateTake);
  await until(() => service.getDiagnostics().senders.stage?.performance.pipeline.takeToNativeSend.count > 0, 'late take on a static scene');
  audienceWindow.webContents.forcefullyCrashRenderer();
  await until(() => !service.getDiagnostics().outputState.audience && service.getDiagnostics().senders.audience === null, 'crashed output becomes disabled');
  service.setOutputEnabled('audience', true);
  output.publish(snapshot('audience', '#ff0000', 'integration-recovered'));
  await until(() => (service.getDiagnostics().senders.audience?.performance.framesCaptured ?? 0) > 0 && (service.getDiagnostics().senders.audience?.performance.framesSent ?? 0) > 2, 'output recreation after renderer crash');
  const firstStop = output.stop(); assert.equal(output.stop(), firstStop, 'shutdown must await the same input leases');
  await firstStop;
  service.destroy();
  fs.rmSync(temporary, { recursive: true, force: true });
  console.log('Chromium GPU -> utility host -> native NDI integration passed');
}
app.whenReady().then(run).then(() => app.quit()).catch(async (error) => {
  console.error(error); await output?.stop(); service?.destroy(); app.exit(1);
});
setTimeout(() => { console.error('GPU integration deadline exceeded'); app.exit(2); }, 35000).unref();
