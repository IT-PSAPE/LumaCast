// Covers the pure chat-transcript summarizer: verb-table completeness
// against the live `ACTION_METADATA` registry (so a future action with a
// new verb fails loudly instead of silently degrading), the irregular
// conjugations called out in the design, and one behavioral test per
// result-shape branch (list/get/overview/mutation/setEnabled/failure
// states) plus malformed-input safety.
import { describe, expect, it } from 'vitest';
import { ACTION_METADATA, type ActionId } from '@lumacast/commands';
import type { AgentToolCallStatus } from '@lumacast/protocol';
import {
  isToolCallSettled,
  summarizeToolCall,
  toolCallLabel,
  type ToolCallPart,
} from '@renderer/features/agent/chat/tool-call-summary';

function makePart(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    type: 'tool_call',
    callId: 'call-1',
    actionId: 'playlist.create',
    arguments: {},
    status: 'running',
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Oracle verb tables — an independent copy of the two tables the
// implementation must carry, kept here so the completeness assertion below
// isn't circular (it doesn't import the private tables; it asserts every
// registry verb has a home in tables this test itself had to spell out).
// ---------------------------------------------------------------------------

const ORACLE_PARTICIPLE: Readonly<Record<string, string>> = {
  Activate: 'Activating', Add: 'Adding', Align: 'Aligning', Apply: 'Applying', Arm: 'Arming',
  Assign: 'Assigning', Bring: 'Bringing', Browse: 'Browsing', Cancel: 'Cancelling', Clear: 'Clearing',
  Copy: 'Copying', Create: 'Creating', Cut: 'Cutting', Delete: 'Deleting', Detach: 'Detaching',
  Distribute: 'Distributing', Duplicate: 'Duplicating', Enable: 'Enabling', Ensure: 'Ensuring',
  Export: 'Exporting', Extract: 'Extracting', Get: 'Getting', Go: 'Going', Group: 'Grouping',
  Import: 'Importing', Inspect: 'Inspecting', Jump: 'Jumping', List: 'Listing', Move: 'Moving',
  Nudge: 'Nudging', Open: 'Opening', Paste: 'Pasting', Pause: 'Pausing', Play: 'Playing',
  Reclaim: 'Reclaiming', Redo: 'Redoing', Remove: 'Removing', Rename: 'Renaming', Render: 'Rendering',
  Reorder: 'Reordering', Replace: 'Replacing', Restore: 'Restoring', Resume: 'Resuming', Run: 'Running',
  Save: 'Saving', Search: 'Searching', Seek: 'Seeking', Select: 'Selecting', Send: 'Sending',
  Set: 'Setting', Sync: 'Syncing', Take: 'Taking', Toggle: 'Toggling', Undo: 'Undoing',
  Ungroup: 'Ungrouping', Update: 'Updating', Write: 'Writing',
};

const ORACLE_PAST: Readonly<Record<string, string>> = {
  Activate: 'Activated', Add: 'Added', Align: 'Aligned', Apply: 'Applied', Arm: 'Armed',
  Assign: 'Assigned', Bring: 'Brought', Browse: 'Browsed', Cancel: 'Cancelled', Clear: 'Cleared',
  Copy: 'Copied', Create: 'Created', Cut: 'Cut', Delete: 'Deleted', Detach: 'Detached',
  Distribute: 'Distributed', Duplicate: 'Duplicated', Enable: 'Enabled', Ensure: 'Ensured',
  Export: 'Exported', Extract: 'Extracted', Get: 'Got', Go: 'Went', Group: 'Grouped',
  Import: 'Imported', Inspect: 'Inspected', Jump: 'Jumped', List: 'Listed', Move: 'Moved',
  Nudge: 'Nudged', Open: 'Opened', Paste: 'Pasted', Pause: 'Paused', Play: 'Played',
  Reclaim: 'Reclaimed', Redo: 'Redid', Remove: 'Removed', Rename: 'Renamed', Render: 'Rendered',
  Reorder: 'Reordered', Replace: 'Replaced', Restore: 'Restored', Resume: 'Resumed', Run: 'Ran',
  Save: 'Saved', Search: 'Searched', Seek: 'Sought', Select: 'Selected', Send: 'Sent',
  Set: 'Set', Sync: 'Synced', Take: 'Took', Toggle: 'Toggled', Undo: 'Undid',
  Ungroup: 'Ungrouped', Update: 'Updated', Write: 'Wrote',
};

function firstWordOf(title: string): string {
  const spaceIndex = title.indexOf(' ');
  return spaceIndex === -1 ? title : title.slice(0, spaceIndex);
}

function restOf(title: string): string {
  const spaceIndex = title.indexOf(' ');
  return spaceIndex === -1 ? '' : title.slice(spaceIndex + 1).toLowerCase();
}

function withRest(verb: string, rest: string): string {
  return rest.length > 0 ? `${verb} ${rest}` : verb;
}

const ALL_ACTION_IDS = Object.keys(ACTION_METADATA) as ActionId[];

// Actions whose settled/succeeded line never runs the plain "<past> <rest>"
// formula: `project.getOverview` and every "Get …" title use read-projection
// phrasing instead, and the two setEnabled actions resolve their verb form
// from `arguments.enabled`, not from the title's first word.
const SETTLED_BRANCH_EXCEPTIONS = new Set<ActionId>(['project.getOverview', 'overlay.setEnabled', 'output.setEnabled']);
// Active phrasing never branches on result shape, so only the two
// special-cased setEnabled actions need to sit out the generic active check.
const ACTIVE_FORM_EXCEPTIONS = new Set<ActionId>(['overlay.setEnabled', 'output.setEnabled']);

describe('verb table completeness', () => {
  it('has a present-participle and simple-past entry for every ACTION_METADATA first word', () => {
    for (const actionId of ALL_ACTION_IDS) {
      const firstWord = firstWordOf(ACTION_METADATA[actionId].title);
      expect(ORACLE_PARTICIPLE, `present participle for "${firstWord}" (${actionId})`).toHaveProperty(firstWord);
      expect(ORACLE_PAST, `simple past for "${firstWord}" (${actionId})`).toHaveProperty(firstWord);
    }
  });

  it('conjugates the present participle correctly for every action (active line)', () => {
    for (const actionId of ALL_ACTION_IDS) {
      if (ACTIVE_FORM_EXCEPTIONS.has(actionId)) continue;
      const title = ACTION_METADATA[actionId].title;
      const expected = `${withRest(ORACLE_PARTICIPLE[firstWordOf(title)], restOf(title))}…`;
      const { active } = summarizeToolCall(makePart({ actionId, status: 'running', arguments: {} }));
      expect(active, actionId).toBe(expected);
    }
  });

  it('conjugates the simple past correctly for every action that reaches the generic mutation bucket', () => {
    for (const actionId of ALL_ACTION_IDS) {
      const title = ACTION_METADATA[actionId].title;
      if (SETTLED_BRANCH_EXCEPTIONS.has(actionId) || title.startsWith('Get ')) continue;
      const expected = withRest(ORACLE_PAST[firstWordOf(title)], restOf(title));
      // A non-array, non-null, name-free result/argument set so every
      // action falls into the plain "<past> <rest>" mutation branch,
      // regardless of what it actually returns in production.
      const { settled } = summarizeToolCall(makePart({ actionId, status: 'succeeded', arguments: {}, result: {} }));
      expect(settled, actionId).toBe(expected);
    }
  });

  // "Enable"/"Enabled" and "Get"/"Got" are real table entries (required by
  // the design and asserted above via the registry-driven completeness
  // check) that are nonetheless never surfaced verbatim in production:
  // every "Get …" title reports read-projection phrasing instead of a bare
  // past tense, and the only two "Enable …" titles are always resolved from
  // `arguments.enabled` rather than the title text. These two assertions
  // pin the otherwise-unreachable oracle cells so a typo there wouldn't
  // silently survive.
  it('carries the correct (if not directly observable) forms for "Get" and "Enable"', () => {
    expect(ORACLE_PARTICIPLE.Get).toBe('Getting');
    expect(ORACLE_PAST.Get).toBe('Got');
    expect(ORACLE_PARTICIPLE.Enable).toBe('Enabling');
    expect(ORACLE_PAST.Enable).toBe('Enabled');
  });
});

describe('irregular verbs', () => {
  const cases: Array<[actionId: ActionId, participle: string, past: string]> = [
    ['element.setRichText', 'Setting', 'Set'],
    ['macro.run', 'Running', 'Ran'],
    ['playlist.get', 'Getting', 'Got'],
    ['element.cut', 'Cutting', 'Cut'],
    ['slide.take', 'Taking', 'Took'],
    ['slide.next', 'Going', 'Went'],
    ['edit.undo', 'Undoing', 'Undid'],
    ['edit.redo', 'Redoing', 'Redid'],
    ['clipboard.read', 'Reading', 'Read'],
    ['clipboard.write', 'Writing', 'Wrote'],
    ['element.sendToBack', 'Sending', 'Sent'],
    ['element.bringToFront', 'Bringing', 'Brought'],
    ['video.seek', 'Seeking', 'Sought'],
    ['theme.syncLinkedItems', 'Syncing', 'Synced'],
    ['video.pause', 'Pausing', 'Paused'],
    ['macro.cancelAll', 'Cancelling', 'Cancelled'],
    ['element.nudge', 'Nudging', 'Nudged'],
  ];

  it.each(cases)('%s conjugates to %s / %s', (actionId, participle) => {
    const title = ACTION_METADATA[actionId].title;
    const rest = restOf(title);
    const { active } = summarizeToolCall(makePart({ actionId, status: 'running', arguments: {} }));
    expect(active).toBe(`${withRest(participle, rest)}…`);
  });

  it('past tense: playlist.get "Got" is only observable via read-projection wording, so check active only above; verify others via succeeded', () => {
    const check = (actionId: ActionId, past: string) => {
      const title = ACTION_METADATA[actionId].title;
      if (title.startsWith('Get ')) return; // handled by the read-projection tests instead
      const rest = restOf(title);
      const { settled } = summarizeToolCall(makePart({ actionId, status: 'succeeded', arguments: {}, result: {} }));
      expect(settled, actionId).toBe(withRest(past, rest));
    };
    check('element.setRichText', 'Set');
    check('macro.run', 'Ran');
    check('element.cut', 'Cut');
    check('slide.take', 'Took');
    check('slide.next', 'Went');
    check('edit.undo', 'Undid');
    check('edit.redo', 'Redid');
    check('clipboard.read', 'Read');
    check('clipboard.write', 'Wrote');
    check('element.sendToBack', 'Sent');
    check('element.bringToFront', 'Brought');
    check('video.seek', 'Sought');
    check('theme.syncLinkedItems', 'Synced');
    check('video.pause', 'Paused');
    check('macro.cancelAll', 'Cancelled');
    check('element.nudge', 'Nudged');
  });
});

describe('active / awaiting phrasing', () => {
  it('pending and running both use the present-progressive line', () => {
    const pending = summarizeToolCall(makePart({ actionId: 'playlist.list', status: 'pending', arguments: {} }));
    const running = summarizeToolCall(makePart({ actionId: 'playlist.list', status: 'running', arguments: {} }));
    expect(pending.active).toBe('Listing playlists…');
    expect(running.active).toBe('Listing playlists…');
  });

  it('awaiting_permission uses "Waiting to …" phrased from the title, not the participle', () => {
    const { active } = summarizeToolCall(makePart({ actionId: 'playlist.delete', status: 'awaiting_permission', arguments: {} }));
    expect(active).toBe('Waiting to delete playlist…');
  });

  it('includes a quoted name in the active line when arguments carry one', () => {
    const { active } = summarizeToolCall(
      makePart({ actionId: 'playlist.create', status: 'running', arguments: { name: 'Sunday' } }),
    );
    expect(active).toBe('Creating playlist “Sunday”…');
  });

  it('clips a name longer than 40 characters', () => {
    const longName = 'A'.repeat(50);
    const { active } = summarizeToolCall(
      makePart({ actionId: 'playlist.create', status: 'running', arguments: { name: longName } }),
    );
    expect(active).toBe(`Creating playlist “${'A'.repeat(40)}…”…`);
  });

  it('uses "for" phrasing for a query argument', () => {
    const { active } = summarizeToolCall(
      makePart({ actionId: 'project.search', status: 'running', arguments: { query: 'sunday' } }),
    );
    expect(active).toBe('Searching project for “sunday”…');
  });
});

describe('list results', () => {
  it('reports names for a multi-item result', () => {
    const result = [{ name: 'Sunday' }, { name: 'Wednesday' }, { name: 'Youth' }, { name: 'Christmas' }];
    const summary = summarizeToolCall(makePart({ actionId: 'playlist.list', status: 'succeeded', arguments: {}, result }));
    expect(summary.settled).toBe('Found 4 playlists');
    expect(summary.items).toEqual(['Sunday', 'Wednesday', 'Youth', 'Christmas']);
    expect(summary.detail).toBeNull();
  });

  it('reports "no" for an empty result', () => {
    const summary = summarizeToolCall(makePart({ actionId: 'playlist.list', status: 'succeeded', arguments: {}, result: [] }));
    expect(summary.settled).toBe('Found no playlists');
    expect(summary.items).toEqual([]);
  });

  it('singularizes for a single result', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'playlist.list', status: 'succeeded', arguments: {}, result: [{ name: 'Solo' }] }),
    );
    expect(summary.settled).toBe('Found 1 playlist');
    expect(summary.items).toEqual(['Solo']);
  });

  it('falls back to `title` when an item has no `name`', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'item.list', status: 'succeeded', arguments: {}, result: [{ title: 'Sermon' }, { title: 'Notice' }] }),
    );
    expect(summary.settled).toBe('Found 2 items');
    expect(summary.items).toEqual(['Sermon', 'Notice']);
  });

  it('skips items whose label is missing or not a string', () => {
    const summary = summarizeToolCall(
      makePart({
        actionId: 'playlist.list',
        status: 'succeeded',
        arguments: {},
        result: [{ name: 'Sunday' }, { name: 42 }, {}, 'not-an-object'],
      }),
    );
    expect(summary.settled).toBe('Found 4 playlists');
    expect(summary.items).toEqual(['Sunday']);
  });

  it('search uses "results" as the noun and appends the query', () => {
    const result = [{ title: 'Sunday set' }, { title: 'Sunday notice' }];
    const summary = summarizeToolCall(
      makePart({ actionId: 'project.search', status: 'succeeded', arguments: { query: 'sunday' }, result }),
    );
    expect(summary.settled).toBe('Found 2 results for “sunday”');
    expect(summary.items).toEqual(['Sunday set', 'Sunday notice']);
  });

  it('search without a query argument falls back to the plain count', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'project.search', status: 'succeeded', arguments: {}, result: [{ title: 'X' }] }),
    );
    expect(summary.settled).toBe('Found 1 result');
  });
});

