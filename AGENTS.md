# Agent Instructions

Be concise. Be explicit. Do not leave ambiguous decisions hidden in implementation.

## Working Model

- Gather only the context needed for the task.
- Start from the user's request and the directly affected files.
- Expand into tests, docs, wider code search, or GitHub context only when ambiguity, risk, or task size justifies it.
- Avoid loading unrelated context just because it exists.
- Combine the user's request with the project context you intentionally gathered.
- If the objective is not at least 95% clear, ask the user before implementing.
- If the objective is clear but details are discoverable, proceed and learn from the codebase.
- Stop and ask when a decision has high architectural, security, data, or product impact.
- Take initiative on clear, low-risk issues found while working.
- Ask before fixing issues that may be intentional, disputed, broad, architectural, security-sensitive, or data-sensitive.
- Tell the user when you fix an adjacent issue.

## Git And GitHub

- Never create a branch unless the user explicitly asks for one.
- Never commit, push, open a PR, merge, or close issues without explicit permission.
- Reconfirm before each branch, commit, push, PR, merge, or issue-closing action unless the user clearly grants autonomous control for that work.
- Create or update GitHub issues intentionally when a bug, deferred decision, missing spec, or follow-up is worth tracking outside the current change.
- Before creating an issue, weigh severity, likelihood, project direction, duplication, and whether the current task should fix it instead.
- If the user says to ignore or drop something, do not track or fix it.
- If the user says to skip something for now, track it only when it is still worth doing later.

## Tests

- Add or update tests for every behavior change.
- Cover normal behavior, failure cases, boundaries, and regressions that could plausibly break.
- Prefer focused tests near the changed behavior, then broaden only when shared contracts are affected.
- Never run the relevant tests unless the user explicitly asks for one.
- In GitHub issues, keep test work in its own "Test plan" section; acceptance criteria state behavioral outcomes only, never test passes.
- Test-plan items are guidance: they are never required to close an issue.

## UI Copy

- Do not add instructional descriptions or explainer notes for app-specific
  controls and behavior. Use concise labels and let the interaction teach the
  workflow.
- Explanatory copy is reserved for errors, destructive consequences, empty
  states, or when the user explicitly requests it.

## Layering Rules

The repository is an npm workspace of three self-contained Electron apps under
`apps/*` (`cast`, `cloud`, `flux`) that consume the headless-by-default packages
under `packages/*`. `node tool/check_electron_architecture.mjs` is the
executable authority for both the per-app tree boundaries and the package
boundaries below. It parses static ES imports/exports only (`.ts`, `.tsx`,
`.mjs`, `.js`, and `.cjs` are all code and are all checked), rejects unsupported
dynamic patterns, and runs the rules below against every committed file. `npm
run check:architecture` checks the tree; `npm run test:architecture` runs its
fixture graphs.

- Apps are self-contained: no app may import another app, by relative path, by
  app-scoped alias (`@renderer/…`, `@rendering/…`), or by module specifier
  (`@lumacast/<app>`, `@workspace/<app>/…`). An app-scoped alias resolves inside
  the importing app only and never falls back to a sibling app. Shared code
  belongs in a package under `packages/*`.
- No package may import app code, by any of those specifiers. Packages sit
  below the apps, never above them.

### App tree (`apps/<app>`)

The tree below is written for Cast, which is the only app that ships the full
workbench today; it applies per app, and `apps/<app>/…` is the path every rule
is keyed on.

- `<app>/main` is the Electron main-process bootstrap: window/menu/IPC wiring,
  security policy, and the app-side shims that make Electron-shaped things
  (the NDI utility-process host/proxy, config paths) available to
  `@lumacast/engine`. It is the process composition root and imports no
  renderer or feature code.
