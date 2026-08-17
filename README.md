# LumaCast Prototype

Cross-platform Electron prototype for a ProPresenter-style presentation workflow focused on reusable content, slide rendering, and NDI output.

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
platform. Only the Windows path below is currently exercised by CI; the
`packages/ndi-native` build configuration also contains macOS and Linux
paths, but they are unverified — see `docs/release-setup.md` for the full
platform/architecture matrix.

- **Windows** (CI-verified): Visual Studio Build Tools with the C++
  workload, Python `3.12` or newer, and an NDI Runtime/Tools install
  providing `Processing.NDI.Lib.x64.dll`.
- **macOS** (unverified by CI): Xcode Command Line Tools, and an NDI SDK/
  runtime install providing `libndi.dylib`.
- **Linux** (unverified by CI): a C++17 toolchain, and an NDI SDK/runtime
  install providing `libndi.so`.

## Install

For local development:

```bash
npm install
```

For CI or any clean reproducible install:

```bash
npm ci
```

## Run

Start the Electron app in development:

```bash
npm run dev
```

Build production assets:

```bash
npm run build
```

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

- Pull requests and every branch push run the validation workflow in [.github/workflows/ci.yml](.github/workflows/ci.yml) (typecheck, architecture check, unit tests, Playwright e2e).
- A version bump pushed to `main` triggers [.github/workflows/release.yml](.github/workflows/release.yml); the same pushed to `testing` triggers [.github/workflows/prerelease.yml](.github/workflows/prerelease.yml) (`vX.Y.Z-beta.N`). Both currently build and release **Windows only** — see [docs/release-setup.md](docs/release-setup.md) for the full platform/architecture matrix and why macOS/Linux are unverified.
- Release note grouping is configured in [.github/release.yml](.github/release.yml).

See [docs/ai-agent-commits.md](docs/ai-agent-commits.md) for commit and release conventions, and [docs/release-setup.md](docs/release-setup.md) for signing, packaging, and platform-support detail.

## Updater status

Installed builds now check GitHub Releases for updates on startup and expose a manual `Check for Updates…` action from the native application menu. The updater flow is wired through `electron-updater`, so release artifacts and updater metadata published by the release workflow are consumed directly by the app.

## Architecture

- `app/main/`: Electron main process, IPC, and NDI integration
- `app/renderer/`: React workbench and editor surfaces
- `app/core/`: shared domain types and IPC contracts
- `app/database/`: SQLite schema and data access
- `packages/ndi-native/`: native Node-API bridge for NDI

## Notes

- `node:sqlite` still emits an experimental/release-candidate warning on current Node 22+ lines. That warning is expected.
- The persistence database is stored in the Electron user data path as `lumacast.sqlite`. Older installs with a `recast.sqlite` file are renamed automatically on first launch.
