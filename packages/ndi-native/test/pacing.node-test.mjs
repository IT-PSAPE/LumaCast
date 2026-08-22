import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, rmSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const MOCK_RUNTIME = join(here, 'fixtures', 'libndi_mock.dylib');
const REPORT = join(here, 'fixtures', 'mock_report.json');

function readReport() {
  return JSON.parse(readFileSync(REPORT, 'utf8'));
}

test('#246 native pacing: video frame rate is 30000/1001 and clock_video is false', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64'
    ? 'checked Electron ABI-133 pacing test requires macOS arm64'
    : false,
}, () => {
  rmSync(REPORT, { force: true });
  assert.ok(existsSync(MOCK_RUNTIME), `mock NDI runtime missing: ${MOCK_RUNTIME}`);
  process.env.CAST_NDI_RUNTIME_PATH = MOCK_RUNTIME;
  process.env.NDI_MOCK_REPORT_PATH = REPORT;
  const checkedAddon = join(here, '..', 'bin', 'darwin-arm64-133', 'ndi-native.node');
  assert.ok(existsSync(checkedAddon), `checked Electron addon missing: ${checkedAddon}`);
  // Require the shipped artifact explicitly so an ignored local build cannot
  // make this regression test pass while the checked binary is stale.
  const ndi = require('../bin/darwin-arm64-133/ndi-native.node');

  // BGRA sender (alpha disabled) exercises the BGRX send path.
  ndi.initializeSender({ senderName: 'bgra', width: 64, height: 48, withAlpha: false });
  const opaque = new Uint8Array(64 * 48 * 4);
  ndi.sendBgraFrame('bgra', opaque, 64, 48, 64 * 4);

  // RGBA sender (alpha enabled) exercises the RGBA send path.
  ndi.initializeSender({ senderName: 'rgba', width: 64, height: 48, withAlpha: true });
  ndi.sendRgbaFrame('rgba', opaque, 64, 48);

  // Teardown sends an opaque black frame, which must also use the pacing.
  ndi.destroySender('bgra');
  ndi.destroySender('rgba');

  const report = readReport();

  // clock_video must be disabled for sender creation (#246).
  assert.equal(
    report.createClockVideo,
    0,
    `expected clock_video=false on send create, got ${report.createClockVideo}`,
  );
  assert.equal(report.senderCreates, 2, `expected two sender creates, got ${report.senderCreates}`);
  assert.equal(
    report.invalidClockVideoCreates,
    0,
    `expected every sender to disable clock_video, got ${report.invalidClockVideoCreates} mismatches`,
  );

  // Every video frame (including the teardown black frame) must carry the
  // 30000/1001 pacing metadata (#246).
  assert.ok(report.videoFrames >= 3, `expected at least 3 video frames, got ${report.videoFrames}`);
  assert.equal(
    report.invalidPacingFrames,
    0,
    `expected every video frame to use 30000/1001, got ${report.invalidPacingFrames} mismatches`,
  );
  assert.equal(
    report.videoFrameRateN,
    30000,
    `expected video frame_rate_N=30000, got ${report.videoFrameRateN}`,
  );
  assert.equal(
    report.videoFrameRateD,
    1001,
    `expected video frame_rate_D=1001, got ${report.videoFrameRateD}`,
  );
});