- `<app>/renderer` is the UI: screens, feature UI, shared components, and the
  contexts that wire package ports (e.g. canvas data, playback, automation)
  to concrete app state. It imports no Electron, main-process modules, or
  database code; it reaches main only through the typed `castApi` IPC contract
  (`@lumacast/protocol`).
  - UI/rendering primitives (`<app>/renderer/components`, `utils`, `types`)
    import no feature implementations.
  - A feature may not import another feature; allowed feature dependencies
    are directed, documented, public edges only. Bidirectional feature
    dependencies (cycles) must be removed, never allow-listed. Until the
    feature web is refactored, `feature-isolation` and `feature-cycle`
    violations are reported as warning-level refactor debt (exit 0) and must
    not be allow-listed; they flip to hard errors once the feature web is
    refactored.
  - Features import no screens or application shell (`App.tsx`, `main.tsx`,
    `workbench-screen-router.tsx`); screens and the shell are the composition
    boundaries. When a feature exposes a public entry point (`index.ts`),
    imports of it must go through that entry point.
  - Observability is consumed through a port; only screens, the shell, and
    the observability feature itself may reference it directly.
- Only the NDI engine-session boundary (`apps/cast/main/ndi` and
  `@lumacast/engine`) may touch the native module (`@lumacast/ndi-native`) or
  reference raw NDI host commands (`NdiHostCommand`, `NdiHostEvent`).
  `ndi-service-proxy.ts` is the sole host command writer; everything else
  reaches NDI through `NdiServiceLike`.

Current exceptions live in the checker's frozen allow-list. Adding an exception
means editing the allow-list in the script *and* saying why and who removes it,
in the script. Unused entries fail the check, so the allow-list can only
shrink. `feature-isolation` and `feature-cycle` are warning-level (exit 0) until
the feature web is refactored; they are reported as refactor debt and must not
be allow-listed, and become hard errors once the refactor lands.

## Workspace packages (issue #223, parent #219)

`package.json` declares an npm `workspaces` field covering `apps/*` and
`packages/*`; the workspace root is the root package and is not itself a
workspace member.
`package-lock.json` is the single authoritative lockfile — never hand-edit it
and never introduce another package manager or lockfile. Each package follows
the same convention: `packages/<name>/src/index.ts` is its only public entry
point (deep imports from outside the package fail `package-public-entry`),
source lives under `src/`, and internal files import each other with relative
paths, never via the package's own `@lumacast/<name>` specifier. Tests are not
co-located: every test lives under the root `tests/` tree at the path that
mirrors the file it covers, so a package's tests sit in
`tests/packages/<name>/src/`.

- **`@lumacast/kernel`** — dependency-free primitives (`Id`, `createId`,
  `nowIso`) that every other package may depend on.
- **`@lumacast/composition`** — the visual-document domain model: decks,
  slides, elements, themes, overlays, stages, rich text, and the headless
  scene-normalization contract every rendering surface shares.
- **`@lumacast/automation`** — the cue/macro/trigger-binding domain model and
  the deterministic macro runtime, plus headless cue description for the
  macro editor UI.
- **`@lumacast/commands`** — keyboard-shortcut definitions and the app-menu
  command vocabulary, plus headless keyboard-event matching helpers.
  `ShortcutActionId` and `AppMenuCommandId` are deliberately not unified yet —
  see the `TODO(commands-canonical-ids)` note in the package's index.
- **`@lumacast/protocol`** — the versioned IPC surface, snapshot patches, the
  deck-bundle manifest, NDI observability and project-backup contracts, and
  the runtime codecs that decode them at trust boundaries.
- **`@lumacast/persistence-sqlite`** — SQLite-backed persistence: the
  `CastRepository` store, schema migrations, fixtures, and deterministic
  test-support helpers.
- **`@lumacast/engine`** — the authoritative NDI output runtime: sender
  lifecycle, frame/audio pipeline, and diagnostics. The Electron-shaped host
  process and IPC proxy stay as thin shims in `apps/cast/main/ndi`.
- **`@lumacast/playback`** — headless playback decisions: overlay lifecycle,
  presentation-layer transitions, playlist adjacency, and stage-arming state.
  DOM media-element lifecycle and IPC/NDI wiring stay in the app-side
  provider.
