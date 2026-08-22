import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(join(import.meta.dirname, '..', 'src', 'ndi_native.cc'), 'utf8');

test('#246 shared native source keeps renderer-owned 30000/1001 pacing', () => {
  assert.match(source, /kVideoFrameRateN\s*=\s*30000/);
  assert.match(source, /kVideoFrameRateD\s*=\s*1001/);
  assert.match(source, /kSenderClockVideo\s*=\s*false/);
  assert.doesNotMatch(source, /frame\.frame_rate_N\s*=\s*60000/);
  assert.doesNotMatch(source, /createDesc\.clock_video\s*=\s*true/);
  assert.equal((source.match(/frame\.frame_rate_N\s*=\s*kVideoFrameRateN/g) ?? []).length, 3);
  assert.equal((source.match(/frame\.frame_rate_D\s*=\s*kVideoFrameRateD/g) ?? []).length, 3);
});
