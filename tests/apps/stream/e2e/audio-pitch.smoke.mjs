import { resolveAppElectron } from '../../../../tool/app-electron.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));
const root = process.cwd();
const playwrightRequire = createRequire(path.resolve('package.json'));
const { _electron: electron, expect } = playwrightRequire('@playwright/test');
const { binaryPath: electronBinary, version: electronVersion } = resolveAppElectron('stream');
const ffmpegExecutable = path.resolve('apps/stream/vendor/ffmpeg/bin/ffmpeg');
const outputRoot = path.resolve('output/playwright/audio-pitch-smoke');
const fixtureSampleRate = 48_000;
const fixtureDurationSeconds = 18;
const leftToneHz = 440;
const rightToneHz = 660;
const mediaOnlyObservationMs = 2500;
const syntheticWorkletDurationMs = 4000;
const nativeCaptureDurationMs = 4000;

function writeToneWave(filePath, amplitude = 0.45) {
  const frameCount = fixtureSampleRate * fixtureDurationSeconds;
  const dataBytes = frameCount * 2 * 2;
  const wave = Buffer.alloc(44 + dataBytes);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + dataBytes, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(2, 22);
  wave.writeUInt32LE(fixtureSampleRate, 24);
  wave.writeUInt32LE(fixtureSampleRate * 4, 28);
  wave.writeUInt16LE(4, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / fixtureSampleRate;
    const left = Math.round(Math.sin(2 * Math.PI * leftToneHz * time) * amplitude * 32767);
    const right = Math.round(Math.sin(2 * Math.PI * rightToneHz * time) * amplitude * 32767);
    const offset = 44 + frame * 4;
    wave.writeInt16LE(left, offset);
    wave.writeInt16LE(right, offset + 2);
  }
  return fs.writeFile(filePath, wave);
}

function createTonePcm(durationSeconds, sampleRate = fixtureSampleRate, amplitude = 0.4) {
  const frameCount = Math.floor(durationSeconds * sampleRate);
  const pcm = Buffer.alloc(frameCount * 2 * 4);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate;
    pcm.writeFloatLE(Math.sin(2 * Math.PI * leftToneHz * time) * amplitude, frame * 8);
    pcm.writeFloatLE(Math.sin(2 * Math.PI * rightToneHz * time) * amplitude, frame * 8 + 4);
  }
  return pcm;
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function buildCurrentNativeAudioHelper(runRoot) {
  const sourcePath = path.resolve('apps/stream/native/audio-tap/main.m');
  const helperPath = path.join(runRoot, 'native-helper', 'lumastream-audio-tap');
  await fs.mkdir(path.dirname(helperPath), { recursive: true });
  execFileSync('clang', [
    '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter',
    '-mmacosx-version-min=13.0', '-arch', 'arm64', '-arch', 'x86_64',
    sourcePath, path.join(path.dirname(sourcePath), 'pcm-writer.c'), '-o', helperPath,
    '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'CoreAudio', '-framework', 'AVFoundation',
  ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const clangVersion = execFileSync('clang', ['--version'], { encoding: 'utf8', timeout: 10000 }).split(/\r?\n/)[0] ?? 'unknown';
  const architectures = execFileSync('lipo', ['-archs', helperPath], { encoding: 'utf8', timeout: 10000 }).trim().split(/\s+/);
  return {
    path: helperPath,
    sourcePath,
    clangVersion,
    architectures,
    sourceSha256: await sha256(sourcePath),
    binarySha256: await sha256(helperPath),
  };
}

async function writeTonePlayerFiles(runRoot) {
  const toneMainPath = path.join(runRoot, 'tone-player.cjs');
  const toneHtmlPath = path.join(runRoot, 'tone-player.html');
  const toneDataPath = path.join(runRoot, 'tone-app-data');
  const toneMain = `
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const appData = ${JSON.stringify(toneDataPath)};
app.setPath('appData', appData);
app.setPath('userData', path.join(appData, 'user-data'));
app.whenReady().then(() => {
  app.dock?.hide();
  const window = new BrowserWindow({
    show: false,
    width: 320,
    height: 180,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  void window.loadFile(${JSON.stringify(toneHtmlPath)});
});
app.on('window-all-closed', () => app.quit());
`;
  const toneHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Synthetic audio fixture</title></head>
<body><script>
(() => {
  const probe = window.__toneFixture = { state: 'starting', requestedSampleRate: 48000, sampleRate: null, channels: 2 };
  const context = new AudioContext({ sampleRate: 48000 });
  const merger = context.createChannelMerger(2);
  const leftOscillator = context.createOscillator();
  const rightOscillator = context.createOscillator();
  const leftGain = context.createGain();
  const rightGain = context.createGain();
  const quietMaster = context.createGain();
  leftOscillator.frequency.value = 440;
  rightOscillator.frequency.value = 660;
  leftGain.gain.value = 0.025;
  rightGain.gain.value = 0.025;
  quietMaster.gain.value = 0.3;
  leftOscillator.connect(leftGain).connect(merger, 0, 0);
  rightOscillator.connect(rightGain).connect(merger, 0, 1);
  merger.connect(quietMaster).connect(context.destination);
  leftOscillator.start();
  rightOscillator.start();
  void context.resume().then(() => {
    probe.state = context.state;
    probe.sampleRate = context.sampleRate;
    probe.startedAt = performance.now();
  }).catch(() => { probe.state = 'resume-failed'; });
})();
</script></body></html>`;
  await fs.writeFile(toneMainPath, toneMain, 'utf8');
  await fs.writeFile(toneHtmlPath, toneHtml, 'utf8');
  return { mainPath: toneMainPath, htmlPath: toneHtmlPath, dataPath: toneDataPath };
}

function classifyNativeCapture(stderr, exitCode) {
  const value = String(stderr).toLowerCase();
  if (/refused by macos|screen & system audio recording|permission/.test(value) || exitCode === 4) {
    return {
      category: 'tcc-permission-refused',
      message: 'macOS refused AudioHardwareCreateProcessTap; capture requires System Audio Recording Only permission under System Settings > Privacy & Security > Screen & System Audio Recording.',
    };
  }
  if (/requires macos 14\.2|this mac runs/.test(value) || exitCode === 3) {
    return { category: 'unsupported-macos', message: 'The helper reports that process taps require macOS 14.2 or later.' };
  }
  if (/path does not match|no longer running|process executable path/.test(value)) {
    return { category: 'owned-process-verification-failed', message: 'The helper could not verify the test-owned process executable.' };
  }
  if (exitCode === 0) return { category: 'stopped-cleanly', message: '' };
  if (value.trim()) return { category: 'helper-error', message: 'The native helper exited with a sanitized error; see the category and exit code.' };
  return { category: 'no-pcm', message: 'The native helper closed without PCM output.' };
}

async function captureOwnedProcessAudio(helperPath, pid, executablePath, durationMs) {
  const child = spawn(helperPath, ['capture', '--pid', String(pid), '--path', executablePath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const chunks = [];
  let byteLength = 0;
  let stderr = '';
  const startedAt = Date.now();
  child.stdout.on('data', (chunk) => { chunks.push(Buffer.from(chunk)); byteLength += chunk.byteLength; });
  child.stderr.on('data', (chunk) => { if (stderr.length < 16000) stderr += chunk.toString('utf8').slice(0, 16000 - stderr.length); });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  const endTimer = setTimeout(() => child.stdin.end(), durationMs);
  const watchdog = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }, 15000);
  let closeState;
  try {
    closeState = await closed;
  } finally {
    clearTimeout(endTimer);
    clearTimeout(watchdog);
  }
  const rawPcm = Buffer.concat(chunks, byteLength);
  return {
    rawPcm,
    elapsedMs: Date.now() - startedAt,
    exitCode: closeState.code,
    signalCode: closeState.signal,
    stderrCategory: classifyNativeCapture(stderr, closeState.code),
    hasBanner: /capturing [^\r\n]+ as 48 kHz stereo float pcm/i.test(stderr),
    diagnostics: stderr.split(/\r?\n/).filter((line) => line.startsWith('AUDIO_PITCH_DIAGNOSTIC ')),
  };
}

async function buildDiagnosticNativeHelper(runRoot, nativeHelper, { tapOnly = false, label = 'current-helper' } = {}) {
  const original = await fs.readFile(nativeHelper.sourcePath, 'utf8');
  let source = original;
  const tapFormatAnchor = '  _inputFormat = [[AVAudioFormat alloc] initWithStreamDescription:&streamDescription];';
  const aggregateAnchor = '  if ((*error = CheckStatus(AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)aggregateDescription, &_aggregateID), @"Creating the capture device"))) return NO;';
  const callbackAnchor = '  if (atomic_load(&_stopped) || !_inputFormat || !_converter || !inputData || inputData->mNumberBuffers == 0) return;';
  const ioCallbackAnchor = '      [weakSelf handleInput:inInputData];';
  const mainSubDeviceLine = '    @kAudioAggregateDeviceMainSubDeviceKey: outputUID,\n';
  const subDeviceListLine = '    @kAudioAggregateDeviceSubDeviceListKey: @[ @{ @kAudioSubDeviceUIDKey: outputUID } ],\n';
  assert.equal(source.split(tapFormatAnchor).length - 1, 1, 'Could not anchor the temporary tap-format diagnostic.');
  assert.equal(source.split(aggregateAnchor).length - 1, 1, 'Could not anchor the temporary aggregate-format diagnostic.');
  assert.equal(source.split(callbackAnchor).length - 1, 1, 'Could not anchor the temporary IOProc-buffer diagnostic.');
  assert.equal(source.split(ioCallbackAnchor).length - 1, 1, 'Could not anchor the temporary IOProc-clock diagnostic.');
  const hasMainSubDevice = source.includes(mainSubDeviceLine);
  const hasSubDeviceList = source.includes(subDeviceListLine);
  assert.equal(hasMainSubDevice, hasSubDeviceList, 'The aggregate source has an incomplete physical subdevice configuration.');
  const effectiveTapOnly = tapOnly || !hasMainSubDevice;
  if (tapOnly && hasMainSubDevice) {
    source = source.replace(mainSubDeviceLine, '').replace(subDeviceListLine, '');
  }
  source = source.replace(tapFormatAnchor, `${tapFormatAnchor}
  fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC tap_asbd sample_rate=%.3f format_id=%u format_flags=0x%x bytes_per_packet=%u frames_per_packet=%u bytes_per_frame=%u channels_per_frame=%u bits_per_channel=%u\\n",
    streamDescription.mSampleRate, streamDescription.mFormatID, streamDescription.mFormatFlags,
    streamDescription.mBytesPerPacket, streamDescription.mFramesPerPacket, streamDescription.mBytesPerFrame,
    streamDescription.mChannelsPerFrame, streamDescription.mBitsPerChannel);`);
  source = source.replace(aggregateAnchor, `${aggregateAnchor}
  AudioObjectPropertyAddress streamListAddress = { kAudioDevicePropertyStreams, kAudioDevicePropertyScopeInput, kAudioObjectPropertyElementMain };
  UInt32 streamListSize = 0;
  OSStatus streamListStatus = AudioObjectGetPropertyDataSize(_aggregateID, &streamListAddress, 0, NULL, &streamListSize);
  UInt32 streamCount = streamListStatus == noErr ? streamListSize / sizeof(AudioStreamID) : 0;
  fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC aggregate_input_stream_list status=%d count=%u bytes=%u\\n", (int)streamListStatus, streamCount, streamListSize);
  if (streamCount > 0) {
    AudioStreamID *streamIDs = calloc(streamCount, sizeof(AudioStreamID));
    if (streamIDs) {
      if (AudioObjectGetPropertyData(_aggregateID, &streamListAddress, 0, NULL, &streamListSize, streamIDs) == noErr) {
        for (UInt32 streamIndex = 0; streamIndex < streamCount; streamIndex += 1) {
          AudioStreamBasicDescription format = {0};
          UInt32 formatSize = sizeof(format);
          AudioObjectPropertyAddress formatAddress = { kAudioStreamPropertyVirtualFormat, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
          OSStatus formatStatus = AudioObjectGetPropertyData(streamIDs[streamIndex], &formatAddress, 0, NULL, &formatSize, &format);
          fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC aggregate_input_stream index=%u id=%u status=%d sample_rate=%.3f bytes_per_packet=%u frames_per_packet=%u bytes_per_frame=%u channels_per_frame=%u bits_per_channel=%u\\n",
            streamIndex, streamIDs[streamIndex], (int)formatStatus, format.mSampleRate, format.mBytesPerPacket,
            format.mFramesPerPacket, format.mBytesPerFrame, format.mChannelsPerFrame, format.mBitsPerChannel);
        }
      }
      free(streamIDs);
    }
  }
  AudioObjectPropertyAddress outputLookupAddress = GlobalAddress(kAudioHardwarePropertyDefaultSystemOutputDevice);
  AudioObjectID outputDeviceID = kAudioObjectUnknown;
  UInt32 outputDeviceSize = sizeof outputDeviceID;
  OSStatus outputLookupStatus = AudioObjectGetPropertyData(kAudioObjectSystemObject, &outputLookupAddress, 0, NULL, &outputDeviceSize, &outputDeviceID);
  double aggregateNominalRate = 0;
  double outputNominalRate = 0;
  UInt32 aggregateNominalSize = sizeof aggregateNominalRate;
  UInt32 outputNominalSize = sizeof outputNominalRate;
  UInt32 aggregateBufferFrames = 0;
  UInt32 outputBufferFrames = 0;
  UInt32 aggregateBufferSize = sizeof aggregateBufferFrames;
  UInt32 outputBufferSize = sizeof outputBufferFrames;
  AudioObjectPropertyAddress nominalRateAddress = GlobalAddress(kAudioDevicePropertyNominalSampleRate);
  AudioObjectPropertyAddress bufferFramesAddress = GlobalAddress(kAudioDevicePropertyBufferFrameSize);
  OSStatus aggregateRateStatus = AudioObjectGetPropertyData(_aggregateID, &nominalRateAddress, 0, NULL, &aggregateNominalSize, &aggregateNominalRate);
  OSStatus outputRateStatus = outputLookupStatus == noErr ? AudioObjectGetPropertyData(outputDeviceID, &nominalRateAddress, 0, NULL, &outputNominalSize, &outputNominalRate) : outputLookupStatus;
  OSStatus aggregateBufferStatus = AudioObjectGetPropertyData(_aggregateID, &bufferFramesAddress, 0, NULL, &aggregateBufferSize, &aggregateBufferFrames);
  OSStatus outputBufferStatus = outputLookupStatus == noErr ? AudioObjectGetPropertyData(outputDeviceID, &bufferFramesAddress, 0, NULL, &outputBufferSize, &outputBufferFrames) : outputLookupStatus;
  fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC aggregate_clock tap_only=${effectiveTapOnly ? 'true' : 'false'} aggregate_rate_status=%d aggregate_nominal_hz=%.3f aggregate_buffer_status=%d aggregate_buffer_frames=%u output_lookup_status=%d output_rate_status=%d output_nominal_hz=%.3f output_buffer_status=%d output_buffer_frames=%u host_clock_hz=%.0f\\n",
    (int)aggregateRateStatus, aggregateNominalRate, (int)aggregateBufferStatus, aggregateBufferFrames,
    (int)outputLookupStatus, (int)outputRateStatus, outputNominalRate, (int)outputBufferStatus, outputBufferFrames,
    AudioGetHostClockFrequency());
  AudioObjectPropertyAddress outputStreamListAddress = { kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput, kAudioObjectPropertyElementMain };
  UInt32 outputStreamListSize = 0;
  OSStatus outputStreamListStatus = outputLookupStatus == noErr ? AudioObjectGetPropertyDataSize(outputDeviceID, &outputStreamListAddress, 0, NULL, &outputStreamListSize) : outputLookupStatus;
  UInt32 outputStreamCount = outputStreamListStatus == noErr ? outputStreamListSize / sizeof(AudioStreamID) : 0;
  fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC output_stream_list status=%d count=%u bytes=%u\\n", (int)outputStreamListStatus, outputStreamCount, outputStreamListSize);
  if (outputStreamCount > 0) {
    AudioStreamID *outputStreamIDs = calloc(outputStreamCount, sizeof(AudioStreamID));
    if (outputStreamIDs) {
      if (AudioObjectGetPropertyData(outputDeviceID, &outputStreamListAddress, 0, NULL, &outputStreamListSize, outputStreamIDs) == noErr) {
        for (UInt32 outputStreamIndex = 0; outputStreamIndex < outputStreamCount; outputStreamIndex += 1) {
          AudioStreamBasicDescription outputFormat = {0};
          UInt32 outputFormatSize = sizeof(outputFormat);
          AudioObjectPropertyAddress outputFormatAddress = { kAudioStreamPropertyVirtualFormat, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
          OSStatus outputFormatStatus = AudioObjectGetPropertyData(outputStreamIDs[outputStreamIndex], &outputFormatAddress, 0, NULL, &outputFormatSize, &outputFormat);
          fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC output_stream index=%u status=%d sample_rate=%.3f bytes_per_frame=%u channels_per_frame=%u bits_per_channel=%u\\n",
            outputStreamIndex, (int)outputFormatStatus, outputFormat.mSampleRate, outputFormat.mBytesPerFrame,
            outputFormat.mChannelsPerFrame, outputFormat.mBitsPerChannel);
        }
      }
      free(outputStreamIDs);
    }
  }`);
  source = source.replace(ioCallbackAnchor, `      static uint64_t diagnosticCallbackIndex = 0;
      uint64_t callbackIndex = __atomic_fetch_add(&diagnosticCallbackIndex, 1, __ATOMIC_RELAXED);
      if (callbackIndex < 32) {
        const AudioBuffer *firstBuffer = inInputData->mNumberBuffers > 0 ? &inInputData->mBuffers[0] : NULL;
        fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC callback_clock index=%llu host_ticks=%llu input_ticks=%llu sample_time=%.3f input_sample_time=%.3f frames=%u bytes=%u host_clock_hz=%.0f\\n",
          (unsigned long long)callbackIndex,
          (unsigned long long)(inNow ? inNow->mHostTime : 0),
          (unsigned long long)(inInputTime ? inInputTime->mHostTime : 0),
          inNow ? inNow->mSampleTime : 0, inInputTime ? inInputTime->mSampleTime : 0,
          firstBuffer && _inputFormat.streamDescription->mBytesPerFrame > 0 ? firstBuffer->mDataByteSize / _inputFormat.streamDescription->mBytesPerFrame : 0,
          firstBuffer ? firstBuffer->mDataByteSize : 0, AudioGetHostClockFrequency());
      }
