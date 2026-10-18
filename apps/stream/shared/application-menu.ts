/**
 * Process-neutral description of the application menu the renderer builds and
 * the main process turns into Electron's native menu (macOS). Kept in shared/
 * so neither process imports the other's code.
 */
export interface SerializedMenuItem {
  id: string;
  label: string;
  type?: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu';
  checked?: boolean;
  disabled?: boolean;
  accelerator?: string;
  registerAccelerator?: boolean;
  role?: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'quit' | 'about';
  submenu?: SerializedMenuItem[];
}
