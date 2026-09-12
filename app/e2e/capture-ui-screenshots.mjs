import process from 'node:process';

// This script previously drove an Electron/Playwright session to capture a
// full UI screenshot set into docs/ui-spec-assets/. It was written against
// an earlier renderer and is no longer accurate:
//
// - `data-ui-region` selectors it used (e.g. "library-panel", "slide-browser",
//   "slide-list-panel", "overlay-list-panel", "show-mode-layout") do not exist
//   in the current renderer. See docs/ui-code-design-spec.md section 6 for the
//   current region names.
// - IPC calls it used to seed data (e.g. `castApi.createPlaylistSegment`,
//   `castApi.addDeckItemToSegment`) do not exist in the current IPC contract
//   (`app/core/ipc.ts`); the current equivalents are `createPlaylistGroup`
//   and `addDeckItemToGroup`.
//
// Running the old script would either throw partway through a capture run or
// silently produce a stale/incomplete `docs/ui-spec-assets/` tree. Per
// GitHub issue #161, screenshots that cannot be regenerated from a
// maintained flow are removed rather than left to rot, and this command now
// fails clearly instead of pretending to succeed.
//
// Regenerating a real screenshot set in a future implementation requires
// rewriting the Playwright selectors and seed-data calls against the current
// screens (`app/renderer/screens/*`) and IPC contract (`app/core/ipc.ts`).

console.error(
  '[capture-ui-screenshots] This command is currently non-functional: its ' +
  'selectors and IPC seed calls target a renderer structure that no longer ' +
  'exists. See app/e2e/capture-ui-screenshots.mjs and ' +
  'docs/ui-code-design-spec.md (Section 7) for details. No screenshots were ' +
  'captured.',
);
process.exitCode = 1;
