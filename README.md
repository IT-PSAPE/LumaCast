# LumaCast Prototype

Cross-platform Electron prototype for a ProPresenter-style presentation workflow focused on reusable content, slide rendering, and NDI output.

The repository is a workspace of six apps and their shared packages:

- `apps/cast` — LumaCast, the NDI presentation app
- `apps/cloud` — LumaCloud, the suite manager: installs, updates, downgrades, and removes the other apps
- `apps/flux` — Lumaflux, the photo editor
- `apps/chord` — LumaChord, the lyric-video maker: audio plus timed lyric cues rendered and exported as video
- `apps/soundboard` — LumaSoundboard, a standalone desktop app with named boards, audio import, and per-sound play, pause, stop, and removal
- `apps/stream` — LumaStream, a Windows-first live production app with scenes, capture sources, imported media, audio mixing, configurable WebM/MP4/Matroska recording, and RTMP/RTMPS output

Each app is self-contained: it ships its own main process, renderer, and
`package.json` (which owns its release version), and it shares only the
headless packages under `packages/`. No app imports another, and no package
imports an app; `tool/check_electron_architecture.mjs` enforces both.

## Stack

- Electron + TypeScript
- React
- React-Konva
- SQLite via `node:sqlite`
- Native NDI bridge in `packages/ndi-native`

## Requirements

- Node.js `22.13.0` or newer (CI pins exactly `22.13.0`)
- npm `11.6.2` or newer (`package.json#packageManager`)

For the native NDI addon build, also install the toolchain for your
platform. CI compiles and packages the addon on Windows, macOS, and Linux;
the transport tests use a mock NDI runtime. Installed applications still
need the platform NDI runtime described below.

- **Windows**: Visual Studio Build Tools with the C++
  workload, Python `3.12` or newer, and an NDI Runtime/Tools install
  providing `Processing.NDI.Lib.x64.dll`.
- **macOS**: Xcode Command Line Tools, and an NDI SDK/
  runtime install providing `libndi.dylib`.
- **Linux**: a C++17 toolchain, and an NDI SDK/runtime
  install providing `libndi.so`.

## Install

`package-lock.json` at the repository root is the only lockfile. The root
package is the workspace root; `apps/*` and `packages/*` are its members.

For local development:

```bash
npm install
```

For CI or any clean reproducible install:

```bash
npm ci
```

## Run

Start an app in development:

```bash
npm run dev:cast
npm run dev:cloud
npm run dev:flux
npm run dev:chord
npm run dev:soundboard
npm run dev:stream
```

`npm run dev` is an alias for `npm run dev:cast`.

LumaSoundboard saves named boards and imported audio copies in its own local
user-data directory. Playbacks may overlap within a board. Pause preserves the
position; Stop returns to the selected start; switching boards stops the previous
board. Each sound has a seekable playhead, saved start/end timestamps, a loop
toggle, and an optional shortcut. Timestamp fields accept seconds,
`mm:ss.sss`, or `hh:mm:ss.sss`; an empty End uses the audio duration. Loop repeats
the selected range or the full audio by default. Shortcuts toggle playback on
the active board only while this app has focus and no field is being edited.
Supported imports are MP3, WAV, OGG, FLAC, M4A, AAC, and Opus; playback reports files the
desktop decoder cannot read.

LumaStream stores its scene collection and imported images, video, and audio in
its own local data directory. It currently supports display/window capture,
selectable camera and microphone devices, still images and timed image
slideshows with ordered slides, adjustable duration and looping, scene transitions, source positioning
and visibility with exact transform and aspect-preserving fit controls, audio
balance and monitoring/mixing, per-capture cursor behavior, custom canvas sizes
and fractional frame rates, WebM, MP4, or Matroska recording with
configurable bitrates, RTMP/RTMPS streaming with configurable audio and video
bitrates and a selectable audio track, six-track source routing and multitrack
recording, a 5–60 second replay buffer, HTTP(S) browser sources, and multiple
  named scene collections that can be created, duplicated, renamed, switched,
  and deleted, with portable collection bundles that include referenced media,
  plus independent output profiles for shared video, recording, streaming, and
  hotkey settings that can be imported and exported.
