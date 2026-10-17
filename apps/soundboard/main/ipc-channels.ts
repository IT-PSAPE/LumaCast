export const IPC_CHANNELS = {
  load: 'soundboard:load',
  createBoard: 'soundboard:create-board',
  renameBoard: 'soundboard:rename-board',
  importSounds: 'soundboard:import-sounds',
  removeSound: 'soundboard:remove-sound',
  updateSound: 'soundboard:update-sound',
} as const;
