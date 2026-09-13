// The canonical action vocabulary shared by every command surface — keyboard
// shortcuts, the native app menu, the command palette, the in-app agent, and
// the MCP server. This resolves `TODO(commands-canonical-ids)`: rather than a
// third partially-overlapping vocabulary, `ActionId` is the one space the
// others map into.
//
// Risk classes drive the permission matrix an agent principal is granted. They
// describe the *worst* consequence of an action, not its typical one: a
// mutation that can put pixels in front of an audience is `broadcast` even
// when the outputs happen to be disabled right now.

export type ActionRiskClass =
  /** Query state. No side effects. */
  | 'read'
  /** Create or update content. Reversible through undo. */
  | 'write'
  /** Delete, or otherwise not reversible through routine undo. */
  | 'destructive'
  /** Puts content in front of an audience or changes what is live. */
  | 'broadcast'
  /** Reads from the user's filesystem outside the media library. */
  | 'filesystem';

export const ACTION_RISK_CLASSES: readonly ActionRiskClass[] = ['read', 'write', 'destructive', 'broadcast', 'filesystem'];

/**
 * Where an action's effect is realised. `main` actions are persistence or
 * system operations reachable over the typed IPC contract; `renderer` actions
 * touch live-show or workbench state that only exists in the renderer.
 */
export type ActionExecutionSite = 'renderer' | 'main';