describe('project.getOverview', () => {
  it('reports non-zero counts, humanized and singularized', () => {
    const result = {
      counts: {
        playlists: 4,
        presentations: 12,
        lyrics: 1,
        slides: 0,
        mediaAssets: 3,
        themes: 0,
        overlays: 0,
        stages: 0,
        macros: 0,
        cues: 0,
      },
    };
    const summary = summarizeToolCall(makePart({ actionId: 'project.getOverview', status: 'succeeded', arguments: {}, result }));
    expect(summary.settled).toBe('Read project overview');
    expect(summary.items).toEqual(['4 playlists', '12 presentations', '1 lyric', '3 media assets']);
  });

  it('degrades gracefully when counts is missing or malformed', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'project.getOverview', status: 'succeeded', arguments: {}, result: { counts: 'nope' } }),
    );
    expect(summary.settled).toBe('Read project overview');
    expect(summary.items).toEqual([]);
  });
});

describe('single-object "Get" actions', () => {
  it('reports the name for a found object', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'playlist.get', status: 'succeeded', arguments: {}, result: { id: 'p1', name: 'Sunday' } }),
    );
    expect(summary.settled).toBe('Read playlist “Sunday”');
  });

  it('reports "no <object>" for a null result', () => {
    const summary = summarizeToolCall(makePart({ actionId: 'playlist.get', status: 'succeeded', arguments: {}, result: null }));
    expect(summary.settled).toBe('Found no playlist');
  });

  it('falls back to a plain "Read <object>" when the object has no name/title', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'project.getSnapshot', status: 'succeeded', arguments: {}, result: { presentations: [] } }),
    );
    expect(summary.settled).toBe('Read project snapshot');
  });
});

