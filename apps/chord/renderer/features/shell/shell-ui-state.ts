// Shell-local UI state that both `top-bar.tsx` (a click) and
// `menu-commands.ts` (a native menu command, which renders nothing itself)
// need to open the same dialogs — kept out of the document store since none
// of it is part of the project.
import { create } from 'zustand';

interface ShellUiState {
  exportDialogOpen: boolean;
  cueFormatChooserOpen: boolean;
}

export const useShellUiState = create<ShellUiState>(() => ({
  exportDialogOpen: false,
  cueFormatChooserOpen: false,
}));

export function openExportDialog(): void {
  useShellUiState.setState({ exportDialogOpen: true });
}

export function closeExportDialog(): void {
  useShellUiState.setState({ exportDialogOpen: false });
}

export function openCueFormatChooser(): void {
  useShellUiState.setState({ cueFormatChooserOpen: true });
}

export function closeCueFormatChooser(): void {
  useShellUiState.setState({ cueFormatChooserOpen: false });
}
