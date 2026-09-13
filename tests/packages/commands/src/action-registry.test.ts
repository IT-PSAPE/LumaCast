import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  ACTION_METADATA,
  APP_MENU_COMMAND_TO_ACTION_ID,
  SHORTCUT_ACTION_TO_ACTION_ID,
  type ActionId,
  type ActionMetadata,
} from '../../../../packages/commands/src/action-registry';
import { ACTION_RISK_CLASSES } from '../../../../packages/commands/src/actions';
import type { AppMenuCommandId } from '../../../../packages/commands/src/app-menu';
import { SHORTCUTS } from '../../../../packages/commands/src/shortcuts';

// `ACTION_METADATA`'s type is `Readonly<Record<ActionId, ActionMetadata>>`,
// so this assignment is itself a compile-time proof that every `ActionId`
// member has metadata (a missing key, or a key not in the union, fails
// `npm run typecheck`, not this file).
const _metadataCoversEveryActionId: Readonly<Record<ActionId, ActionMetadata>> = ACTION_METADATA;
void _metadataCoversEveryActionId;

// `app-menu.ts` declares `AppMenuCommandId` as a type only, with no runtime
// array of its members — this local, exhaustively-typed list is the
// independent source of truth this file checks `APP_MENU_COMMAND_TO_ACTION_ID`
// against. Compile-time exhaustiveness of the map itself is separately
// guaranteed by its `Record<AppMenuCommandId, ActionId | null>` annotation in
// `action-registry.ts` (an omitted or misspelled key fails `npm run
// typecheck` there, independent of this list).
const ALL_APP_MENU_COMMAND_IDS: readonly AppMenuCommandId[] = [
  'file.newPresentation',
  'file.newLyric',
  'file.newPlaylist',
  'file.newSeparator',
  'file.newSlide',
  'file.exportCurrentItem',
  'file.exportWorkspace',
  'app.openSettings',
  'app.checkForUpdates',
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.duplicate',
  'edit.delete',
  'edit.clearSelection',
  'view.openCommandPalette',
  'view.mode.show',
  'view.mode.deckEditor',
  'view.mode.overlayEditor',
  'view.mode.themeEditor',
  'view.mode.stageEditor',
  'view.mode.macroEditor',
  'view.mode.settings',
  'view.slideBrowser.grid',
  'view.slideBrowser.list',
  'playback.takeSlide',
  'playback.previousSlide',
  'playback.nextSlide',
  'playback.toggleAudienceOutput',
  'playback.toggleStageOutput',
];

const ACTION_ID_PATTERN = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/;

const SHORTCUT_ACTION_IDS = SHORTCUTS.map((def) => def.id);

describe('ACTION_IDS / ACTION_METADATA', () => {
  it('ACTION_IDS has exactly one entry per ACTION_METADATA key, with no duplicates', () => {
    const metadataKeys = Object.keys(ACTION_METADATA);
    expect(ACTION_IDS.length).toBe(metadataKeys.length);
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length);
    expect(new Set(ACTION_IDS)).toEqual(new Set(metadataKeys));
  });

  it('every action id matches <domain>.<verbNoun>, lower camel case after the dot', () => {
    for (const id of ACTION_IDS) {
      expect(id, `"${id}" does not match ${ACTION_ID_PATTERN}`).toMatch(ACTION_ID_PATTERN);
    }
  });

  it('every entry’s own id field matches its key', () => {
    for (const id of ACTION_IDS) {
      expect(ACTION_METADATA[id].id).toBe(id);
    }
  });

  it('every entry has a non-empty title and description', () => {
    for (const id of ACTION_IDS) {
      const meta = ACTION_METADATA[id];
      expect(meta.title.trim().length, `"${id}" has an empty title`).toBeGreaterThan(0);
      expect(meta.description.trim().length, `"${id}" has an empty description`).toBeGreaterThan(0);
    }
  });

  it('every entry has a valid risk class and site', () => {
    for (const id of ACTION_IDS) {
      const meta = ACTION_METADATA[id];
      expect(ACTION_RISK_CLASSES, `"${id}" has invalid risk "${meta.risk}"`).toContain(meta.risk);
      expect(['main', 'renderer'], `"${id}" has invalid site "${meta.site}"`).toContain(meta.site);
    }
  });
});

