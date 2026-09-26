// Permitted: the app's explicit typed IPC contract. Types and channel names
// only — no main, renderer, feature, or database code.
export type DesktopApi = {
  pickPhotos(): Promise<{ ids: string[] }>;
};

export const DESKTOP_CHANNELS = ['photos:pick'] as const;
