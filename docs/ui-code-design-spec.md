# LumaCast UI Code Design Spec

Updated on 2026-11-08. Scope: Cast renderer composition in
`apps/cast/renderer` and its use of shared `@lumacast/ui` primitives.
[Renderer taxonomy](./renderer-taxonomy.md) defines names and ownership;
[UI specification](./ui-spec.md) describes the actual screen layouts.

## 1. Renderer UI Structure

| Directory under `apps/cast/renderer` | Responsibility |
| --- | --- |
| `application` | Cross-feature app commands, shortcuts, palette, agent-action execution |
| `shell` | Persistent application layout and status bar |
| `screens` | Concrete screen composition and screen-local state |
| `features` | Domain behavior and public feature APIs |
| `contexts` | App/editor state and injected contracts |
| `components` | Cast-specific reusable visual/editing components |
| `hooks`, `utils`, `types` | Shared app helpers and local contracts |
| `rendering` | Scene construction/traversal and common render stages/host |
| `runtime` | NDI audio capture lifecycle |
| `output` | GPU output view |

Generic suite controls and their theme live in `packages/ui/src`, not in Cast's
component tree. Dependency rules are enforced by
`tool/check_electron_architecture.mjs`.

## 2. Provider Composition

`apps/cast/renderer/App.tsx` composes these boundaries outermost first:

1. `ErrorBoundary`
2. `WorkbenchProvider`
3. `ConfirmProvider`
4. `AgentChatProvider`
5. `ObservabilityPortProvider`
6. `AppProvider`
7. `TimersProvider`
8. `AssetEditorProvider`
9. `NavigationProvider`
10. `PlaybackProvider`
11. `SlideProvider`
12. `PlaybackSchedulesProvider`
13. `MediaResidencyBoundary`
14. `AutomationProvider`
15. `LyricEditorProvider`
16. `CreateItemProvider`
17. `CanvasProvider`
18. `CommandPaletteProvider`

`ObservabilityRuntime` runs inside Workbench before the remaining providers.
Within CommandPalette, `SplitPanel` wraps `AppLayoutContent` and
`AgentActionDispatcher` so commands can reach panel-route state. Output gates,
the command palette, file-drop navigation guard, render host, and assistant
popup are sibling compositions within their required provider scope.

The [context ownership table](./renderer-taxonomy.md#5-contexts-appscastrenderercontexts)
identifies state owners. Root composition injects observability rather than
making shared app state import the observability feature's store.

## 3. Feature Ownership

See [renderer taxonomy](./renderer-taxonomy.md#4-features-appscastrendererfeatures).
Screens and `application` compose public feature APIs; rendering and process
resources remain in their own layers. Feature-specific controls stay with
that feature, such as `OutputSettingsPanel` in `features/playback`.

## 4. Canonical Terminology

UI modes and view preferences come from `apps/cast/renderer/types/ui.ts`.
Presentation/Lyric entities and typed references come from
`packages/composition/src/domain/items.ts`; the current model has no
`Presentation.kind`. See [terminology notes](./renderer-taxonomy.md#7-terminology-notes)
for flat playlists, separator rows, and editor/output naming.

## 5. Shared Base Components

Use `@lumacast/ui` for generic controls, typography, fields, menus, feedback,
confirmations, and layout primitives. Its public entry is
`packages/ui/src/index.ts`. Cast-specific scene frames, thumbnails, document
editing, media pickers, collections, and routed split panels live in
`apps/cast/renderer/components`.

Base UI-backed primitives own keyboard behavior, focus management, and ARIA
(ADR 0033). Shared overlay helpers resolve `#overlay-root` and manage overlay
stack entries; controls keep the markers used by shortcut/click-outside guards.

Follow ADR 0036 when composing screens: meaningful variants use named parts
and explicit JSX. Keep one-use markup near its state; retain direct algorithmic
and lifecycle guards. Data/state render callbacks remain useful where consumers
need item-specific integration or virtualization.

## 5a. Design Tokens

`packages/ui/src/theme.css` holds the shared colour system in two tiers. The
base values are 26 raw colours (a grey ramp, brand 400–600, and red, orange
and green 400–600); Tailwind's default palette is switched off, so nothing
else can be named in a class. Neutral and semantic roles describe interface
meaning:

- `bg-primary`, `bg-secondary`, `bg-tertiary` for the app canvas, panels, and
  controls;
- `text-primary`, `text-secondary`, `text-tertiary`;
- `border-primary`, `border-secondary`;
- `brand`, `error`, `warning`, `success`, usable in any namespace
  (`bg-brand`, `text-error`, `ring-brand`, `border-success/40`).

Tinted surfaces use opacity modifiers (`bg-error/15`). Solid actions and badges
use `brand-solid`, `error-solid`, `warning-solid`, and `success-solid` with
`text-on-solid`. These opaque fills preserve at least 4.5:1 contrast for small
labels in both themes, independently of the brighter semantic text colours in
dark mode. Primary hover and pointer-pressed states use `brand-solid-hover`,
which darkens the fill rather than making it transparent.

The foreground-derived `focus-ring` role supplies an inset keyboard-focus
outline on controls without their own indicator. Component rings and wrapper
focus treatments retain precedence. Forced-colour mode restores a system
outline even where a component normally relies on a box shadow. Light values
sit in `@theme`; dark values override the neutral and semantic roles under
`[data-theme="dark"]`. Palette changes stay in the shared theme.

## 6. Screens

| Surface | `data-ui-region` values |
| --- | --- |
| Persistent shell | `app-toolbar`, `status-bar` |
| Show | `resource-drawer` |
| Item Editor | `item-editor-layout`, `slide-notes-panel`, `inspector-panel` |
| Overlay, Theme, Stage Editors | `editor-layout`, `inspector-panel` |
| Macro Editor | `editor-layout`, `cue-list-panel`, `macro-inspector-panel` |
| Settings | `settings-layout` |
| Shared editor element layers | `object-list-panel` |

Region names are source-level hooks, not complete accessibility or visual
acceptance evidence. Prefer accessible roles/labels for interactions and scope
reused labels to the appropriate region. Full layouts are in
[UI specification](./ui-spec.md#3-screen-layouts).

## 7. UI Verification and Diagnostics

Use the existing Electron tests in `tests/apps/cast/e2e`:
`npm run test:e2e -- --trace on`. Diagnostic artifacts use `test-results/`;
media-crop tests explicitly capture screenshots there. Test discovery alone can
be checked without launching an app via `npx --no-install playwright test --list`.

Full-screen documentation capture needs a maintained generator; the obsolete
capture alias and failing stub have been removed. Visual acceptance requires
inspection of the current rendered states and behaviors, using test artifacts
where available.

## 8. Reference

- Canonical naming: [renderer-taxonomy.md](./renderer-taxonomy.md)
- Layout detail: [ui-spec.md](./ui-spec.md)
- Keyboard shortcuts: [keyboard-shortcuts.md](./keyboard-shortcuts.md)
- Composition: [ADR 0036](./adr/0036-declarative-renderer-component-composition.md)