describe('SHORTCUT_ACTION_TO_ACTION_ID', () => {
  it('has an entry for every ShortcutActionId declared in SHORTCUTS', () => {
    for (const id of SHORTCUT_ACTION_IDS) {
      expect(Object.prototype.hasOwnProperty.call(SHORTCUT_ACTION_TO_ACTION_ID, id), `missing mapping for shortcut "${id}"`).toBe(true);
    }
  });

  it('has no stray entries beyond the declared ShortcutActionIds', () => {
    const declared = new Set(SHORTCUT_ACTION_IDS);
    for (const key of Object.keys(SHORTCUT_ACTION_TO_ACTION_ID)) {
      expect(declared.has(key as (typeof SHORTCUT_ACTION_IDS)[number]), `unexpected shortcut key "${key}"`).toBe(true);
    }
  });

  it('every non-null mapped id exists in ACTION_METADATA', () => {
    for (const [shortcutId, actionId] of Object.entries(SHORTCUT_ACTION_TO_ACTION_ID)) {
      if (actionId === null) continue;
      expect(ACTION_IDS, `"${shortcutId}" maps to unknown action "${actionId}"`).toContain(actionId);
    }
  });
});

describe('APP_MENU_COMMAND_TO_ACTION_ID', () => {
  it('has an entry for every AppMenuCommandId', () => {
    for (const id of ALL_APP_MENU_COMMAND_IDS) {
      expect(Object.prototype.hasOwnProperty.call(APP_MENU_COMMAND_TO_ACTION_ID, id), `missing mapping for app-menu command "${id}"`).toBe(true);
    }
  });

  it('has exactly the declared AppMenuCommandIds and no stray entries', () => {
    expect(new Set(Object.keys(APP_MENU_COMMAND_TO_ACTION_ID))).toEqual(new Set(ALL_APP_MENU_COMMAND_IDS));
  });

  it('every non-null mapped id exists in ACTION_METADATA', () => {
    for (const [commandId, actionId] of Object.entries(APP_MENU_COMMAND_TO_ACTION_ID)) {
      if (actionId === null) continue;
      expect(ACTION_IDS, `"${commandId}" maps to unknown action "${actionId}"`).toContain(actionId);
    }
  });

  it('only app.checkForUpdates is null (every other legacy command has an agent-meaningful action)', () => {
    const nullKeys = Object.entries(APP_MENU_COMMAND_TO_ACTION_ID)
      .filter(([, actionId]) => actionId === null)
      .map(([commandId]) => commandId);
    expect(nullKeys).toEqual(['app.checkForUpdates']);
  });
});

describe('spot checks', () => {
  it('slide.take is broadcast risk on the renderer', () => {
    expect(ACTION_METADATA['slide.take'].risk).toBe('broadcast');
    expect(ACTION_METADATA['slide.take'].site).toBe('renderer');
  });

  it('media.import is filesystem risk on main', () => {
    expect(ACTION_METADATA['media.import'].risk).toBe('filesystem');
    expect(ACTION_METADATA['media.import'].site).toBe('main');
  });

  it('playlist.delete is destructive risk on main', () => {
    expect(ACTION_METADATA['playlist.delete'].risk).toBe('destructive');
    expect(ACTION_METADATA['playlist.delete'].site).toBe('main');
  });

  it('view.openCommandPalette maps to commandPalette.open, not null', () => {
    expect(APP_MENU_COMMAND_TO_ACTION_ID['view.openCommandPalette']).toBe('commandPalette.open');
  });

  it('nudgeOrGoNext maps to slide.next', () => {
    expect(SHORTCUT_ACTION_TO_ACTION_ID.nudgeOrGoNext).toBe('slide.next');
  });

  it('groupSelection/ungroupSelection map to element.group/element.ungroup', () => {
    expect(SHORTCUT_ACTION_TO_ACTION_ID.groupSelection).toBe('element.group');
    expect(SHORTCUT_ACTION_TO_ACTION_ID.ungroupSelection).toBe('element.ungroup');
  });

  it('the seven canvas/render actions execute in the renderer (ADR-0037)', () => {
    for (const id of [
      'slide.render',
      'slide.renderContactSheet',
      'element.setRichText',
      'element.group',
      'element.ungroup',
      'element.align',
      'element.distribute',
    ] as const) {
      expect(ACTION_METADATA[id].site).toBe('renderer');
    }
  });

  it('document.extractText still executes in main', () => {
    expect(ACTION_METADATA['document.extractText'].site).toBe('main');
    expect(ACTION_METADATA['document.extractText'].risk).toBe('filesystem');
  });
});