describe('mutations', () => {
  it('appends the name argument', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'playlist.create', status: 'succeeded', arguments: { name: 'Sunday' }, result: { ok: true } }),
    );
    expect(summary.settled).toBe('Created playlist “Sunday”');
  });

  it('has no name suffix when there is nothing to name', () => {
    const summary = summarizeToolCall(makePart({ actionId: 'slide.take', status: 'succeeded', arguments: {}, result: null }));
    expect(summary.settled).toBe('Took slide');
  });

  it('handles a multi-word title remainder', () => {
    const summary = summarizeToolCall(makePart({ actionId: 'slide.next', status: 'succeeded', arguments: {}, result: null }));
    expect(summary.settled).toBe('Went to next slide');
  });

  it('reports the count for a top-level array argument (createMany)', () => {
    const summary = summarizeToolCall(
      makePart({
        actionId: 'element.createMany',
        status: 'succeeded',
        arguments: { elements: [{}, {}, {}] },
        result: { ok: true },
      }),
    );
    expect(summary.settled).toBe('Created 3 elements');
  });

  it('singularizes the count when the array has one entry', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'element.deleteMany', status: 'succeeded', arguments: { ids: ['e1'] }, result: { ok: true } }),
    );
    expect(summary.settled).toBe('Deleted 1 element');
  });

  it('reports "no" when the array argument is empty', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'element.updateMany', status: 'succeeded', arguments: { updates: [] }, result: { ok: true } }),
    );
    expect(summary.settled).toBe('Updated no elements');
  });
});

