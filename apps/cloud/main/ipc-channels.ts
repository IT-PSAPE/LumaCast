// The complete set of IPC channel names, in one place, so the preload bridge
// and the main-process handlers cannot drift apart: every channel the renderer
// can `invoke` appears exactly once here, and main registers a handler for
// each of them. The two push channels are main-to-renderer only — main sends,
// the renderer only subscribes — so they are deliberately not in the invoked
// set.
export const IPC_CHANNELS = {
  overview: 'suite-overview',
  refresh: 'suite-refresh',
  releases: 'suite-releases',
  grant: 'suite-grant',
  revoke: 'suite-revoke',
  updateSettings: 'suite-update-settings',
  install: 'suite-install',
  uninstall: 'suite-uninstall',
  cancel: 'suite-cancel',
  operations: 'suite-operations',
  open: 'suite-open',
  reveal: 'suite-reveal',
  openReleaseNotes: 'suite-open-release-notes',
  checkForSelfUpdate: 'cloud-check-for-update',
  installSelfUpdate: 'cloud-install-update',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Pushed when the overview (catalog, installs, settings, self-update) changes. */
export const OVERVIEW_CHANGE_CHANNEL = 'suite-overview-change';
/** Pushed on every operation progress or status change. */
export const OPERATION_CHANGE_CHANNEL = 'suite-operation-change';

/** Channels the renderer invokes, in the order main registers them. */
export const INVOKED_CHANNELS: readonly IpcChannel[] = Object.values(IPC_CHANNELS);