Scene editing includes bounded undo/redo, source copy/paste, delete, and the
common fit, stretch, center, and reset transform shortcuts.
Scene thumbnails show the composed scene and a vertical input-activity meter.
In Studio Mode, source and Mixer edits stay in Preview until Transition commits
them to Program, including edits to the same scene already on air. Captures stay
live, while Preview-only video, audio, and slideshow timers wait for Program.
Unchanged shared sources keep their playback position across transitions.
Disconnected cameras show color bars; unavailable assets and inputs have source
indicators, and action notices appear at the bottom right.
The app is Windows-first and is built independently from OBS. Per-source crop,
color correction, opacity, blur, chroma key, audio monitoring, microphone noise
suppression, gain, noise gate, expander, compressor, and limiter controls are available.
Global hotkeys can toggle streaming controls, recording, and replay capture.
Browser sources can route page audio through the per-source mixer.
YouTube account connection uses a Google OAuth Desktop app client ID supplied
as `LUMASTREAM_GOOGLE_CLIENT_ID` when building LumaStream. Connected accounts
can select or create upcoming streams and stream to YouTube over RTMPS; OAuth
tokens are stored with the operating system's secure credential storage. The
YouTube panel lists scheduled streams with thumbnails and shows viewer counts,
input health, and provider notices. Account and manual RTMPS controls are in its
Settings dialog; new streams are created in a separate dialog. YouTube's Data
API does not expose the general Content ID warning feed.
The Zoom Meeting SDK uses a Public Client ID supplied as
`LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID` when building LumaStream. Connected Zoom
accounts can select or create scheduled meetings; OAuth tokens are stored with
the operating system's secure credential storage. The Zoom panel keeps the
selected meeting and output actions in view; account settings and meeting
creation open in separate dialogs. The native Meeting SDK sender
joins with the connected user's ZAK and sends raw I420 video and PCM audio from
the program canvas and mixer through Production Studio. It runs alongside
YouTube RTMPS and local recording. The SDK app key, OAuth access token, and
user's ZAK serve separate purposes. Production Studio can send only when the
signed-in user is the meeting host or co-host. Zoom requires app review before
joining meetings outside the SDK app owner's account.
The Controls panel contains streaming, recording, and replay actions, with
independent stop or cancel controls for each active destination. Global settings
are available from the title bar. File > Convert to MP4 and Settings > Advanced
repackage MKV or WebM recordings without re-encoding, keeping the original file.
Zoom's PKCE guide lists Meeting SDK 7.0.2 as preferred. Use the exact native
Windows/macOS packages and version supplied through the Zoom Marketplace, then
check their platform changelog and minimum-version policy before packaging.
Windows builds require Visual Studio 2019 or later; macOS 7.x builds require
Xcode 26 or later. Zoom's macOS SDK does not support the App Sandbox.
Set `ZOOM_MEETING_SDK_ROOT` to the extracted platform package's `x64` directory
on Windows or its `ZoomSDK` directory on macOS. `npm run prepare:zoom-native
--workspace apps/stream` builds the Electron Node-API addon and stages the vendor
runtime for packaging; the pack and distribution commands run it automatically.
The SDK archive and generated runtime remain outside source control, and the
Zoom license notices are copied into the app's third-party notices.
Configure the Zoom OAuth app with public PKCE enabled, the loopback redirect
`http://127.0.0.1/oauth2callback`, and the `meeting:read:list_meetings`,
`meeting:write:meeting`, `user:read:user`, and `user:read:zak` scopes. Zoom's
OAuth guide documents refresh-token requests with Basic client authentication
using the client ID and secret, but does not document a secretless refresh flow
for public clients. For local development, set `LUMASTREAM_ZOOM_CLIENT_ID` and
`LUMASTREAM_ZOOM_CLIENT_SECRET` in ignored `.env.local`; the development launcher
uses the confidential client for token exchange and refresh. These credentials
are never inserted into application bundles. Packaged builds use the public
client flow and will ask users to reconnect after the access token expires
(normally after one hour). A production rollout that preserves one-time
connection needs a hosted refresh service. Disconnecting removes this device's
encrypted credentials.
See [Zoom's public-client PKCE guidance](https://developers.zoom.us/blog/public-pkce/),
[Meeting SDK authorization](https://developers.zoom.us/docs/meeting-sdk/auth/),
the [Windows SDK requirements](https://developers.zoom.us/docs/meeting-sdk/windows/start-join-mtg-webinar/pkce/)
and [macOS SDK requirements](https://developers.zoom.us/docs/meeting-sdk/macos/get-started/),
and the [Windows](https://developers.zoom.us/docs/meeting-sdk/windows/default-ui/advanced-features/production-studio-mode/)
and [macOS](https://developers.zoom.us/docs/meeting-sdk/macos/custom-ui/advanced-features/production-studio-mode/)
Production Studio guides.
Multiview monitors the live program and scene previews while keeping program
audio and the full-resolution output canvas on the live scene.
The program canvas remains stable across monitor layouts and can open in a
separate aspect-contained projector window.
Streaming and MP4 output can use Media Foundation, NVIDIA NVENC, Intel Quick
Sync, AMD AMF, or software OpenH264 with supported rate-control settings.
Dedicated game capture, plugins, and full filter-catalog parity are outside
Stream's current scope. Virtual camera is deferred; other advanced output controls
remain outside the current implementation. The bundled
FFmpeg runtime is LGPL-licensed. Its notice and provenance are packaged; this private checkout
does not yet include the complete corresponding source package required before
distributing a binary.

Package a Windows soundboard installer with
`npm run dist:win --workspace apps/soundboard`. Output is in
`apps/soundboard/dist/`.

Build production assets:

```bash
npm run build           # all six apps
npm run build:cast
npm run build:cloud
npm run build:flux
npm run build:chord
npm run build:soundboard
npm run build:stream
```

Package the Windows Stream installer with `npm run dist:stream:win`. Output is
in `apps/stream/dist/`.

Preview the built renderer bundle:

```bash
npm run preview
```

## Testing

Run unit tests:

```bash
npm test
```

Run end-to-end tests:

```bash
npm run test:e2e
```

For Flux's real desktop interaction suite, including an isolated 1,000-photo library:

```bash
npm run build:flux
npm run e2e --workspace apps/flux
```

It creates temporary photos and catalogs, preserves source files, and writes screenshots and timing results to `apps/flux/output/playwright/`. Use Node.js 22.13 or newer, as required by the workspace.

Check the architecture rules against the working tree:

```bash
npm run check:architecture
```

Run the architecture rule fixtures:

```bash
npm run test:architecture
```

`npm run test:e2e` now bootstraps itself from a fresh shell:

- builds the app
- installs the Playwright Chromium browser if needed
- starts the preview server automatically
- writes Playwright artifacts to `test-results/`

## Native NDI addon

Build the addon explicitly when you need the real NDI path:

```bash
npm run build:ndi-native
```

Clean or rebuild it:

```bash
npm run clean:ndi-native
npm run rebuild:ndi-native
```

If the addon is missing or the runtime library cannot be found, the app falls back to a no-op sender and logs a warning.

## CI and releases

- One entry point, [.github/workflows/ci.yml](.github/workflows/ci.yml), runs on every pull request and push to `main`. Its `detect` job works out which apps the change affects ([tool/ci/affected-apps.mjs](tool/ci/affected-apps.mjs): the app's own tree, any package it imports directly or transitively, or shared tooling) and calls the common pipeline, [.github/workflows/ci-release.yml](.github/workflows/ci-release.yml), once per affected app. A documentation-only change runs nothing. A manual run takes an `apps` input: `all`, `affected`, or a list such as `cast,flux`.
- CI is reproducible locally. `npm run ci -- --app cast` runs exactly the validation steps CI runs for Cast (add `--e2e` for the Playwright suite); `npm run ci:affected` runs the apps the gate would select for your diff against `origin/main`; `npm run ci:apps -- --base origin/main` only prints the selection. Use the Node version in `.nvmrc` (`nvm use`) to match CI. Only packaging for Windows and Linux needs the hosted runners.
- Releases are stable only; there is no prerelease workflow.
- A push to `main` releases an app only when that app's own `package.json` version (`apps/<app>/package.json`) is a stable semantic version **strictly greater** than its baseline. The baseline is the app manifest as it stood before the push; Cast falls back to the previous root `package.json` while the migration is in flight, and Cloud and Flux have no such history, so their first push validates and publishes nothing. A manual dispatch is CI-only. An unchanged version ends after validation.
- The version release is immutable, tagged `<app>-v<version>`, and carries the installers. A permanent `<app>-feed` release carries generic updater metadata only: its installer URLs are absolute and point at the immutable `<app>-v<version>` release that produced them.
- All three apps ship `provider: generic` against their own `<app>-feed` release. Only legacy shipped Cast versions read the repository's "latest release" slot (`provider: github`); that slot is still taken only by a Cast version release (`make_latest=true`), and no other app or feed release ever takes it.
- Cast keeps its identity through the move: product name `LumaCast`, app id `com.lumacast.app`, current version `0.2.0`.
- Release note grouping is configured in [.github/release.yml](.github/release.yml).

See [docs/ai-agent-commits.md](docs/ai-agent-commits.md) for commit and release conventions, and [docs/release-setup.md](docs/release-setup.md) for signing, packaging, and platform-support detail.

## Multiple selection

The suite shares selection behavior through [`@lumacast/selection`](packages/selection/README.md): Ctrl/Cmd-click toggles entries, Shift-click selects list ranges, and selection stays separate from playback or the active editor item. Select several entries and use one bulk action or Delete where supported. Canvas and timeline movement preserves the selected items' offsets; reorderable lists preserve their relative order. Each app keeps its own permissions, confirmations, undo, and lock rules.

Flux's **Remove from library** preserves original files. Soundboard removal deletes managed audio copies. Cloud's selected-app actions require explicit management actions and retain its per-app grants; selecting cards never downloads or installs anything.

In Flux, opening Export fixes the batch to the photos selected at that moment. Later selection changes do not change that batch. Failed editor previews offer **Retry preview**; edits and export copies preserve the original files.

Photo selection, ratings, batch adjustments, and exports support up to 10,000 photos per operation. Rating and adjustment batches validate every target before saving; a missing target leaves the entire batch unchanged. Successful imports clear search and rating filters so the new photos are visible.

## Updater status

LumaCloud owns update checks and notifications. Cast has no runtime updater or update-check menu. Cloud remains available in the system tray after its window closes and checks for newer installed-app versions every six hours when **Check for updates in background** is enabled. Notifications open Cloud; downloading and installing require an explicit action. **Check for updates on launch** independently controls the startup catalog check. Cloud's own updater uses `cloud-feed` with automatic downloading and installation disabled. It also installs, updates, downgrades, and removes managed apps after a per-app permission grant (see [ADR-0116](docs/adr/0116-cloud-update-supervision.md)). Existing app-isolated release feeds remain available for release metadata and older shipped clients.

## Architecture

- `apps/cast/main/`: Electron main process, IPC, and NDI integration
- `apps/cast/renderer/`: React workbench and editor surfaces
- `packages/kernel/`: dependency-free primitives shared by every package
- `packages/composition/`: the visual-document domain model and headless scene contract
- `packages/automation/`: the cue/macro/trigger model and deterministic runtime
- `packages/commands/`: shortcut and app-menu command vocabulary
- `packages/protocol/`: the versioned IPC surface, codecs, and snapshot patches
- `packages/persistence-sqlite/`: SQLite schema, migrations, and the `CastRepository` store
- `packages/engine/`: the NDI output-engine runtime and diagnostics
- `packages/playback/`: headless playback decisions
- `packages/canvas/`: the Konva render/editing layer
- `packages/selection/`: shared selection transitions, React hooks, group ordering, and bulk-action helpers used across the suite
- `packages/ui/`: shared, domain-agnostic React UI primitives and the Tailwind theme (`@lumacast/ui/theme.css`)
- `packages/suite/`: the renderer-safe LumaCast suite model (app registry, version rules, release-catalog and updater-metadata parsing, app-state derivation) that LumaCloud renders
- `packages/markers/`: timed lyric cues (CSV/LRC/SRT parsing and formatting, timestamp helpers, format detection) shared by LumaCast's audio-sync markers and LumaChord's lyric-video import/export
- `packages/ndi-native/`: native Node-API bridge for NDI

`packages/canvas` and `packages/ui` are the only packages that may use React and
React DOM for presentation; only `packages/canvas` may additionally use Konva and
React-Konva (Electron stays banned for both). `packages/ui` depends only on
`packages/kernel`, so a shared control can never couple itself to a domain model
or to one app.

Cast is the visual reference for the suite. Stream uses the same semantic colors,
typography, buttons, and menus from `@lumacast/ui`; its styles define production
layout without a separate palette or text scale.

See [AGENTS.md](AGENTS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full layering rules and per-package charters, and [docs/adr/0043-root-apps-and-per-app-release-pipeline.md](docs/adr/0043-root-apps-and-per-app-release-pipeline.md) for the app layout and release pipeline decisions, and [docs/adr/0044-lumacloud-suite-manager.md](docs/adr/0044-lumacloud-suite-manager.md) for the LumaCloud suite manager.

## Notes

- `node:sqlite` still emits an experimental/release-candidate warning on current Node 22+ lines. That warning is expected.
- The persistence database is stored in the Electron user data path as `lumacast.sqlite`. Older installs with a `recast.sqlite` file are renamed automatically on first launch.
