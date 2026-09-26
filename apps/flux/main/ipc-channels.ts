// The complete set of IPC channel names, in one place, so the preload bridge
// and the main-process handlers cannot drift apart: every channel the renderer
// can `invoke` appears exactly once here, and main registers a handler for
// each of them. `catalogChange` is the one push channel — main sends it, the
// renderer only subscribes — so it is deliberately not in the invoked set.
export const IPC_CHANNELS = {
  command: 'command',
  preview: 'preview',
  chooseImport: 'choose-import',
  chooseDirectory: 'choose-directory',
  chooseRelink: 'choose-relink',
  agentSettings: 'agent-settings',
  updateAgentSettings: 'update-agent-settings',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** The channel main pushes to the renderer when the library changes. */
export const CATALOG_CHANGE_CHANNEL = 'catalog-change';

/** Channels the renderer invokes, in the order main registers them. */
export const INVOKED_CHANNELS: readonly IpcChannel[] = Object.values(IPC_CHANNELS);