- **`@lumacast/canvas`** — the Konva render/editing layer: scene-node
  components, stage editing/marquee/viewport interaction, image/video
  resolution, and inline text editing. The only package permitted to import
  Konva/React-Konva, and one of two (with `@lumacast/ui`) permitted to import
  React/React DOM (Electron stays banned even here).
- **`@lumacast/ui`** — shared, domain-agnostic UI primitives every app may
  reuse (class-name helpers, buttons, segmented control, typography, empty
  state) plus the shared Tailwind theme, published as the
  `@lumacast/ui/theme.css` subpath. React and React DOM are in bounds; Konva,
  React-Konva, and Electron are not, and it may depend only on `kernel`, so a
  shared control can never couple itself to a domain model or to one app.
- **`@lumacast/suite`** — the renderer-safe LumaCast suite model LumaCloud
  renders from: the registry of managed apps and identities, the
  release-version rules mirroring `tool/release-version.mjs`, GitHub
  release-catalog and electron-builder updater-metadata parsing, installer
  artifact selection, and headless app-state derivation. Depends only on
  `kernel`, so Cloud's main process and renderer read the catalog identically.
- **`@lumacast/ndi-native`** — the native NDI sender bridge; a native addon,
  exempt from the headless-source rules below and governed instead by the
  engine-session rule above.

`tool/check_electron_architecture.mjs` also walks `packages/*` and enforces,
as hard errors that are never allow-listable:

- No package may import anything under `apps/` (or the legacy `app/` root) —
  packages may not depend on an application.
- A package must not import React, React DOM, Konva, React-Konva, or
  Electron, except `@lumacast/canvas`, which may import
  react/react-dom/konva/react-konva (never Electron), and `@lumacast/ui`,
  which may import react/react-dom but never konva/react-konva (Electron stays
  banned for both).
- A persistence package (name starting with `persistence`) must not import
  renderer code.
- Package imports must go through the package's public entry point
  (`src/index.ts` or `index.ts`), plus a stylesheet the export map names
  explicitly (e.g. `@lumacast/ui/theme.css`); deep internal imports fail, and
  naming a second TypeScript file in the export map does not publish it.
- Package-to-package dependencies must follow the direction recorded in issue
  #219 (a default-deny table in the checker,
  `PACKAGE_DEPENDENCY_DIRECTIONS`): kernel depends on nothing and everything
  may depend on it; composition depends on kernel; automation depends on
  kernel and composition; commands depends only on kernel; protocol depends
  on kernel, composition, automation, and commands; persistence-sqlite
  depends on kernel, composition, automation, and protocol; engine depends on
  kernel, composition, protocol, and ndi-native; playback, canvas, and ui each
  depend on kernel, composition, and protocol, except that ui depends on kernel
  only; suite depends on kernel. An unlisted package name starts with zero
  permitted dependencies.
- Cycles between packages are forbidden and must be removed, never
  allow-listed.

## Docs

- Keep docs thin and useful.
- Do not create local issue specs, phase plans, roadmaps, or agent-workflow documents.
- Put issue-specific designs, implementation plans, decisions, and acceptance notes in GitHub issue comments. For work spanning multiple issues, comment on the root issue and cross-reference the related issues.
- Use GitHub issues for unresolved work that should be tracked.
- Update docs when behavior, architecture, commands, or contracts actually change.
- When a code change materially alters application behavior or an architectural concern, update `docs/ARCHITECTURE.md` in the same change. Architectural concerns include component responsibilities, system boundaries, data flow, public or internal contracts, persistence, security and trust boundaries, integrations, and operational behavior.
- Record each such decision in `docs/adr/` as part of the same change. Amend an existing ADR only when the change refines that ADR's current decision without obscuring its history. Create the next numbered ADR when the decision is new, cross-cutting, materially changes a prior decision, or supersedes one; mark superseded decisions explicitly rather than rewriting history.
- Purely mechanical work that preserves behavior and architecture, such as renaming, formatting, equivalent refactoring, or swapping an implementation behind an unchanged contract, does not require an architecture update or ADR.
