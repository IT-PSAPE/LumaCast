# @lumacast/ndi-native

Native Node-API bridge for sending renderer paint frames over NDI.

## Build

From repository root:

```bash
npm run build:ndi-native
```

`npm install` no longer auto-builds this addon. The main app can install and run without it, and NDI stays disabled until you build the addon explicitly.

## Runtime requirements

- NDI runtime/library must be installed on the host machine.
- Optional override env vars:
  - `CAST_NDI_RUNTIME_PATH`: absolute path to NDI dynamic library file.
  - `NDI_RUNTIME_DIR`: directory containing NDI dynamic library.

Typical library names searched:

- macOS: `libndi.dylib`
- Windows: `Processing.NDI.Lib.x64.dll`
- Linux: `libndi.so.6`, `libndi.so`

## Windows toolchain

- Use Visual Studio / Build Tools 2026 with the `Desktop development with C++` workload when building on current Windows machines.
- The package now uses `node-gyp` 12.1+, which is the first line with Visual Studio 2026 support.

## API

- `initializeSender({ senderName, width, height, withAlpha })`
- `sendBgraFrame(senderName, frame, width, height, stride)`
- `getSenderConnections(senderName, timeoutMs?)`
- `destroySender(senderName?)`

- `sendBgraFrame` accepts BGRA bitmap order.
- `sendRgbaFrame` accepts RGBA bitmap order and sends RGBA or RGBX frames so the renderer's byte layout stays intact.
- When alpha is disabled, the bridge normalizes the fourth byte to opaque `255` before NDI send.
- When the installed NDI runtime exposes `NDIlib_send_send_video_async_v2`, frame submission uses the async send path with the addon's ping-pong buffers and falls back to synchronous send otherwise.
- Audio frames enter a bounded, lossless FIFO per sender and are submitted from a dedicated native thread. Web Audio keeps supplying the sample clock while NDI synthesizes A/V timecodes; native audio and video clocking remain disabled so the new thread does not add a second timing source.
