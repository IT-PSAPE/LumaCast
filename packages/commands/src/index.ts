// Public entry point for @lumacast/commands (issue #219, wave W3). This
// package holds two related but distinct command vocabularies:
//   - keyboard shortcuts (`shortcuts.ts`), matched against KeyboardEvents by
//     the headless helpers in `shortcut-matching.ts`;
//   - the native application-menu command vocabulary (`app-menu.ts`), sent
//     from app/main/application-menu.ts to the renderer.
//
// TODO(commands-canonical-ids): resolved by `action-registry.ts` — its
// `SHORTCUT_ACTION_TO_ACTION_ID`/`APP_MENU_COMMAND_TO_ACTION_ID` maps
// ShortcutActionId and AppMenuCommandId, the two legacy partially-overlapping
// command vocabularies, into the single canonical `ActionId` space.
export * from './shortcuts';
export * from './shortcut-matching';
export * from './app-menu';
export * from './menu-command-claims';
export * from './actions';
export * from './action-registry';