${ioCallbackAnchor}`);
  source = source.replace(callbackAnchor, `${callbackAnchor}
  static atomic_bool didLogBuffers = ATOMIC_VAR_INIT(false);
  bool expectedLog = false;
  if (atomic_compare_exchange_strong(&didLogBuffers, &expectedLog, true)) {
    fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC callback buffer_count=%u tap_bytes_per_frame=%u tap_channels_per_frame=%u\\n",
      inputData->mNumberBuffers, _inputFormat.streamDescription->mBytesPerFrame, _inputFormat.streamDescription->mChannelsPerFrame);
    for (UInt32 bufferIndex = 0; bufferIndex < inputData->mNumberBuffers; bufferIndex += 1) {
      const AudioBuffer *buffer = &inputData->mBuffers[bufferIndex];
      fprintf(stderr, "AUDIO_PITCH_DIAGNOSTIC callback_buffer index=%u channels=%u bytes=%u data=%s assumed_frames=%u\\n",
        bufferIndex, buffer->mNumberChannels, buffer->mDataByteSize, buffer->mData ? "present" : "null",
        _inputFormat.streamDescription->mBytesPerFrame > 0 ? buffer->mDataByteSize / _inputFormat.streamDescription->mBytesPerFrame : 0);
    }
  }`);
  const diagnosticSourcePath = path.join(runRoot, 'native-helper', `audio-tap-diagnostic-${label}.m`);
  const diagnosticBinaryPath = path.join(runRoot, 'native-helper', `lumastream-audio-tap-diagnostic-${label}`);
  await fs.writeFile(diagnosticSourcePath, source, 'utf8');
  execFileSync('clang', [
    '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter',
    '-mmacosx-version-min=13.0', '-arch', 'arm64', '-arch', 'x86_64',
    '-I', path.dirname(nativeHelper.sourcePath),
    diagnosticSourcePath, path.join(path.dirname(nativeHelper.sourcePath), 'pcm-writer.c'), '-o', diagnosticBinaryPath,
    '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'CoreAudio', '-framework', 'AVFoundation',
  ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  return { path: diagnosticBinaryPath, sourceSha256: await sha256(diagnosticSourcePath) };
}

async function runOwnedProcessNativeFixture(runRoot, env) {
  const nativeHelper = await buildCurrentNativeAudioHelper(runRoot);
  const toneFiles = await writeTonePlayerFiles(runRoot);
  const expectedExecutablePath = await fs.realpath(electronBinary);
  const native = {
    helper: {
      clangVersion: nativeHelper.clangVersion,
      architectures: nativeHelper.architectures,
      sourceSha256: nativeHelper.sourceSha256,
      binarySha256: nativeHelper.binarySha256,
      builtWithSystemClang: true,
      sourcePath: 'apps/stream/native/audio-tap/main.m',
    },
    fixture: {
      applicationOwnedByThisTest: true,
      requestedSampleRate: fixtureSampleRate,
      outputSampleRate: null,
      leftToneHz: leftToneHz,
      rightToneHz: rightToneHz,
      amplitude: 0.0075,
      audioOnlyInHiddenWindow: true,
      userDesktopOrSystemCapture: false,
      nativeHelperPidPathValidated: false,
      expectedExecutablePathSha256: createHash('sha256').update(expectedExecutablePath).digest('hex'),
      captureCommand: 'capture --pid <test-owned PID> --path <test-owned Electron executable>',
    },
    capture: {
      attempted: false,
      exitCode: null,
      signalCode: null,
      errorCategory: null,
      errorMessage: '',
      bytes: 0,
      frameCount: 0,
      wallDurationMs: 0,
      observedFrameRate: null,
      sampleRate: 48_000,
      channels: 2,
      channelLayout: 'stereo',
      sampleFormat: 'interleaved float32 little-endian',
      durationSeconds: 0,
      bannerSeen: false,
      frequency: null,
      toneComponents: null,
      artifact: null,
    },
    diagnostic: { built: false, captureAttempted: false, currentHelperLines: [], tapOnlyLines: [], failureCategory: null },
    afplayFixture: {
      applicationOwnedByThisTest: true,
      expectedExecutablePathSha256: null,
      ownedPid: null,
      audioFile: 'afplay-tone-48k-stereo.wav',
      requestedSampleRate: fixtureSampleRate,
      channels: 2,
      leftToneHz,
      rightToneHz,
      amplitude: 0.0075,
      userDesktopOrSystemCapture: false,
      systemCaptureFlagUsed: false,
      nativeHelperPidPathValidated: false,
    },
    afplayCapture: { currentHelper: null, tapOnly: null },
  };
  let tapOnlyDiagnosticHelper = null;
  let toneApplication = null;
  try {
    toneApplication = await startToneApplication(toneFiles.mainPath, env, runRoot);
    const toneContext = await toneApplication.page.evaluate(() => ({ state: window.__toneFixture?.state, sampleRate: window.__toneFixture?.sampleRate }));
    native.fixture.ownedPid = toneApplication.pid;
    native.fixture.outputSampleRate = toneContext.sampleRate;

    assert.equal(toneContext.state, 'running', 'The test-owned tone process AudioContext was not running.');

    // Capture directly by the test-owned PID. The helper checks proc_pidpath
    // against the expected Electron executable; no other process is listed or selected.
    const nativeCapture = await captureOwnedProcessAudio(nativeHelper.path, toneApplication.pid, expectedExecutablePath, nativeCaptureDurationMs);
    native.capture.attempted = true;
    native.capture.exitCode = nativeCapture.exitCode;
    native.capture.signalCode = nativeCapture.signalCode;
    native.capture.errorCategory = nativeCapture.stderrCategory.category;
    native.capture.errorMessage = nativeCapture.stderrCategory.message;
    native.capture.bytes = nativeCapture.rawPcm.byteLength;
    native.capture.frameCount = nativeCapture.rawPcm.byteLength / 8;
    native.capture.wallDurationMs = nativeCapture.elapsedMs;
    native.capture.observedFrameRate = nativeCapture.elapsedMs > 0
      ? Number((native.capture.frameCount * 1000 / nativeCapture.elapsedMs).toFixed(1))
      : null;
    native.capture.durationSeconds = Number((nativeCapture.rawPcm.byteLength / (fixtureSampleRate * 2 * 4)).toFixed(3));
    native.capture.bannerSeen = nativeCapture.hasBanner;
    native.fixture.nativeHelperPidPathValidated = nativeCapture.hasBanner;
    if (nativeCapture.rawPcm.byteLength > 0) {
      assert.equal(nativeCapture.rawPcm.byteLength % 8, 0, 'The native helper returned partial interleaved stereo float32 frames.');
      native.capture.artifact = 'native-helper.raw-f32le';
      await fs.writeFile(path.join(runRoot, native.capture.artifact), nativeCapture.rawPcm);
      if (nativeCapture.rawPcm.byteLength >= fixtureSampleRate * 8) native.capture.frequency = analyzeRawPcm(nativeCapture.rawPcm);
      native.capture.toneComponents = analyzeExpectedTonePair(nativeCapture.rawPcm);
    }
    if (nativeCapture.rawPcm.byteLength >= fixtureSampleRate * 8) {
      try {
        const diagnosticHelper = await buildDiagnosticNativeHelper(runRoot, nativeHelper, { label: 'current-helper' });
        tapOnlyDiagnosticHelper = await buildDiagnosticNativeHelper(runRoot, nativeHelper, { tapOnly: true, label: 'tap-only' });
        native.diagnostic.built = true;
        native.diagnostic.currentHelperSourceSha256 = diagnosticHelper.sourceSha256;
        native.diagnostic.tapOnlySourceSha256 = tapOnlyDiagnosticHelper.sourceSha256;
        const diagnosticCapture = await captureOwnedProcessAudio(diagnosticHelper.path, toneApplication.pid, expectedExecutablePath, 1800);
        native.diagnostic.captureAttempted = true;
        native.diagnostic.currentHelperLines = diagnosticCapture.diagnostics;
        native.diagnostic.currentHelperCapture = {
          exitCode: diagnosticCapture.exitCode,
          wallDurationMs: diagnosticCapture.elapsedMs,
          bytes: diagnosticCapture.rawPcm.byteLength,
          frameCount: diagnosticCapture.rawPcm.byteLength / 8,
          observedFrameRate: diagnosticCapture.elapsedMs > 0 ? Number((diagnosticCapture.rawPcm.byteLength / 8 * 1000 / diagnosticCapture.elapsedMs).toFixed(1)) : null,
          frequency: diagnosticCapture.rawPcm.byteLength >= fixtureSampleRate * 8 ? analyzeRawPcm(diagnosticCapture.rawPcm) : null,
          toneComponents: analyzeExpectedTonePair(diagnosticCapture.rawPcm),
        };
        const tapOnlyCapture = await captureOwnedProcessAudio(tapOnlyDiagnosticHelper.path, toneApplication.pid, expectedExecutablePath, 1800);
        native.diagnostic.tapOnlyLines = tapOnlyCapture.diagnostics;
        native.diagnostic.tapOnlyCapture = {
          exitCode: tapOnlyCapture.exitCode,
          wallDurationMs: tapOnlyCapture.elapsedMs,
          bytes: tapOnlyCapture.rawPcm.byteLength,
          frameCount: tapOnlyCapture.rawPcm.byteLength / 8,
          observedFrameRate: tapOnlyCapture.elapsedMs > 0 ? Number((tapOnlyCapture.rawPcm.byteLength / 8 * 1000 / tapOnlyCapture.elapsedMs).toFixed(1)) : null,
          frequency: tapOnlyCapture.rawPcm.byteLength >= fixtureSampleRate * 8 ? analyzeRawPcm(tapOnlyCapture.rawPcm) : null,
          toneComponents: analyzeExpectedTonePair(tapOnlyCapture.rawPcm),
        };
        if (diagnosticCapture.rawPcm.byteLength === 0 || tapOnlyCapture.rawPcm.byteLength === 0) {
          native.diagnostic.failureCategory = diagnosticCapture.rawPcm.byteLength === 0
            ? diagnosticCapture.stderrCategory.category
            : tapOnlyCapture.stderrCategory.category;
        }
      } catch (error) {
        native.diagnostic.failureCategory = error instanceof Error ? error.name : 'diagnostic-helper-build-failed';
      }
    }
  } finally {
    if (toneApplication) await closeElectron(toneApplication.app);
  }

  {
    const afplayPath = await fs.realpath('/usr/bin/afplay');
    const afplayWavePath = path.join(runRoot, native.afplayFixture.audioFile);
    await writeToneWave(afplayWavePath, native.afplayFixture.amplitude);
    native.afplayFixture.expectedExecutablePathSha256 = createHash('sha256').update(afplayPath).digest('hex');
    const afplayProcess = spawn(afplayPath, ['-v', '1', afplayWavePath], { stdio: 'ignore', windowsHide: true });
    native.afplayFixture.ownedPid = afplayProcess.pid ?? null;
    const afplayClosed = new Promise((resolve) => afplayProcess.once('close', (code, signal) => resolve({ code, signal })));
    try {
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.ok(afplayProcess.pid, 'The test-owned afplay process did not start.');
      const captureAfplay = async (helperPath, name) => {
        const capture = await captureOwnedProcessAudio(helperPath, afplayProcess.pid, afplayPath, 3000);
        const frequency = capture.rawPcm.byteLength >= fixtureSampleRate * 8 ? analyzeRawPcm(capture.rawPcm) : null;
        const artifact = `native-afplay-${name}.raw-f32le`;
        if (capture.rawPcm.byteLength > 0) await fs.writeFile(path.join(runRoot, artifact), capture.rawPcm);
        return {
          exitCode: capture.exitCode,
          wallDurationMs: capture.elapsedMs,
          bytes: capture.rawPcm.byteLength,
          frameCount: capture.rawPcm.byteLength / 8,
          observedFrameRate: capture.elapsedMs > 0 ? Number((capture.rawPcm.byteLength / 8 * 1000 / capture.elapsedMs).toFixed(1)) : null,
          durationSeconds: Number((capture.rawPcm.byteLength / (fixtureSampleRate * 2 * 4)).toFixed(3)),
          errorCategory: capture.stderrCategory.category,
          helperBannerSeen: capture.hasBanner,
          helperPidPathValidated: capture.hasBanner,
          frequency,
          toneComponents: analyzeExpectedTonePair(capture.rawPcm),
          artifact: capture.rawPcm.byteLength > 0 ? artifact : null,
          diagnosticLines: capture.diagnostics,
        };
      };
      native.afplayCapture.currentHelper = await captureAfplay(nativeHelper.path, 'current-helper');
      if (tapOnlyDiagnosticHelper) native.afplayCapture.tapOnly = await captureAfplay(tapOnlyDiagnosticHelper.path, 'tap-only');
      native.afplayFixture.nativeHelperPidPathValidated = native.afplayCapture.currentHelper.helperPidPathValidated;
    } finally {
      if (afplayProcess.exitCode === null && afplayProcess.signalCode === null) afplayProcess.kill('SIGTERM');
      await afplayClosed;
    }
  }

  const hasUsableNativePcm = native.capture.frequency !== null && native.capture.durationSeconds >= 2.5;
  const injectionPcm = hasUsableNativePcm ? await fs.readFile(path.join(runRoot, native.capture.artifact)) : createTonePcm(syntheticWorkletDurationMs / 1000, fixtureSampleRate);
  return {
    ...native,
    workletInput: {
      sourceKind: hasUsableNativePcm ? 'captured-native-helper-pcm' : 'generated-fallback-pcm',
      nativePcmUsed: hasUsableNativePcm,
      sampleRate: fixtureSampleRate,
      channels: 2,
      channelLayout: 'stereo',
      sampleFormat: 'interleaved float32 little-endian',
      durationSeconds: Number((injectionPcm.byteLength / (fixtureSampleRate * 2 * 4)).toFixed(3)),
      base64: injectionPcm.toString('base64'),
    },
  };
}

function makeNativeFixtureSetupFallback(error) {
  const rawPcm = createTonePcm(syntheticWorkletDurationMs / 1000, fixtureSampleRate);
  return {
    helper: {
      builtWithSystemClang: false,
      sourcePath: 'apps/stream/native/audio-tap/main.m',
      setupFailure: error instanceof Error ? error.name : 'native-helper-setup-failed',
    },
    fixture: {
      applicationOwnedByThisTest: false,
      requestedSampleRate: fixtureSampleRate,
      outputSampleRate: null,
      leftToneHz,
      rightToneHz,
      userDesktopOrSystemCapture: false,
      nativeHelperPidPathValidated: false,
      expectedExecutablePathSha256: null,
      captureCommand: 'not issued',
    },
    capture: {
      attempted: false,
      exitCode: null,
      signalCode: null,
      errorCategory: 'native-helper-setup-failed',
      errorMessage: 'The temporary native helper fixture could not be built or started; generated PCM was used for the worklet checks.',
      bytes: 0,
      sampleRate: fixtureSampleRate,
      channels: 2,
      channelLayout: 'stereo',
      sampleFormat: 'interleaved float32 little-endian',
      durationSeconds: 0,
      bannerSeen: false,
      frequency: null,
      artifact: null,
    },
    diagnostic: { built: false, captureAttempted: false, lines: [], failureCategory: null },
    workletInput: {
      sourceKind: 'generated-fallback-pcm',
      nativePcmUsed: false,
      sampleRate: fixtureSampleRate,
      channels: 2,
      channelLayout: 'stereo',
      sampleFormat: 'interleaved float32 little-endian',
      durationSeconds: syntheticWorkletDurationMs / 1000,
      base64: rawPcm.toString('base64'),
    },
  };
}

async function startToneApplication(toneMainPath, env, cwd) {
  const app = await electron.launch({
    executablePath: electronBinary,
    args: ['--autoplay-policy=no-user-gesture-required', toneMainPath],
    env,
    cwd,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__toneFixture?.state === 'running', undefined, { timeout: 15000 });
  return { app, page, pid: app.process().pid };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function writeFixtureBootstrap(runRoot, appDataPath, appRootPath, recorderWebmPath) {
  const bootstrap = path.join(runRoot, 'bootstrap.cjs');
  const mainEntry = path.resolve('apps/stream/out/main/index.js');
  const source = `
