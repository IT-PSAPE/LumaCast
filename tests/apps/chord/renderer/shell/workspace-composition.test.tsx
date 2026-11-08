import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Workspace } from '../../../../../apps/chord/renderer/shell/workspace';

const mocks = vi.hoisted(() => ({
  importAudio: vi.fn(),
  importBackground: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@lumacast/ui', () => ({
  PanelResize: () => null,
  ReacstButton: {
    Icon: ({ label, onClick }: { label: string; onClick: () => void }) => (
      <button type="button" aria-label={label} onClick={onClick} />
    ),
  },
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('../../../../../apps/chord/renderer/features/playback', () => ({
  AudioElement: () => null,
}));

vi.mock('../../../../../apps/chord/renderer/features/canvas', () => ({
  PreviewCanvas: () => null,
}));

vi.mock('../../../../../apps/chord/renderer/features/timeline', () => ({
  Timeline: ({ onImportAudio }: { onImportAudio: () => void }) => (
    <button type="button" onClick={onImportAudio}>Import audio</button>
  ),
}));

vi.mock('../../../../../apps/chord/renderer/features/inspector', () => ({
  Inspector: ({ onImportBackground }: { onImportBackground: () => void }) => (
    <button type="button" onClick={onImportBackground}>Import background</button>
  ),
}));

vi.mock('../../../../../apps/chord/renderer/shell/media-import', () => ({
  importAudio: mocks.importAudio,
  importAudioFromFile: vi.fn(),
  importBackground: mocks.importBackground,
  importBackgroundFromFile: vi.fn(),
  importLyricsFromFile: vi.fn(),
}));

vi.mock('../../../../../apps/chord/renderer/shell/top-bar', () => ({
  TopBar: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('Workspace feature callback composition', () => {
  it('wires shell-owned media import actions to Timeline and Inspector', () => {
    render(<Workspace />);

    fireEvent.click(screen.getByRole('button', { name: 'Import audio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import background' }));

    expect(mocks.importAudio).toHaveBeenCalledTimes(1);
    expect(mocks.importBackground).toHaveBeenCalledTimes(1);
  });
});
