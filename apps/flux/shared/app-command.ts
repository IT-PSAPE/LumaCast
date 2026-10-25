// Every action the native menu and the renderer's keyboard bindings share.
// Main pushes these over MENU_COMMAND_CHANNEL; the renderer resolves its own
// keydown events to the same names, so a menu item and its key run one code
// path. Process-neutral: imported by main, the preload and the renderer.
export type RatingCommand = 'rate-0' | 'rate-1' | 'rate-2' | 'rate-3' | 'rate-4' | 'rate-5';

export type AppCommand =
  | 'import-photos'
  | 'import-folder'
  | 'export'
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'previous'
  | 'next'
  | 'toggle-clipping'
  | 'library'
  | 'edit'
  | 'favorite'
  | RatingCommand;