const { app, ipcMain } = require('electron');
const childProcess = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
app.setPath('appData', ${JSON.stringify(appDataPath)});
// Match the development launcher app path while keeping all app data inside this fixture.
app.getAppPath = () => ${JSON.stringify(appRootPath)};

const fixture = globalThis.__audioPitchProbe = {
  startedAt: Date.now(),
  startRequests: 0,
  writesRequested: 0,
  bytesRequested: 0,
  writeErrors: [],
  recorderWebmPath: ${JSON.stringify(recorderWebmPath)},
  encoderChildren: [],
  safeSnapshot() {
    return {
      startedAt: this.startedAt,
      startRequests: this.startRequests,
      writesRequested: this.writesRequested,
      bytesRequested: this.bytesRequested,
      writeErrors: [...this.writeErrors],
      encoderChildren: this.encoderChildren.map(({ pid, spawnedAt, progressEvents, bitrateKbps, outTimeMs, errorCategories, exitCode, signalCode, spawnErrorCode }) => ({
        pid, spawnedAt, progressEvents, bitrateKbps, outTimeMs, errorCategories: [...errorCategories], exitCode, signalCode, spawnErrorCode,
      })),
    };
  },
};

function safeErrorCategory(message) {
  const value = String(message).toLowerCase();
  if (/connection refused|econnrefused/.test(value)) return 'connection-refused';
  if (/timed? ?out|timeout|etimedout/.test(value)) return 'timeout';
  if (/invalid data|could not find codec|end of file|ebml/.test(value)) return 'input-probe';
  if (/encoder|videotoolbox|h264|aac/.test(value)) return 'encoder';
  if (/network|rtmp|tls|ssl|socket|broken pipe|epipe/.test(value)) return 'transport';
  return 'other';
}