describe('overlay.setEnabled / output.setEnabled', () => {
  it('enabling an overlay', () => {
    const running = summarizeToolCall(makePart({ actionId: 'overlay.setEnabled', status: 'running', arguments: { enabled: true } }));
    const succeeded = summarizeToolCall(
      makePart({ actionId: 'overlay.setEnabled', status: 'succeeded', arguments: { enabled: true }, result: { ok: true } }),
    );
    expect(running.active).toBe('Enabling overlay…');
    expect(succeeded.settled).toBe('Enabled overlay');
  });

  it('disabling an overlay', () => {
    const running = summarizeToolCall(makePart({ actionId: 'overlay.setEnabled', status: 'running', arguments: { enabled: false } }));
    const succeeded = summarizeToolCall(
      makePart({ actionId: 'overlay.setEnabled', status: 'succeeded', arguments: { enabled: false }, result: { ok: true } }),
    );
    expect(running.active).toBe('Disabling overlay…');
    expect(succeeded.settled).toBe('Disabled overlay');
  });

  it('falls back to "Toggle" when the boolean is missing', () => {
    const running = summarizeToolCall(makePart({ actionId: 'overlay.setEnabled', status: 'running', arguments: {} }));
    const succeeded = summarizeToolCall(makePart({ actionId: 'overlay.setEnabled', status: 'succeeded', arguments: {}, result: { ok: true } }));
    expect(running.active).toBe('Toggling overlay…');
    expect(succeeded.settled).toBe('Toggled overlay');
  });

  it('resolves output.setEnabled the same way', () => {
    const succeeded = summarizeToolCall(
      makePart({ actionId: 'output.setEnabled', status: 'succeeded', arguments: { enabled: true }, result: { ok: true } }),
    );
    expect(succeeded.settled).toBe('Enabled output');
  });
});

