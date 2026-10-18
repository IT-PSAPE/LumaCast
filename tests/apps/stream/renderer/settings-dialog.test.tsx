import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsDialog, type SettingsDialogProps } from '../../../../apps/stream/renderer/dialogs/settings-dialog';
import {
  createDefaultProject,
  createDefaultStreamAudioSettings,
  createDefaultStreamRecordingPreferences,
  VIDEO_ENCODER_OPTIONS,
  type StreamProject,
} from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

const VIDEO_ENCODER_OPTIONS_WIN32 = VIDEO_ENCODER_OPTIONS.filter((option) => option.value === 'h264_mf' || option.value === 'libopenh264');

function renderDialog(overrides: Partial<SettingsDialogProps> & { project?: StreamProject } = {}) {
  const project = overrides.project ?? createDefaultProject('win32');
  // Detached by default (not appended to the document) so focus-restoration
  // is a no-op unless a test explicitly attaches its own opener.
  const settingsOpenerRef = overrides.settingsOpenerRef ?? { current: document.createElement('button') };

  const setProjectValue = vi.fn();
  const onClose = vi.fn();
  const onUpdateMonitoringDevice = vi.fn();
  const setReplayBufferDurationSeconds = vi.fn();

  const props: SettingsDialogProps = {
    settingsOpenerRef,
    onClose,
    project,
    setProjectValue,
    audio: {
      monitorDeviceSelectionSupported: true,
      audioSettings: createDefaultStreamAudioSettings(),
      audioOutputDevices: [],
      audioSettingsError: '',
      onUpdateMonitoringDevice,
    },
    replayBufferDurationSeconds: 30,
    setReplayBufferDurationSeconds,
    replayBufferStartedAt: null,
    recording: {
      recordingPreferences: createDefaultStreamRecordingPreferences(),
      setRecordingPreferences: vi.fn(),
      recordingPreferencesError: '',
      onChooseDirectory: vi.fn(),
      onUseDefaultDirectory: vi.fn(),
      onFilenameBlur: vi.fn(),
    },
    recordingStartedAt: null,
    recordingFinalizing: false,
    videoEncoderOptions: VIDEO_ENCODER_OPTIONS_WIN32,
    systemVideoEncoder: 'h264_mf',
    hotkeys: {
      hotkeyDraft: null,
      sceneSwitchHotkeyDraft: {},
      sourceVisibilityHotkeyDraft: {},
      hotkeyError: '',
      hotkeysWorking: false,
      onCaptureHotkey: vi.fn(),
      onCaptureSceneSwitchHotkey: vi.fn(),
      onCaptureSourceVisibilityHotkey: vi.fn(),
      onApply: vi.fn(),
    },
    initialPage: 'general',
    ...overrides,
  };

  render(<SettingsDialog {...props} />);
  return { project, setProjectValue, onClose, onUpdateMonitoringDevice, setReplayBufferDurationSeconds };
}

describe('SettingsDialog', () => {
  it('renders every settings page in the left nav and switches the visible page content', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    for (const label of ['General', 'Stream', 'Output', 'Audio', 'Video', 'Hotkeys', 'Advanced']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'Replay buffer duration' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    expect(screen.getByLabelText('Base canvas width')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Replay buffer duration' })).not.toBeInTheDocument();
  });

  it('disables Apply until the draft is dirty, and enables it after an edit', () => {
    renderDialog({ initialPage: 'video' });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Frame rate'), { target: { value: '60' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('shows an inline confirm before discarding a dirty draft on Cancel, and keeps editing on request', () => {
    const { onClose } = renderDialog({ initialPage: 'video' });
    fireEvent.change(screen.getByLabelText('Frame rate'), { target: { value: '60' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }));
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Frame rate')).toHaveValue(60);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately on Cancel when the draft is not dirty', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('emits only the changed patch group through its callback and closes on OK', () => {
    const { setProjectValue, onClose, onUpdateMonitoringDevice, setReplayBufferDurationSeconds } = renderDialog({ initialPage: 'video' });
    fireEvent.change(screen.getByLabelText('Frame rate'), { target: { value: '60' } });

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(setProjectValue).toHaveBeenCalledTimes(1);
    const updater = setProjectValue.mock.calls[0]![0] as (project: StreamProject) => StreamProject;
    const baseProject = createDefaultProject('win32');
    const updated = updater(baseProject);
    expect(updated.output.frameRate).toBe(60);
    expect(updated.output.baseWidth).toBe(baseProject.output.baseWidth);

    expect(onUpdateMonitoringDevice).not.toHaveBeenCalled();
    expect(setReplayBufferDurationSeconds).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables OK while a field is invalid and never closes the dialog', () => {
    const { onClose } = renderDialog({ initialPage: 'video' });
    fireEvent.change(screen.getByLabelText('Frame rate'), { target: { value: '9999' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a disabled, note-free empty state on the Stream page when no streamServiceSettings prop is provided', () => {
    renderDialog({ initialPage: 'stream' });
    expect(screen.getByText('Stream service settings unavailable')).toBeInTheDocument();
  });

  it('restores focus to the opener control on unmount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    renderDialog({ settingsOpenerRef: { current: opener } });
    cleanup();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
