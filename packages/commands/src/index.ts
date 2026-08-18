// Public entry point for @lumacast/commands (issue #219, wave W3). This
// package holds two related but distinct command vocabularies:
//   - keyboard shortcuts (`shortcuts.ts`), matched against KeyboardEvents by
//     the headless helpers in `shortcut-matching.ts` and
//     `editable-text-shortcuts.ts`;
//   - the native application-menu command vocabulary (`app-menu.ts`), sent
//     from app/main/application-menu.ts to the renderer.
//
// TODO(commands-canonical-ids): ShortcutActionId and AppMenuCommandId are two
// partially-overlapping command vocabularies; unify into one canonical
// command-id space.
export * from './shortcuts';
export * from './shortcut-matching';
export * from './editable-text-shortcuts';
export * from './app-menu';
