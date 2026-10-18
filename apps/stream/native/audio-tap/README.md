# Stream macOS audio tap helper

A single-file Objective-C command-line tool that gives LumaStream the same
application and system audio capture on macOS that `AudioLoopback.exe` provides
on Windows. It uses Core Audio process taps (`AudioHardwareCreateProcessTap`),
has no third-party dependencies or Swift runtime, and is built as a universal
binary by `node script/prepare-application-audio.mjs` (which `npm run dev` and
`npm run dist:mac` call for you) using only the Xcode Command Line Tools:

```sh
clang -fobjc-arc -O2 -mmacosx-version-min=13.0 -arch arm64 -arch x86_64 main.m \
  -framework Foundation -framework AppKit -framework CoreAudio -framework AVFoundation \
  -o build/lumastream-audio-tap
```

## Contract

- `lumastream-audio-tap list` writes a JSON array of `{ "pid", "name", "path" }`
  entries for running applications (regular and menu-bar apps) to stdout.
- `lumastream-audio-tap capture --pid <pid> --path <expected-executable-path>`
  writes raw interleaved stereo float32 little-endian PCM at 48 kHz to stdout.
  The helper checks that the process still runs the executable returned by
  `list`, taps the process and all of its live descendants (so browser and
  game audio services are included), and re-reads that process tree every
  second so late-starting helpers are picked up.
- `lumastream-audio-tap capture --system` writes the whole system output mix in
  the same format, excluding LumaStream's own processes so monitored program
  audio is not captured twice.
- Capture ends when stdin reaches EOF or, for `--pid`, when the tapped process
  exits. Diagnostics go to stderr.

## Requirements

Process taps exist on macOS 14.2 and newer; older systems can list
applications but capture exits with code 3 and a version diagnostic. The first
capture prompts for the "System Audio Recording Only" privacy permission,
which the user can later change under System Settings › Privacy & Security ›
Screen & System Audio Recording. A refused tap exits with code 4.
