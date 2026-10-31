import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'ndi-native', 'src', 'ndi_native.cc'), 'utf8');

test('#246 shared native source keeps the renderer-owned 30000/1001 default pacing', () => {
  assert.match(source, /kVideoFrameRateN\s*=\s*30000/);
  assert.match(source, /kVideoFrameRateD\s*=\s*1001/);
  assert.match(source, /kSenderClockVideo\s*=\s*false/);
  assert.doesNotMatch(source, /frame\.frame_rate_N\s*=\s*60000/);
  assert.doesNotMatch(source, /createDesc\.clock_video\s*=\s*true/);
  assert.match(source, /frameRateN\s*=\s*kVideoFrameRateN/);
  assert.match(source, /frameRateD\s*=\s*kVideoFrameRateD/);
  assert.equal((source.match(/frame\.frame_rate_N\s*=\s*sender(?:->|\.)frameRateN/g) ?? []).length, 4);
  assert.equal((source.match(/frame\.frame_rate_D\s*=\s*sender(?:->|\.)frameRateD/g) ?? []).length, 4);
});

test('NDI sender rational frame rate is optional and validated before integer conversion', () => {
  assert.match(source, /hasFrameRateN\s*!=\s*hasFrameRateD/);
  assert.match(source, /rateN\s*>\s*kMaxVideoFrameRateN/);
  assert.match(source, /rateD\s*>\s*kMaxVideoFrameRateD/);
  assert.match(source, /std::floor\(rateN\)\s*!=\s*rateN/);
  assert.match(source, /std::isfinite\(rateN\)/);
  assert.match(source, /rateN\s*\/\s*rateD\s*<\s*1\.0/);
  assert.match(source, /rateN\s*\/\s*rateD\s*>\s*120\.0/);
});

test('native audio submission is isolated without changing the A/V clock contract', () => {
  assert.match(source, /kSenderClockAudio\s*=\s*false/);
  assert.match(source, /class AudioSendWorker/);
  assert.match(source, /bool Enqueue\(QueuedAudioFrame frame\)/);
  assert.match(source, /queue_\.size\(\) < kMaxQueuedAudioFrames/);
  assert.match(source, /spaceAvailable_\.wait/);
  assert.match(source, /audioWorker->Stop\(\)/);
  assert.match(source, /audioWorker->Enqueue\(std::move\(queued\)\)/);
});