describe('failure states', () => {
  it('failed carries the raw error as detail', () => {
    const summary = summarizeToolCall(
      makePart({
        actionId: 'playlist.create',
        status: 'failed',
        arguments: { name: 'Sunday' },
        error: 'Disk full',
      }),
    );
    expect(summary.settled).toBe('Couldn’t create playlist “Sunday”');
    expect(summary.detail).toBe('Disk full');
  });

  it('denied without an interlock error has no detail', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'playlist.delete', status: 'denied', arguments: { name: 'Sunday' }, error: 'User declined' }),
    );
    expect(summary.settled).toBe('Skipped deleting playlist “Sunday”');
    expect(summary.detail).toBeNull();
  });

  it('denied with an interlock error names the interlock (case-insensitively)', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'slide.take', status: 'denied', arguments: {}, error: 'Blocked by INTERLOCK' }),
    );
    expect(summary.settled).toBe('Skipped taking slide');
    expect(summary.detail).toBe('Blocked by the show-safety interlock');
  });

  it('cancelled has no detail', () => {
    const summary = summarizeToolCall(makePart({ actionId: 'playlist.create', status: 'cancelled', arguments: { name: 'Sunday' } }));
    expect(summary.settled).toBe('Stopped creating playlist “Sunday”');
    expect(summary.detail).toBeNull();
  });

  it('cancelled with no name argument', () => {
    const summary = summarizeToolCall(makePart({ actionId: 'playlist.create', status: 'cancelled', arguments: {} }));
    expect(summary.settled).toBe('Stopped creating playlist');
  });
});