const originalSpawn = childProcess.spawn;
childProcess.spawn = function(command, args, options) {
  const child = originalSpawn.call(this, command, args, options);
  if (path.basename(String(command)) !== 'ffmpeg' || !Array.isArray(args) || !args.includes('pipe:0') || !args.includes('pipe:2')) return child;
  const record = { pid: child.pid ?? null, spawnedAt: Date.now(), progressEvents: 0, progressBuffer: '', bitrateKbps: 0, outTimeMs: null, errorCategories: [], exitCode: null, signalCode: null, spawnErrorCode: null };
  fixture.encoderChildren.push(record);
  child.stderr.on('data', (chunk) => {
    record.progressBuffer += chunk.toString('utf8');
    const lines = record.progressBuffer.split(/\\r?\\n/);
    record.progressBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('bitrate=')) {
        const value = Number.parseFloat(line.slice('bitrate='.length).replace(/kbits\\/s$/, '').trim());
        if (Number.isFinite(value)) record.bitrateKbps = Math.max(0, Math.round(value));
      }
      if (line.startsWith('out_time_ms=')) {
        const value = Number.parseInt(line.slice('out_time_ms='.length), 10);
        if (Number.isFinite(value)) record.outTimeMs = value;
      }
      if (line.startsWith('progress=') && line !== 'progress=end') record.progressEvents += 1;
      if (/^\\[.*\\] (error|fatal):/i.test(line)) record.errorCategories.push(safeErrorCategory(line));
    }
  });
  child.on('error', (error) => { record.spawnErrorCode = error?.code ?? null; record.errorCategories.push(safeErrorCategory(error?.message ?? '')); });
  child.on('close', (code, signal) => { record.exitCode = code; record.signalCode = signal; });
  return child;
};

const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  if (channel === 'stream:start-output') fixture.startRequests += 1;
  if (channel === 'stream:write-output-chunk') {
    const value = args[1];
    const bytes = value instanceof ArrayBuffer
      ? Buffer.from(value)
      : ArrayBuffer.isView(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : null;
    fixture.writesRequested += 1;
    if (bytes?.byteLength) {
      fixture.bytesRequested += bytes.byteLength;
      fs.appendFileSync(fixture.recorderWebmPath, bytes);
    }
    try { return await listener(event, ...args); }
    catch (error) { fixture.writeErrors.push(safeErrorCategory(error?.message ?? '')); throw error; }
  }
  return listener(event, ...args);
});

