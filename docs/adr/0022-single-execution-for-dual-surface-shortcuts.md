# ADR-0022: Single Execution For Dual-Surface Keyboard Shortcuts

## Status

Accepted

## Date

2026-09-01

## Context

Keyboard actions reach the application through two independent dispatchers that
were built separately and were never reconciled:

- the native application menu (`app/main/application-menu.ts`), whose
  `accelerator` strings Electron registers with the OS and which delivers an
  `AppMenuCommandId` to `app/renderer/hooks/use-app-menu.ts`;
- the renderer's window `keydown` listener
  (`app/renderer/hooks/use-keyboard-shortcuts.ts`), which matches the
  `SHORTCUTS` table in `packages/commands/src/shortcuts.ts`.

Twelve chords are declared on both surfaces, and both surfaces implement the
same actions. Injecting real OS key events into a running macOS build, with the
renderer `keydown` timestamped against the menu-command IPC, measured:

| Chord | Observed |
| --- | --- |
| `Cmd+X`, `Cmd+C`, `Cmd+V`, `Cmd+D`, `Delete`, `Escape` | `keydown` at 0 ms, then the duplicate menu command 1–17 ms later |
| `Cmd+Z`, `Cmd+Shift+Z`, `Cmd+K`, `Enter`, `Left`, `Right` | `keydown` only; the menu accelerator never fires |

So one keypress ran the action twice for six chords, while for the other six the
menu accelerator was decorative and the renderer was the only working
dispatcher. `Delete` was the damaging case: each surface independently runs
"delete the selected element, else delete the current slide".

Electron's `registerAccelerator: false` suppresses an accelerator without
hiding it from the menu, but it is Linux and Windows only — macOS registers the
key equivalent regardless. Removing the `accelerator` strings instead would fix
every platform, at the cost of dropping the shortcut hints users expect beside
Copy, Paste and Undo.

## Decision

- The renderer's `keydown` listener is the single dispatcher for every chord
  that appears on both surfaces. The native menu keeps its `accelerator`
  strings, so the menu still displays each shortcut and still works when
  clicked.
- Menu items whose chord collides with a `SHORTCUTS` entry carry
  `registerAccelerator: false`. This alone resolves the duplication on Linux and
  Windows. `New Presentation`, `New Slide` and `Settings` have no renderer
  shortcut, so they stay registered and the menu keeps owning them.
- macOS needs one more step, because it ignores `registerAccelerator`. The
  renderer `keydown` always arrives first, so it claims the menu command it
  duplicates (`packages/commands/src/menu-command-claims.ts`) whenever a
  shortcut actually acts, and `use-app-menu.ts` consumes that claim before
  dispatching. A claim is consumed on read and expires after 300 ms — far above
  the 17 ms worst case measured, far below a deliberate mouse click — so a real
  menu click is never swallowed.
- A shortcut that matches but declines to act claims nothing and does not
  `preventDefault`, so the menu path stays available as the fallback it already
  was for cases the renderer does not handle (a plain DOM text selection for
  Copy, native editing commands inside a focused text field).

## Consequences

- One keypress runs one action on every platform, and the Edit and Playback
  menus keep their shortcut hints.
- The two command vocabularies stay separate, so the coupling between them is
  the explicit `SHORTCUT_TO_MENU_COMMAND` map. A new shortcut that duplicates a
  menu command must be added there or it will double-fire on macOS; the
  `registerAccelerator` coverage test in `tests/app/main/application-menu.test.ts`
  pins the menu half of the same contract.
- The claim window is a timing assumption, not a handshake. It holds because
  the renderer receives the key event directly while the menu command takes an
  extra main-to-renderer IPC hop; a future change that made the menu command
  arrive first would need the claim to run in the other direction.
- `TODO(commands-canonical-ids)` in `packages/commands/src/index.ts` remains the
  real fix: unifying `ShortcutActionId` and `AppMenuCommandId` into one command
  space would remove the duplicate implementations this ADR coordinates.

## Amendment (2026-09-14): text fields get the native Edit menu

The claim mechanism above assumed that inside a focused text field "the menu
path stays available as the fallback" for native editing. On macOS it was not:
the renderer `keydown` in a text field claims the menu command it does not
handle, the app-command menu item bound to the same chord consumes the key
equivalent (so Chromium never receives the `paste:`/`copy:`/`undo:` selector a
field needs), and `use-app-menu.ts` then drops the echo because of the claim.
Net effect: `Cmd+V`, `Cmd+C`, `Cmd+X` and `Cmd+Z` did nothing in any input,
textarea, or contenteditable on macOS.

- `AppMenuState.hasEditableFocus` (set by `use-app-menu.ts` from the same
  editable-target detection the hook already uses) now swaps the Edit menu's
  Undo/Redo/Cut/Copy/Paste/Delete items for Electron's native roles for as long
  as a text field has focus (`buildTextEditingMenu` in
  `app/main/application-menu.ts`). A role item runs the browser's own editing
  action on the focused field and sends no IPC, so there is nothing to claim or
  drop. Duplicate and Select None stay in place, disabled.
- With no text field focused the menu is unchanged, and the single-dispatcher
  rules above still apply to canvas and slide actions.
- The menu already rebuilt on focus changes (`canCut`/`canPaste` depend on
  focus), so this adds no rebuild churn; `tests/app/main/application-menu.test.ts`
  pins both shapes and the one-rebuild-per-transition behaviour.