describe('unknown action', () => {
  const actionId = 'totally.unknown' as ActionId;

  it('active line', () => {
    const summary = summarizeToolCall(makePart({ actionId, status: 'running', arguments: {} }));
    expect(summary.active).toBe('Running totally.unknown…');
  });

  it('awaiting_permission line', () => {
    const summary = summarizeToolCall(makePart({ actionId, status: 'awaiting_permission', arguments: {} }));
    expect(summary.active).toBe('Waiting to run totally.unknown…');
  });

  it('settled line', () => {
    const summary = summarizeToolCall(makePart({ actionId, status: 'succeeded', arguments: {}, result: {} }));
    expect(summary.settled).toBe('Ran totally.unknown');
  });

  it('failed line carries the error', () => {
    const summary = summarizeToolCall(makePart({ actionId, status: 'failed', arguments: {}, error: 'boom' }));
    expect(summary.settled).toBe('Couldn’t run totally.unknown');
    expect(summary.detail).toBe('boom');
  });
});

describe('toolCallLabel', () => {
  it('returns the active line before the call settles', () => {
    const part = makePart({ actionId: 'playlist.list', status: 'running', arguments: {} });
    expect(toolCallLabel(part)).toBe('Listing playlists…');
  });

  it('returns the settled line once the call has settled', () => {
    const part = makePart({ actionId: 'playlist.list', status: 'succeeded', arguments: {}, result: [{ name: 'Sunday' }] });
    expect(toolCallLabel(part)).toBe('Found 1 playlist');
  });
});

describe('isToolCallSettled', () => {
  const cases: Array<[AgentToolCallStatus, boolean]> = [
    ['pending', false],
    ['running', false],
    ['awaiting_permission', false],
    ['succeeded', true],
    ['failed', true],
    ['denied', true],
    ['cancelled', true],
  ];

  it.each(cases)('%s -> %s', (status, expected) => {
    expect(isToolCallSettled(status)).toBe(expected);
  });
});

describe('malformed inputs never throw', () => {
  it('non-object arguments degrade to the generic phrasing', () => {
    expect(() => summarizeToolCall(makePart({ actionId: 'playlist.create', arguments: 'nope' }))).not.toThrow();
    expect(() => summarizeToolCall(makePart({ actionId: 'playlist.create', arguments: null }))).not.toThrow();
    expect(() => summarizeToolCall(makePart({ actionId: 'playlist.create', arguments: [1, 2, 3] }))).not.toThrow();
    expect(() => summarizeToolCall(makePart({ actionId: 'playlist.create', arguments: 12345 }))).not.toThrow();
  });

  it('a non-string name/query field is skipped rather than rendered', () => {
    const summary = summarizeToolCall(
      makePart({ actionId: 'playlist.create', status: 'running', arguments: { name: 12345 } }),
    );
    expect(summary.active).toBe('Creating playlist…');
  });

  it('an unexpected result shape for a list/get/overview action degrades gracefully', () => {
    expect(() =>
      summarizeToolCall(makePart({ actionId: 'playlist.list', status: 'succeeded', arguments: {}, result: 'not-an-array' })),
    ).not.toThrow();
    expect(() =>
      summarizeToolCall(makePart({ actionId: 'playlist.get', status: 'succeeded', arguments: {}, result: 'not-an-object' })),
    ).not.toThrow();
    expect(() =>
      summarizeToolCall(makePart({ actionId: 'project.getOverview', status: 'succeeded', arguments: {}, result: null })),
    ).not.toThrow();
  });

  it('a huge argument object does not throw', () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 10_000; i += 1) huge[`key${i}`] = i;
    expect(() => summarizeToolCall(makePart({ actionId: 'playlist.create', arguments: huge }))).not.toThrow();
  });
});