require(${JSON.stringify(mainEntry)});
`;
  return fs.writeFile(bootstrap, source, 'utf8').then(() => bootstrap);
}

function probeInitSource() {
  return `(() => {
    const probe = window.__audioPitchRendererProbe = { mediaElements: [], mixerDestinations: [], workletModuleUrls: [], recorderStartAtMs: null, errors: [] };
    try {
      const OriginalAudioContext = window.AudioContext;
      if (!OriginalAudioContext) throw new Error('AudioContext unavailable');
      const originalCreateMediaElementSource = OriginalAudioContext.prototype.createMediaElementSource;
      const originalCreateMediaStreamDestination = OriginalAudioContext.prototype.createMediaStreamDestination;
      OriginalAudioContext.prototype.createMediaElementSource = function(element) {
        const node = originalCreateMediaElementSource.call(this, element);
        probe.mediaElements.push({
        element,
          sampleRate: this.sampleRate,
          state: this.state,
          duration: Number.isFinite(element.duration) ? element.duration : null,
          currentTime: Number.isFinite(element.currentTime) ? element.currentTime : null,
          readyState: element.readyState,
          paused: element.paused,
          muted: element.muted,
          loop: element.loop,
          sourceProtocol: (() => { try { return new URL(element.currentSrc || element.src).protocol; } catch { return ''; } })(),
          sourceExtension: (() => { try { return new URL(element.currentSrc || element.src).pathname.split('.').at(-1) || ''; } catch { return ''; } })(),
        });
        return node;
      };
      OriginalAudioContext.prototype.createMediaStreamDestination = function(...args) {
        const destination = originalCreateMediaStreamDestination.apply(this, args);
        probe.mixerDestinations.push({ context: this, destination });
        const audioWorklet = this.audioWorklet;
        if (audioWorklet && !audioWorklet.__audioPitchInstrumented) {
          const originalAddModule = audioWorklet.addModule.bind(audioWorklet);
          audioWorklet.addModule = (url, ...options) => {
            probe.workletModuleUrls.push(String(url));
            return originalAddModule(url, ...options);
          };
          audioWorklet.__audioPitchInstrumented = true;
        }
        return destination;
      };
      const originalRecorderStart = window.MediaRecorder?.prototype.start;
      if (originalRecorderStart) {
        window.MediaRecorder.prototype.start = function(...args) {
          probe.recorderStartAtMs = performance.now();
          return originalRecorderStart.apply(this, args);
        };
      }
    } catch (error) { probe.errors.push(error instanceof Error ? error.name : 'instrumentation-error'); }
  })();`;
}

async function injectApplicationAudioWorklet(page, rawPcmBase64, options = {}) {
  return page.evaluate(async ({ durationMs, rawPcmBase64, sourceKind }) => {
    const probe = window.__audioPitchRendererProbe;
    const mediaElement = probe?.mediaElements?.[0]?.element;
    if (!probe || !mediaElement) throw new Error('The generated media source was not connected to the mixer.');
    if (!Number.isFinite(probe.recorderStartAtMs)) throw new Error('MediaRecorder start time was not observed.');
    const destinationRecord = probe.mixerDestinations[0];
    const context = destinationRecord?.context;
    if (!context || context.sampleRate !== 48_000) throw new Error('The Stream mixer did not expose its 48 kHz AudioContext.');
    const contextDestinations = probe.mixerDestinations
      .filter((record) => record.context === context)
      .map((record) => record.destination);
    if (contextDestinations.length < 1) throw new Error('The Stream mixer track destination was not captured.');
    if (!probe.workletModuleUrls.some((url) => url.includes('application-audio-input-processor'))) {
      throw new Error('Stream did not register its application-audio worklet module URL.');
    }

    mediaElement.muted = true;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const worklet = new AudioWorkletNode(context, 'stream-application-audio-input', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    const workletDestination = context.createMediaStreamDestination();
    worklet.connect(workletDestination);
    const input = context.createMediaStreamSource(workletDestination.stream);
    const inputGain = context.createGain();
    const gainFilter = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const limiter = context.createDynamicsCompressor();
    const meter = context.createAnalyser();
    const panner = context.createStereoPanner();
    const programGain = context.createGain();
    const trackGain = context.createGain();
    inputGain.gain.value = 1;
    gainFilter.gain.value = 1;
    panner.pan.value = 0;
    programGain.gain.value = 1;
    trackGain.gain.value = 1;
    input.connect(inputGain);
    inputGain.connect(gainFilter);
    gainFilter.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(meter);
    meter.connect(panner);
    panner.connect(programGain);
    programGain.connect(trackGain);
    // This is the actual track-1 MediaStreamAudioDestinationNode used by the
    // Stream AudioMixerEngine and cloned into MediaRecorder's capture stream.
    trackGain.connect(contextDestinations[0]);

    const sampleRate = context.sampleRate;
    const framesPerChunk = sampleRate / 10;
    const nativeBytes = Uint8Array.from(atob(rawPcmBase64), (value) => value.charCodeAt(0));
    if (nativeBytes.byteLength === 0 || nativeBytes.byteLength % 8 !== 0) throw new Error('The synthetic input PCM was not aligned stereo float32.');
    const totalFrames = nativeBytes.byteLength / 8;
    const availableChunks = Math.floor(totalFrames / framesPerChunk);
    const chunkCount = Math.min(Math.ceil(durationMs / 100), availableChunks);
    if (chunkCount < 10) throw new Error('The synthetic input PCM did not contain enough complete audio blocks.');
    const phaseStartAtMs = performance.now();
    let framesSent = 0;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const byteStart = chunkIndex * framesPerChunk * 8;
      const chunk = nativeBytes.slice(byteStart, byteStart + framesPerChunk * 8);
      worklet.port.postMessage(chunk.buffer, [chunk.buffer]);
      framesSent += framesPerChunk;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const phaseEndAtMs = performance.now();
    // Let the processor drain its final queued frames before disconnecting it.
    await new Promise((resolve) => setTimeout(resolve, 350));
    worklet.disconnect();
    input.disconnect();
    inputGain.disconnect();
    gainFilter.disconnect();
    compressor.disconnect();
    limiter.disconnect();
    meter.disconnect();
    panner.disconnect();
    programGain.disconnect();
    trackGain.disconnect();
    workletDestination.stream.getTracks().forEach((track) => track.stop());
    workletDestination.disconnect();
    return {
      workletProcessor: 'stream-application-audio-input',
      workletAssetLoaded: true,
      workletAssetProtocol: (() => { try { return new URL(probe.workletModuleUrls.find((url) => url.includes('application-audio-input-processor'))).protocol; } catch { return ''; } })(),
      sampleFormat: 'interleaved float32 little-endian',
      sourceKind,
      sampleRate,
      channels: 2,
      framesSent,
      packetCount: chunkCount,
      phaseStartAfterRecorderSeconds: Number(((phaseStartAtMs - probe.recorderStartAtMs) / 1000).toFixed(3)),
      phaseDurationSeconds: Number(((phaseEndAtMs - phaseStartAtMs) / 1000).toFixed(3)),
      mixerDestinationCount: contextDestinations.length,
      mediaSourceMutedForPhase: mediaElement.muted,
    };
  }, { durationMs: options.durationMs ?? syntheticWorkletDurationMs, rawPcmBase64, sourceKind: options.sourceKind ?? 'generated-fallback' });
}

async function inject44100ApplicationAudioWorklet(page) {
  return page.evaluate(async ({ leftFrequencyHz, rightFrequencyHz, durationMs }) => {
    const probe = window.__audioPitchRendererProbe;
    const mediaElement = probe?.mediaElements?.[0]?.element;
    const applicationModuleUrl = probe?.workletModuleUrls?.find((url) => url.includes('application-audio-input-processor'));
    if (!probe || !mediaElement || !applicationModuleUrl) throw new Error('The Stream application-audio worklet module URL was not available for the 44.1 kHz probe.');
    const mixerContext = probe.mixerDestinations[0]?.context;
    const mixerDestination = probe.mixerDestinations.find((record) => record.context === mixerContext)?.destination;
    if (!mixerContext || mixerContext.sampleRate !== 48_000 || !mixerDestination) throw new Error('The Stream track 1 mixer destination was unavailable.');
    mediaElement.muted = true;
    await new Promise((resolve) => setTimeout(resolve, 100));

    const context = new AudioContext({ sampleRate: 44_100 });
    const requestedSampleRate = 44_100;
    await context.audioWorklet.addModule(applicationModuleUrl);
    const worklet = new AudioWorkletNode(context, 'stream-application-audio-input', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    const workletDestination = context.createMediaStreamDestination();
    worklet.connect(workletDestination);
    const input = mixerContext.createMediaStreamSource(workletDestination.stream);
    const inputGain = mixerContext.createGain();
    const gainFilter = mixerContext.createGain();
    const compressor = mixerContext.createDynamicsCompressor();
    const limiter = mixerContext.createDynamicsCompressor();
    const meter = mixerContext.createAnalyser();
    const panner = mixerContext.createStereoPanner();
    const programGain = mixerContext.createGain();
    const trackGain = mixerContext.createGain();
    panner.pan.value = 0;
    input.connect(inputGain);
    inputGain.connect(gainFilter);
    gainFilter.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(meter);
    meter.connect(panner);
    panner.connect(programGain);
    programGain.connect(trackGain);
    trackGain.connect(mixerDestination);

    const sampleRate = context.sampleRate;
    const framesPerChunk = Math.floor(sampleRate / 10);
    const chunkCount = Math.ceil(durationMs / 100);
    let framesSent = 0;
    const phaseStartAtMs = performance.now();
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const samples = new Float32Array(framesPerChunk * 2);
      for (let frame = 0; frame < framesPerChunk; frame += 1) {
        const time = (framesSent + frame) / sampleRate;
        samples[frame * 2] = Math.sin(2 * Math.PI * leftFrequencyHz * time) * 0.4;
        samples[frame * 2 + 1] = Math.sin(2 * Math.PI * rightFrequencyHz * time) * 0.4;
      }
      worklet.port.postMessage(samples.buffer, [samples.buffer]);
      framesSent += framesPerChunk;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const phaseEndAtMs = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 350));
    worklet.disconnect();
    workletDestination.stream.getTracks().forEach((track) => track.stop());
    workletDestination.disconnect();
    input.disconnect();
    inputGain.disconnect();
    gainFilter.disconnect();
    compressor.disconnect();
    limiter.disconnect();
    meter.disconnect();
    panner.disconnect();
    programGain.disconnect();
    trackGain.disconnect();
    await context.close();
    return {
      requestedSampleRate,
      actualWorkletContextSampleRate: sampleRate,
      mixerContextSampleRate: mixerContext.sampleRate,
      workletProcessor: 'stream-application-audio-input',
      sampleFormat: 'interleaved float32 little-endian',
      channels: 2,
      leftToneHz: leftFrequencyHz,
      rightToneHz: rightFrequencyHz,
      framesSent,
      packetCount: chunkCount,
      phaseStartAfterRecorderSeconds: Number(((phaseStartAtMs - probe.recorderStartAtMs) / 1000).toFixed(3)),
      phaseDurationSeconds: Number(((phaseEndAtMs - phaseStartAtMs) / 1000).toFixed(3)),
      mediaSourceMutedForPhase: mediaElement.muted,
    };
  }, { leftFrequencyHz: leftToneHz, rightFrequencyHz: rightToneHz, durationMs: 2000 });
}

function startReceiver(port, destination, recordingPath) {
  const receiver = spawn(ffmpegExecutable, [
    '-hide_banner', '-loglevel', 'info', '-nostats',
    '-listen', '1', '-i', destination,
    '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'flv', recordingPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const state = { pid: receiver.pid ?? null, inputOpened: false, errorCategories: [], exitCode: null, signalCode: null, stderrTail: '' };
  receiver.stderr.on('data', (chunk) => {
    const value = chunk.toString('utf8');
    state.stderrTail = (state.stderrTail + value).slice(-4000);
    if (/^Input #0, flv,/m.test(state.stderrTail)) state.inputOpened = true;
    for (const line of value.split(/\r?\n/)) {
      if (/^\[.*\] (error|fatal):/i.test(line)) state.errorCategories.push(safeErrorCategory(line));
    }
  });
  receiver.on('error', (error) => state.errorCategories.push(safeErrorCategory(error.message)));
  receiver.on('close', (code, signal) => { state.exitCode = code; state.signalCode = signal; });
  return { process: receiver, state };
}

function safeErrorCategory(message) {
  const value = String(message).toLowerCase();
  if (/connection refused|econnrefused/.test(value)) return 'connection-refused';
  if (/timed? ?out|timeout|etimedout/.test(value)) return 'timeout';
  if (/invalid data|could not find codec|end of file|ebml/.test(value)) return 'input-probe';
  if (/encoder|videotoolbox|h264|aac/.test(value)) return 'encoder';
  if (/network|rtmp|tls|ssl|socket|broken pipe|epipe/.test(value)) return 'transport';
  return 'other';
}

async function waitForTcpListener(pid, port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const output = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 1000 });
      if (output.includes(':' + port + ' (LISTEN)')) return true;
    } catch { /* The listener may not have opened yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); resolve(); }, 3000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function closeElectron(app) {
  if (!app) return;
  let child;
  try { child = app.process(); } catch { return; }
  let closed = false;
  let closeTimer;
  try {
    await Promise.race([
      app.close().then(() => { closed = true; }),
      new Promise((resolve) => { closeTimer = setTimeout(resolve, 18000); }),
    ]);
  } catch { /* The renderer may already have exited. */ }
  if (closeTimer) clearTimeout(closeTimer);
  if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 4000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function fftMagnitudes(samples, channel, frameStart, frameCount, channelCount, sampleRate, band = { minimumHz: 100, maximumHz: 2000 }) {
  let size = 1;
  while (size < frameCount) size *= 2;
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const usedFrames = Math.min(frameCount, size);
  for (let index = 0; index < usedFrames; index += 1) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, usedFrames - 1));
    real[index] = samples[(frameStart + index) * channelCount + channel] * hann;
  }

  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imag[index], imag[reversed]] = [imag[reversed], imag[index]];
    }
  }

  for (let length = 2; length <= size; length *= 2) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let factorReal = 1;
      let factorImag = 0;
      const half = length / 2;
      for (let offset = 0; offset < half; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + half;
        const oddReal = real[oddIndex] * factorReal - imag[oddIndex] * factorImag;
        const oddImag = real[oddIndex] * factorImag + imag[oddIndex] * factorReal;
        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;
        const nextReal = factorReal * stepReal - factorImag * stepImag;
        factorImag = factorReal * stepImag + factorImag * stepReal;
        factorReal = nextReal;
      }
    }
  }

  const maximumBin = Math.floor(size / 2);
  const minimumBin = Math.max(1, Math.floor(band.minimumHz * size / sampleRate));
  const maximumSearchBin = Math.min(maximumBin - 1, Math.ceil(band.maximumHz * size / sampleRate));
  const powers = new Float64Array(maximumSearchBin + 1);
  let peakBin = minimumBin;
  for (let bin = minimumBin; bin <= maximumSearchBin; bin += 1) {
    const power = real[bin] * real[bin] + imag[bin] * imag[bin];
    powers[bin] = power;
    if (power > powers[peakBin]) peakBin = bin;
  }
  const left = Math.log(Math.max(powers[peakBin - 1] ?? 0, Number.MIN_VALUE));
  const center = Math.log(Math.max(powers[peakBin], Number.MIN_VALUE));
  const right = Math.log(Math.max(powers[peakBin + 1] ?? 0, Number.MIN_VALUE));
  const denominator = left - 2 * center + right;
  const offset = denominator === 0 ? 0 : 0.5 * (left - right) / denominator;
  return { frequencyHz: Number(((peakBin + offset) * sampleRate / size).toFixed(3)), magnitude: Number(Math.sqrt(powers[peakBin]).toPrecision(5)) };
}

function analyzeRawPcm(rawBytes, sampleRate = fixtureSampleRate, channelCount = 2, requestedStartSeconds = null) {
  const usableBytes = rawBytes.byteLength - (rawBytes.byteLength % (4 * channelCount));
  const sampleCount = usableBytes / 4;
  const frames = sampleCount / channelCount;
  if (frames < sampleRate) throw new Error('Decoded audio was shorter than one second.');
  const floatSamples = new Float32Array(usableBytes / 4);
  for (let index = 0; index < floatSamples.length; index += 1) floatSamples[index] = rawBytes.readFloatLE(index * 4);
  const windowFrames = Math.min(sampleRate * 3, 65_536, frames);
  const requestedStartFrame = requestedStartSeconds === null ? Math.floor((frames - windowFrames) / 2) : Math.floor(requestedStartSeconds * sampleRate);
  const startFrame = Math.max(0, Math.min(frames - windowFrames, requestedStartFrame));
  const peaks = Array.from({ length: channelCount }, (_, channel) => fftMagnitudes(floatSamples, channel, startFrame, windowFrames, channelCount, sampleRate));
  return {
    sampleRate,
    channels: channelCount,
    decodedDurationSeconds: Number((frames / sampleRate).toFixed(3)),
    analysisWindowSeconds: Number((windowFrames / sampleRate).toFixed(3)),
    peaks,
  };
}

function analyzeExpectedTonePair(rawBytes, sampleRate = fixtureSampleRate, channelCount = 2) {
  const usableBytes = rawBytes.byteLength - (rawBytes.byteLength % (4 * channelCount));
  const sampleCount = usableBytes / 4;
  const frames = sampleCount / channelCount;
  if (frames < sampleRate) return null;
  const floatSamples = new Float32Array(usableBytes / 4);
  for (let index = 0; index < floatSamples.length; index += 1) floatSamples[index] = rawBytes.readFloatLE(index * 4);
  const windowFrames = Math.min(65_536, frames);
  const startFrame = Math.max(0, frames - windowFrames);
  const channels = Array.from({ length: channelCount }, (_, channel) => ({
    channel,
    leftTone: fftMagnitudes(floatSamples, channel, startFrame, windowFrames, channelCount, sampleRate, { minimumHz: 350, maximumHz: 540 }),
    rightTone: fftMagnitudes(floatSamples, channel, startFrame, windowFrames, channelCount, sampleRate, { minimumHz: 550, maximumHz: 760 }),
  }));
  return {
    sampleRate,
    channels,
    decodedDurationSeconds: Number((frames / sampleRate).toFixed(3)),
    analysisWindowSeconds: Number((windowFrames / sampleRate).toFixed(3)),
  };
}

function decodeAudioToPcm(filePath, phaseWindows = {}) {
  const pcm = execFileSync(ffmpegExecutable, [
    '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '2', '-ar', String(fixtureSampleRate),
    '-f', 'f32le', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const overall = analyzeRawPcm(pcm);
  return {
    ...overall,
    phaseWindows: Object.fromEntries(Object.entries(phaseWindows).map(([name, startSeconds]) => [
      name, analyzeRawPcm(pcm, fixtureSampleRate, 2, startSeconds),
    ])),
  };
}

function probeMedia(filePath, ffprobeExecutable) {
  const raw = execFileSync(ffprobeExecutable, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath,
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 10000 });
  const probe = JSON.parse(raw);
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  return {
    format: probe.format?.format_name ?? 'unknown',
    durationSeconds: Number.parseFloat(audio?.duration ?? probe.format?.duration ?? '0') || null,
    video: video ? { codec: video.codec_name ?? 'unknown', width: video.width ?? null, height: video.height ?? null, frameRate: video.avg_frame_rate ?? null } : null,
    audio: audio ? {
      codec: audio.codec_name ?? 'unknown',
      sampleRate: Number.parseInt(audio.sample_rate ?? '', 10) || null,
      channels: audio.channels ?? null,
      channelLayout: audio.channel_layout ?? 'unknown',
    } : null,
  };
}

function makeSyntheticMediaSource(id, assetId) {
  return {
    id,
    name: 'Synthetic 440 and 660 Hz stereo tone',
    kind: 'media',
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    balance: 0,
    audioMonitoring: 'off',
    audioTracks: [1],
    transform: { x: 0, y: 0, width: 1, height: 1 },
    assetId,
    assetExtension: 'wav',
    mediaKind: 'audio',
    loop: true,
    restartPlaybackWhenActive: true,
  };
}

async function main() {
  assert.equal(process.platform, 'darwin', 'This reproduction is scoped to the active macOS report.');
  await fs.access(ffmpegExecutable);
  const ffmpegVersionOutput = execFileSync(ffmpegExecutable, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 10000 });
  const ffmpegVersion = ffmpegVersionOutput.split(/\r?\n/)[0] ?? 'unknown';
  const rtmpHelp = execFileSync(ffmpegExecutable, ['-hide_banner', '-h', 'protocol=rtmp'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(rtmpHelp, /-listen\s+<int>/, 'The Stream FFmpeg build does not expose RTMP listen mode.');
  const realFfmpegPath = await fs.realpath(ffmpegExecutable);
  const ffprobeExecutable = path.join(path.dirname(realFfmpegPath), 'ffprobe');
  await fs.access(ffprobeExecutable);

  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const runRoot = path.join(outputRoot, `run-${stamp}-${process.pid}`);
  const appDataPath = path.join(runRoot, 'app-data');
  const streamDataDirectory = path.join(appDataPath, 'LumaStream');
  const mediaDirectory = path.join(streamDataDirectory, 'media');
  const assetId = 'b49d8a3e-47a4-4e2c-86a7-6e2d130cd548';
  const sourceId = 'b49d8a3e-47a4-4e2c-86a7-6e2d130cd549';
  const wavPath = path.join(mediaDirectory, `${assetId}.wav`);
  const recorderWebmPath = path.join(runRoot, 'media-recorder.webm');
  const rtmpRecordingPath = path.join(runRoot, 'stream-output.flv');
  await fs.mkdir(mediaDirectory, { recursive: true });
  await writeToneWave(wavPath);
  await fs.writeFile(recorderWebmPath, Buffer.alloc(0));

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let nativeFixture;
  try {
    nativeFixture = await runOwnedProcessNativeFixture(runRoot, env);
  } catch (error) {
    nativeFixture = makeNativeFixtureSetupFallback(error);
  }

  const port = await freePort();
  const destination = `rtmp://127.0.0.1:${port}/live/synthetic-audio-pitch-probe`;
  await fs.writeFile(path.join(streamDataDirectory, 'stream-settings.json'), JSON.stringify({
    version: 1,
    service: 'custom',
    serverId: '',
    customServer: destination,
    streamKeyEncoding: 'plain',
    streamKey: '',
    youtube: { title: '', description: '', privacy: 'unlisted', broadcastId: '', scheduledStartTime: '' },
    zoom: { selectedMeetingId: '', topic: '', startTime: '', durationMinutes: 60 },
  }, null, 2));

  const bootstrap = await writeFixtureBootstrap(runRoot, appDataPath, path.resolve('apps/stream'), recorderWebmPath);
  const { process: receiver, state: receiverState } = startReceiver(port, destination, rtmpRecordingPath);
  const receiverListening = await waitForTcpListener(receiver.pid, port);
  assert.ok(receiverListening, 'The isolated loopback FFmpeg receiver did not bind its local port.');

  const debugPort = await freePort();
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [`--remote-debugging-port=${debugPort}`, '--autoplay-policy=no-user-gesture-required', bootstrap],
    env,
    cwd: path.resolve('apps/stream'),
    timeout: 30000,
  });

  const rendererErrors = [];
  let page;
  let stopButtonClicked = false;
  let workspaceSnapshot = null;
  let projectSnapshot = null;
  let rendererSnapshot = null;
  let mainSnapshot = null;
  let runtimeVersions = null;
  let failure = null;
  try {
    page = await app.firstWindow();
    page.on('pageerror', (error) => rendererErrors.push({ name: error.name }));
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push({ kind: 'console', text: message.text().slice(0, 180) });
    });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.program-panel canvas.composition-canvas').waitFor({ state: 'visible', timeout: 30000 });
    const initialWorkspace = await page.evaluate(() => window.streamApi.loadProject());
    const project = structuredClone(initialWorkspace.project);
    const scene = project.scenes.find((candidate) => candidate.id === project.activeSceneId)
      ?? project.scenes.find((candidate) => candidate.id === project.liveSceneId);
    assert.ok(scene, 'The isolated project did not contain an active scene.');
    scene.sources.push(makeSyntheticMediaSource(sourceId, assetId));
    await page.evaluate(async ({ collectionId, profileId, projectValue }) => {
      await window.streamApi.saveProject(collectionId, profileId, projectValue);
    }, { collectionId: initialWorkspace.activeCollectionId, profileId: initialWorkspace.activeProfileId, projectValue: project });

    await page.addInitScript({ content: probeInitSource() });
    await page.reload();
    await page.locator('.program-panel canvas.composition-canvas').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => (window.__audioPitchRendererProbe?.mediaElements.length ?? 0) > 0, undefined, { timeout: 20000 });
    await page.waitForFunction(() => {
      const element = window.__audioPitchRendererProbe?.mediaElements[0]?.element;
      return element && element.readyState >= 2 && !element.paused && !element.muted;
    }, undefined, { timeout: 20000 });

    workspaceSnapshot = await page.evaluate(async () => {
      const workspace = await window.streamApi.loadProject();
      const sources = workspace.project.scenes.flatMap((candidate) => candidate.sources);
      const fixtureSources = sources.filter((source) => source.id === 'b49d8a3e-47a4-4e2c-86a7-6e2d130cd549');
      return {
        projectOutput: {
          width: workspace.project.output.width,
          height: workspace.project.output.height,
          frameRate: workspace.project.output.frameRate,
          streamAudioTrack: workspace.project.output.streamAudioTrack,
        },
        sourceCount: sources.length,
        audioSourceCount: sources.filter((source) => ['microphone', 'desktop-audio', 'system-audio', 'application-audio', 'browser'].includes(source.kind)
          || (source.kind === 'media' && source.mediaKind === 'audio')).length,
        syntheticSourceCount: fixtureSources.length,
        sourceKind: fixtureSources[0]?.kind ?? 'missing',
        sourceMediaKind: fixtureSources[0]?.mediaKind ?? 'missing',
        sourceMuted: fixtureSources[0]?.muted ?? null,
        sourceAudioTracks: fixtureSources[0]?.audioTracks ?? [],
        service: (await window.streamApi.loadStreamServiceSettings()).service,
        keyConfigured: false,
      };
    });
    assert.equal(workspaceSnapshot.service, 'custom');
    assert.equal(workspaceSnapshot.syntheticSourceCount, 1);
    assert.equal(workspaceSnapshot.sourceKind, 'media');
    assert.equal(workspaceSnapshot.sourceMediaKind, 'audio');
    assert.equal(workspaceSnapshot.audioSourceCount, 1, 'Only the generated audio media source may feed the mixer.');
    assert.deepEqual(workspaceSnapshot.sourceAudioTracks, [1]);

    await expect(page.getByRole('button', { name: 'Start Streaming', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(page.getByText('Stream settings', { exact: true })).toBeVisible({ timeout: 10000 });
    const settingsDialog = page.locator('.stream-modal');
    await settingsDialog.getByRole('button', { name: 'Start Streaming', exact: true }).click();
    await expect(settingsDialog).toBeHidden({ timeout: 15000 });
    await expect(page.locator('.controls-dock .control-output-row')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(mediaOnlyObservationMs);
    const workletInputSnapshot = await injectApplicationAudioWorklet(page, nativeFixture.workletInput.base64, {
      sourceKind: nativeFixture.workletInput.sourceKind,
      durationMs: Math.min(syntheticWorkletDurationMs, nativeFixture.workletInput.durationSeconds * 1000),
    });
    const worklet44100Snapshot = await inject44100ApplicationAudioWorklet(page);
    await page.waitForTimeout(400);
    const stopButton = page.getByRole('button', { name: /^(Cancel|Stop) Output$/ });
    await expect(stopButton).toBeVisible({ timeout: 10000 });
    await stopButton.click();
    stopButtonClicked = true;
    await page.getByRole('button', { name: 'Start Streaming', exact: true }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);

    rendererSnapshot = await page.evaluate(() => ({
      mediaElements: (window.__audioPitchRendererProbe?.mediaElements ?? []).map(({ element, sampleRate }) => ({
        sampleRate,
        state: element.ownerDocument ? 'connected' : 'detached',
        duration: Number.isFinite(element.duration) ? element.duration : null,
        currentTime: Number.isFinite(element.currentTime) ? element.currentTime : null,
        readyState: element.readyState,
        paused: element.paused,
        muted: element.muted,
        loop: element.loop,
        sourceProtocol: (() => { try { return new URL(element.currentSrc || element.src).protocol; } catch { return ''; } })(),
        sourceExtension: (() => { try { return new URL(element.currentSrc || element.src).pathname.split('.').at(-1) || ''; } catch { return ''; } })(),
      })),
      instrumentationErrors: window.__audioPitchRendererProbe?.errors ?? [],
      statuses: [...(window.__audioPitchStatuses ?? [])],
    })).then((snapshot) => ({ ...snapshot, workletInput: workletInputSnapshot, worklet44100: worklet44100Snapshot }));
    mainSnapshot = await app.evaluate(() => globalThis.__audioPitchProbe.safeSnapshot());
    runtimeVersions = await app.evaluate(() => ({
      electron: process.versions.electron ?? null,
      chromium: process.versions.chrome ?? null,
      node: process.versions.node ?? null,
      v8: process.versions.v8 ?? null,
    }));
    assert.ok(mainSnapshot.writesRequested >= 3, 'Expected several nonempty MediaRecorder chunks to reach Stream main.');
    assert.ok(mainSnapshot.bytesRequested > 20_000, 'Expected captured MediaRecorder WebM bytes.');
    assert.ok(mainSnapshot.encoderChildren.some((child) => child.progressEvents > 0), 'Expected Stream FFmpeg to encode the recorder chunks.');
    assert.equal(mainSnapshot.writeErrors.length, 0, 'Stream main rejected a MediaRecorder WebM chunk.');
    assert.ok(stopButtonClicked, 'The synthetic output must be stopped through the Stream controls.');

    await closeElectron(app);
    await stopChild(receiver);
    const receiverCloseState = receiverState.exitCode !== null || receiverState.signalCode !== null;
    assert.ok(receiverCloseState, 'The local RTMP receiver did not close after Stream stopped.');
    await fs.access(recorderWebmPath);
    await fs.access(rtmpRecordingPath);

    const recorderProbe = probeMedia(recorderWebmPath, ffprobeExecutable);
    const streamProbe = probeMedia(rtmpRecordingPath, ffprobeExecutable);
    const workletWindowStartSeconds = workletInputSnapshot.phaseStartAfterRecorderSeconds + 0.35;
    const worklet44100WindowStartSeconds = worklet44100Snapshot.phaseStartAfterRecorderSeconds + 0.35;
    const phaseWindows = {
      mediaOnly: 0.75,
      applicationWorklet: workletWindowStartSeconds,
      worklet44100: worklet44100WindowStartSeconds,
    };
    const recorderPcm = decodeAudioToPcm(recorderWebmPath, phaseWindows);
    const streamPcm = decodeAudioToPcm(rtmpRecordingPath, phaseWindows);
    const recorderBytes = await fs.stat(recorderWebmPath);
    const streamBytes = await fs.stat(rtmpRecordingPath);
    const sourceBaseline = {
      sampleRate: fixtureSampleRate,
      channels: 2,
      durationSeconds: fixtureDurationSeconds,
      expectedLeftHz: leftToneHz,
      expectedRightHz: rightToneHz,
    };
    const workletExpectedLeftHz = nativeFixture.workletInput.nativePcmUsed ? nativeFixture.capture.frequency?.peaks[0]?.frequencyHz ?? leftToneHz : leftToneHz;
    const workletExpectedRightHz = nativeFixture.workletInput.nativePcmUsed ? nativeFixture.capture.frequency?.peaks[1]?.frequencyHz ?? rightToneHz : rightToneHz;
    const nativeLeftHz = nativeFixture.capture.frequency?.peaks[0]?.frequencyHz ?? null;
    const nativeRightHz = nativeFixture.capture.frequency?.peaks[1]?.frequencyHz ?? null;
    const frequencyErrorHz = {
      nativeHelperLeftFromFixture: nativeLeftHz === null ? null : Number((nativeLeftHz - leftToneHz).toFixed(3)),
      nativeHelperRightFromFixture: nativeRightHz === null ? null : Number((nativeRightHz - rightToneHz).toFixed(3)),
      mediaOnlyRecorderLeft: Number((recorderPcm.phaseWindows.mediaOnly.peaks[0].frequencyHz - leftToneHz).toFixed(3)),
      mediaOnlyRecorderRight: Number((recorderPcm.phaseWindows.mediaOnly.peaks[1].frequencyHz - rightToneHz).toFixed(3)),
      workletRecorderLeftFromInput: Number((recorderPcm.phaseWindows.applicationWorklet.peaks[0].frequencyHz - workletExpectedLeftHz).toFixed(3)),
      workletRecorderRightFromInput: Number((recorderPcm.phaseWindows.applicationWorklet.peaks[1].frequencyHz - workletExpectedRightHz).toFixed(3)),
      mediaOnlyStreamLeft: Number((streamPcm.phaseWindows.mediaOnly.peaks[0].frequencyHz - leftToneHz).toFixed(3)),
      mediaOnlyStreamRight: Number((streamPcm.phaseWindows.mediaOnly.peaks[1].frequencyHz - rightToneHz).toFixed(3)),
      workletStreamLeftFromInput: Number((streamPcm.phaseWindows.applicationWorklet.peaks[0].frequencyHz - workletExpectedLeftHz).toFixed(3)),
      workletStreamRightFromInput: Number((streamPcm.phaseWindows.applicationWorklet.peaks[1].frequencyHz - workletExpectedRightHz).toFixed(3)),
      worklet44100RecorderLeft: Number((recorderPcm.phaseWindows.worklet44100.peaks[0].frequencyHz - leftToneHz).toFixed(3)),
      worklet44100RecorderRight: Number((recorderPcm.phaseWindows.worklet44100.peaks[1].frequencyHz - rightToneHz).toFixed(3)),
      worklet44100StreamLeft: Number((streamPcm.phaseWindows.worklet44100.peaks[0].frequencyHz - leftToneHz).toFixed(3)),
      worklet44100StreamRight: Number((streamPcm.phaseWindows.worklet44100.peaks[1].frequencyHz - rightToneHz).toFixed(3)),
    };
    const nativeScaleFactor = nativeLeftHz === null ? null : Number((nativeLeftHz / leftToneHz).toFixed(6));
    const expected48kFrom44kRatio = 48_000 / 44_100;
    const nativePitchFinding = {
      fixtureHz: { left: leftToneHz, right: rightToneHz },
      helperHz: nativeLeftHz === null || nativeRightHz === null ? null : { left: nativeLeftHz, right: nativeRightHz },
      helperToneComponents: nativeFixture.capture.toneComponents,
      scaleFactor: nativeScaleFactor,
      expected48kOver44100Ratio: Number(expected48kFrom44kRatio.toFixed(6)),
      matches48kOver44100Ratio: nativeScaleFactor === null ? null : Math.abs(nativeScaleFactor - expected48kFrom44kRatio) < 0.003,
      helperPCMDeclaredSampleRate: nativeFixture.capture.sampleRate,
      fixtureRenderedSampleRate: nativeFixture.fixture.outputSampleRate,
    };
    const afplayPitchFinding = {
      fixture: {
        sampleRate: nativeFixture.afplayFixture.requestedSampleRate,
        channels: nativeFixture.afplayFixture.channels,
        leftToneHz: nativeFixture.afplayFixture.leftToneHz,
        rightToneHz: nativeFixture.afplayFixture.rightToneHz,
        amplitude: nativeFixture.afplayFixture.amplitude,
      },
      currentHelper: nativeFixture.afplayCapture.currentHelper?.toneComponents ?? null,
      tapOnlyDiagnosticHelper: nativeFixture.afplayCapture.tapOnly?.toneComponents ?? null,
    };
    const summary = {
      passed: true,
      scope: 'test-owned macOS app-audio tap → raw float32 PCM → Stream application-audio worklet/mixer → MediaRecorder → Stream FFmpeg → loopback RTMP recording; media source and 44.1 kHz worklet phases included',
      source: sourceBaseline,
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        darwinRelease: execFileSync('uname', ['-r'], { encoding: 'utf8' }).trim(),
        macOSVersion: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
        electron: electronVersion,
        chromium: runtimeVersions.chromium,
        node: runtimeVersions.node,
        v8: runtimeVersions.v8,
        ffmpeg: ffmpegVersion,
      },
      isolation: {
        appData: 'temporary run-local appData',
        destination: '127.0.0.1 loopback RTMP only; synthetic path omitted',
        sourceCount: workspaceSnapshot.sourceCount,
        audioSourceCount: workspaceSnapshot.audioSourceCount,
        syntheticMediaSourceCount: workspaceSnapshot.syntheticSourceCount,
        nativeProcessTapUsed: nativeFixture.capture.bytes > 0,
        capturedPID: nativeFixture.fixture.ownedPid ?? null,
        nativeHelperVerifiedPidPath: nativeFixture.fixture.nativeHelperPidPathValidated,
        systemCaptureFlagUsed: false,
        userProcessOrDesktopAudioCaptured: false,
        youtubeOrExternalIngest: false,
      },
      nativeAudioHelper: {
        ...nativeFixture,
        workletInput: {
          sourceKind: nativeFixture.workletInput.sourceKind,
          nativePcmUsed: nativeFixture.workletInput.nativePcmUsed,
          sampleRate: nativeFixture.workletInput.sampleRate,
          channels: nativeFixture.workletInput.channels,
          channelLayout: nativeFixture.workletInput.channelLayout,
          sampleFormat: nativeFixture.workletInput.sampleFormat,
          durationSeconds: nativeFixture.workletInput.durationSeconds,
        },
      },
      nativePitchFinding,
      afplayPitchFinding,
      mixerInput: {
        mediaElementRouteCreated: rendererSnapshot.mediaElements.length > 0,
        audioContextSampleRates: [...new Set(rendererSnapshot.mediaElements.map((element) => element.sampleRate))],
        mediaElementStates: rendererSnapshot.mediaElements.map(({ sampleRate, state, duration, currentTime, readyState, paused, muted, loop, sourceProtocol, sourceExtension }) => ({
          sampleRate, state, duration, currentTime, readyState, paused, muted, loop, sourceProtocol, sourceExtension,
        })),
        instrumentationErrors: rendererSnapshot.instrumentationErrors,
      },
      syntheticApplicationAudioWorklet: {
        ...rendererSnapshot.workletInput,
        nativeOSCaptureHelperUsed: nativeFixture.workletInput.nativePcmUsed,
        mixerRoute: 'Stream application-audio AudioWorkletNode → MediaStreamAudioDestination → MediaStreamAudioSourceNode → gain/filter/compressor/limiter/panner/program/track-1 route → actual Stream AudioMixerEngine track-1 destination',
        phaseWindowStartSeconds: workletWindowStartSeconds,
        inputPeakHz: { left: workletExpectedLeftHz, right: workletExpectedRightHz },
        note: 'The input was the test-owned native helper raw stream when a process tap was granted; otherwise it was a generated fallback. It was posted to the exact worklet registered by Stream and fed into the actual Stream track-1 destination.',
      },
      applicationAudioWorklet44100: {
        ...rendererSnapshot.worklet44100,
        phaseWindowStartSeconds: worklet44100WindowStartSeconds,
        mixerRoute: 'new requested-44.1 kHz worklet context → MediaStreamAudioSourceNode in Stream’s 48 kHz mixer context → same track-1 mixer destination',
      },
      mediaRecorder: {
        artifact: path.basename(recorderWebmPath),
        bytes: recorderBytes.size,
        probe: recorderProbe,
        decodedPcm: recorderPcm,
      },
      streamOutput: {
        artifact: path.basename(rtmpRecordingPath),
        bytes: streamBytes.size,
        probe: streamProbe,
        decodedPcm: streamPcm,
        receiver: {
          protocol: 'rtmp',
          host: '127.0.0.1',
          port,
          inputOpened: receiverState.inputOpened,
          errorCategories: receiverState.errorCategories,
          exitCode: receiverState.exitCode,
          signalCode: receiverState.signalCode,
        },
      },
      frequencyErrorHz,
      ffmpeg: mainSnapshot,
      note: 'MediaRecorder WebM and the RTMP recording were decoded to 48 kHz float PCM. Peak frequency comes from a Hann-windowed FFT per channel. The test-owned app and all media are synthetic; the native helper command captured only that app PID and descendants.',
    };
    assert.ok(recorderProbe.audio, 'MediaRecorder WebM did not contain an audio stream.');
    assert.ok(streamProbe.audio, 'The loopback RTMP recording did not contain an audio stream.');
    assert.equal(recorderProbe.audio.channels, 2, 'MediaRecorder output was not stereo.');
    assert.equal(streamProbe.audio.channels, 2, 'Stream FFmpeg output was not stereo.');
    assert.equal(streamProbe.audio.sampleRate, fixtureSampleRate, 'Stream FFmpeg output sample rate differed from 48 kHz.');
    assert.ok(recorderPcm.decodedDurationSeconds >= 5, 'MediaRecorder output duration was shorter than five seconds.');
    assert.ok(streamPcm.decodedDurationSeconds >= 5, 'Stream output duration was shorter than five seconds.');
    assert.ok(Math.abs(frequencyErrorHz.mediaOnlyRecorderLeft) <= 2, `MediaRecorder media-only left pitch drifted by ${frequencyErrorHz.mediaOnlyRecorderLeft} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.mediaOnlyRecorderRight) <= 2, `MediaRecorder media-only right pitch drifted by ${frequencyErrorHz.mediaOnlyRecorderRight} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.mediaOnlyStreamLeft) <= 2, `Stream media-only left pitch drifted by ${frequencyErrorHz.mediaOnlyStreamLeft} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.mediaOnlyStreamRight) <= 2, `Stream media-only right pitch drifted by ${frequencyErrorHz.mediaOnlyStreamRight} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.workletRecorderLeftFromInput) <= 2, `MediaRecorder changed worklet left frequency by ${frequencyErrorHz.workletRecorderLeftFromInput} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.workletRecorderRightFromInput) <= 2, `MediaRecorder changed worklet right frequency by ${frequencyErrorHz.workletRecorderRightFromInput} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.workletStreamLeftFromInput) <= 2, `Stream FFmpeg changed worklet left frequency by ${frequencyErrorHz.workletStreamLeftFromInput} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.workletStreamRightFromInput) <= 2, `Stream FFmpeg changed worklet right frequency by ${frequencyErrorHz.workletStreamRightFromInput} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.worklet44100RecorderLeft) <= 2, `MediaRecorder 44.1 kHz worklet left pitch drifted by ${frequencyErrorHz.worklet44100RecorderLeft} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.worklet44100RecorderRight) <= 2, `MediaRecorder 44.1 kHz worklet right pitch drifted by ${frequencyErrorHz.worklet44100RecorderRight} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.worklet44100StreamLeft) <= 2, `Stream 44.1 kHz worklet left pitch drifted by ${frequencyErrorHz.worklet44100StreamLeft} Hz.`);
    assert.ok(Math.abs(frequencyErrorHz.worklet44100StreamRight) <= 2, `Stream 44.1 kHz worklet right pitch drifted by ${frequencyErrorHz.worklet44100StreamRight} Hz.`);
    // The helper’s input is the boundary under investigation: report its
    // measured tone and ratio without treating a native pitch shift as a
    // harness failure. The output phases below still prove whether downstream
    // worklet/MediaRecorder/FFmpeg stages preserve the samples they receive.
    assert.ok(recorderPcm.peaks[0].frequencyHz < recorderPcm.peaks[1].frequencyHz, 'MediaRecorder channels did not preserve left/right tone ordering.');
    assert.ok(streamPcm.peaks[0].frequencyHz < streamPcm.peaks[1].frequencyHz, 'Stream output channels did not preserve left/right tone ordering.');
    const nativeInputPreservesChannelOrder = !nativeFixture.workletInput.nativePcmUsed || workletExpectedLeftHz < workletExpectedRightHz;
    if (nativeInputPreservesChannelOrder) {
      assert.ok(recorderPcm.phaseWindows.applicationWorklet.peaks[0].frequencyHz < recorderPcm.phaseWindows.applicationWorklet.peaks[1].frequencyHz, 'MediaRecorder worklet phase did not preserve left/right tone ordering.');
      assert.ok(streamPcm.phaseWindows.applicationWorklet.peaks[0].frequencyHz < streamPcm.phaseWindows.applicationWorklet.peaks[1].frequencyHz, 'Stream worklet phase did not preserve left/right tone ordering.');
    }
    assert.ok(rendererSnapshot.mediaElements.some((element) => element.sourceProtocol === 'lumastream:'
      && element.readyState >= 2 && !element.paused && element.currentTime > mediaOnlyObservationMs / 1000),
    'The mixer did not advance playback of the generated media asset.');

    await fs.writeFile(path.join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({
      runRoot: path.relative(root, runRoot),
      runtime: summary.runtime,
      mediaRecorder: { bytes: summary.mediaRecorder.bytes, probe: summary.mediaRecorder.probe, decodedPcm: summary.mediaRecorder.decodedPcm },
      streamOutput: { bytes: summary.streamOutput.bytes, probe: summary.streamOutput.probe, decodedPcm: summary.streamOutput.decodedPcm },
      nativeAudioHelper: summary.nativeAudioHelper,
      nativePitchFinding: summary.nativePitchFinding,
      afplayPitchFinding: summary.afplayPitchFinding,
      applicationAudioWorklet44100: summary.applicationAudioWorklet44100,
      frequencyErrorHz: summary.frequencyErrorHz,
      receiver: summary.streamOutput.receiver,
    }, null, 2));
  } catch (error) {
    failure = error;
    mainSnapshot = mainSnapshot ?? await app.evaluate(() => globalThis.__audioPitchProbe.safeSnapshot()).catch(() => null);
    rendererSnapshot = rendererSnapshot ?? (page ? await page.evaluate(() => window.__audioPitchRendererProbe ?? null).catch(() => null) : null);
    const diagnostic = {
      passed: false,
      errorName: error instanceof Error ? error.name : 'Error',
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : 'Synthetic audio pitch reproduction failed.',
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        electron: electronVersion,
        ffmpeg: ffmpegVersion,
      },
      project: workspaceSnapshot,
      nativeAudioHelper: {
        helper: nativeFixture.helper,
        fixture: nativeFixture.fixture,
        capture: nativeFixture.capture,
        diagnostic: nativeFixture.diagnostic,
        afplayFixture: nativeFixture.afplayFixture,
        afplayCapture: nativeFixture.afplayCapture,
        workletInput: {
          sourceKind: nativeFixture.workletInput.sourceKind,
          nativePcmUsed: nativeFixture.workletInput.nativePcmUsed,
          durationSeconds: nativeFixture.workletInput.durationSeconds,
          sampleRate: nativeFixture.workletInput.sampleRate,
        },
      },
      renderer: rendererSnapshot,
      main: mainSnapshot,
      receiver: {
        protocol: 'rtmp',
        host: '127.0.0.1',
        port,
        inputOpened: receiverState.inputOpened,
        errorCategories: receiverState.errorCategories,
        exitCode: receiverState.exitCode,
        signalCode: receiverState.signalCode,
      },
      rendererErrors,
      artifacts: {
        source: path.basename(wavPath),
        mediaRecorder: path.basename(recorderWebmPath),
        streamOutput: path.basename(rtmpRecordingPath),
        nativeHelperPcm: nativeFixture.capture.artifact,
        afplayCurrentHelperPcm: nativeFixture.afplayCapture.currentHelper?.artifact ?? null,
        afplayTapOnlyPcm: nativeFixture.afplayCapture.tapOnly?.artifact ?? null,
      },
      note: 'Only generated tone media and loopback RTMP were used; credential and external media paths are absent from this report.',
    };
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'failure.json'), JSON.stringify(diagnostic, null, 2));
    console.error(JSON.stringify({ runRoot: path.relative(root, runRoot), ...diagnostic }, null, 2));
  } finally {
    if (page) {
      const stopButton = page.getByRole('button', { name: /^(Cancel|Stop) Output$/ });
      if (await stopButton.isVisible().catch(() => false)) {
        await stopButton.click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(500).catch(() => undefined);
      }
    }
    await closeElectron(app);
    await stopChild(receiver);
  }
  if (failure) throw failure;
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Synthetic audio pitch reproduction failed.');
  process.exitCode = 1;
});
