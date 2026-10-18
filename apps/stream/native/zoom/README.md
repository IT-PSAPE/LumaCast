# LumaStream Zoom Meeting SDK addon

This Node-API addon adapts `zoom-sdk-bridge.h` to a JavaScript singleton. It is
loaded by the Electron main process, not the renderer. The native layer accepts
only the Zoom Public Client ID; OAuth tokens, ZAK values, and client secrets are
provided at runtime and are never stored by this addon.

## Build inputs

Install `node-addon-api` and `node-gyp` in the stream workspace/toolchain, then
build for the same platform and architecture as the Electron app. Set
`ZOOM_MEETING_SDK_ROOT` to the platform SDK directory before building. On
Windows x64, point it at the extracted SDK's `x64` directory (containing `h`,
`lib/sdk.lib`, and `bin`). On macOS, point it at the extracted SDK's `ZoomSDK`
directory (containing `ZoomSDK.framework` and its companion frameworks).

```powershell
$env:ZOOM_MEETING_SDK_ROOT = 'C:\sdk\zoom-meeting-sdk\x64'
npx node-gyp rebuild --directory apps/stream/native/zoom --target=44.0.0 --dist-url=https://electronjs.org/headers
```

On macOS, set the same variable to the SDK's `ZoomSDK` directory and run the
build on macOS. Use the corresponding Electron version installed by LumaStream in place of
`44.0.0` when it changes. The addon uses Node-API, but the SDK platform binary
and architecture still have to match the packaged application.

Expected output: `apps/stream/native/zoom/build/Release/lumastream-zoom-sdk.node`.
Keep the SDK packages outside source control. Windows needs the SDK `lib`
directory at build time and the vendor runtime DLLs from its `bin` directory at
runtime. Package those DLLs beside the app executable or in a directory added
to the process DLL search path before the addon is loaded. macOS needs the
`ZoomSDK.framework` from the SDK package available at link and runtime; embed it
in the app bundle and ensure its framework runpath is signed with the app.
LumaStream packaging must place the `.node` file and native SDK runtime files in
an unpacked resources location so Electron can load them outside ASAR.

## JavaScript API

```js
const zoom = require('./build/Release/lumastream-zoom-sdk.node');
zoom.initialize(publicAppKey, ({ state, message }) => onZoomEvent(state, message));
zoom.startMeeting(meetingNumber, zak, zoomUserId, displayName);
zoom.startProductionStudio(width, height);
zoom.sendVideoFrame(i420Buffer, width, height);
zoom.sendAudioFrame(pcm16Buffer, sampleRate, channels);
zoom.stop();
```

Each operation except `stop` returns `{ ok, message }` from the platform bridge.
SDK events are delivered through a bounded Node-API thread-safe queue, so SDK
callback threads never invoke JavaScript directly; a full queue drops the new
status event. Video is packed I420 with even dimensions. Audio is interleaved
16-bit PCM at 32 or 48 kHz, with one or two channels.

The native module intentionally has no stub for unsupported platforms. Build
and load it only on Windows x64 or macOS with a matching Zoom SDK package.
