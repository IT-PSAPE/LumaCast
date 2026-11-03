import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationAudioPicker, CapturePicker } from '../../../../apps/stream/renderer/dialogs/pickers';
import type { CaptureAudioMode } from '../../../../apps/stream/shared/capture-audio';
import type { AudioApplicationOption, DesktopSourceOption } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

const option: DesktopSourceOption = { id: 'window:1', name: 'Editor', kind: 'window', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' };
const application: AudioApplicationOption = { pid: 321, name: 'Editor', path: '/Applications/Editor.app/Contents/MacOS/Editor' };

function renderPicker(overrides: Partial<Parameters<typeof CapturePicker>[0]> = {}) {
  const props: Parameters<typeof CapturePicker>[0] = {
    captureOptions: [option],
    captureKind: 'screen',
    captureTargetSourceId: null,
    runtimesSnapshot: new Map(),
    working: false,
    supportsSystemAudio: true,
    supportsApplicationAudio: true,
    captureAudioMode: 'off',
    setCaptureAudioMode: vi.fn<(mode: CaptureAudioMode) => void>(),
    captureAudioApplications: null,
    captureAudioApplicationLoading: false,
    selectedCaptureAudioApplication: null,
    onLoadCaptureAudioApplications: vi.fn(),
    onSelectCaptureAudioApplication: vi.fn(),
    captureCursorMode: 'motion',
    setCaptureCursorMode: vi.fn(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<CapturePicker {...props} />);
  return props;
}

describe('display capture audio selection', () => {
  it('starts with audio disabled and does not imply system audio', () => {
    renderPicker();

    expect(screen.getByRole('checkbox', { name: 'Capture audio' })).not.toBeChecked();
    expect(screen.queryByRole('combobox', { name: 'Audio source' })).not.toBeInTheDocument();
  });

  it('requires an explicit application selection when application audio is enabled', () => {
    const props = renderPicker({ captureAudioMode: 'application', captureAudioApplications: [application] });

    expect(screen.getByRole('combobox', { name: 'Audio source' })).toHaveTextContent('Application audio');
    expect(screen.getByRole('combobox', { name: 'Application' })).toHaveTextContent('Select an application');
    expect(screen.getByRole('button', { name: 'Editor' })).toBeDisabled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('displays application names without exposing process IDs in the screen picker', async () => {
    renderPicker({ captureAudioMode: 'application', captureAudioApplications: [application] });
    const applicationSelect = screen.getByRole('combobox', { name: 'Application' });
    applicationSelect.focus();
    fireEvent.keyDown(applicationSelect, { key: 'ArrowDown' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(screen.getByRole('option', { name: 'Editor' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /PID/ })).not.toBeInTheDocument();
  });

  it('loads explicit application choices when capture audio is enabled', () => {
    const props = renderPicker();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Capture audio' }));

    expect(props.setCaptureAudioMode).toHaveBeenCalledWith('application');
    expect(props.onLoadCaptureAudioApplications).toHaveBeenCalledOnce();
  });

  it('offers system audio only as an explicit source choice', async () => {
    renderPicker({ captureAudioMode: 'system' });

    const audioSource = screen.getByRole('combobox', { name: 'Audio source' });
    expect(audioSource).toHaveTextContent('System audio');
    audioSource.focus();
    fireEvent.keyDown(audioSource, { key: 'ArrowDown' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByRole('option', { name: 'Application audio' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'System audio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor' })).toBeEnabled();
  });

  it('hides audio controls when the platform has no supported combined audio path', () => {
    renderPicker({ supportsSystemAudio: false, supportsApplicationAudio: false });

    expect(screen.queryByRole('checkbox', { name: 'Capture audio' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor' })).toBeEnabled();
  });

  it('shows window audio as unsupported and keeps the selected window available', () => {
    renderPicker({
      captureKind: 'window',
      captureAudioMode: 'application',
      captureAudioApplications: [application],
    });

    expect(screen.getByRole('checkbox', { name: 'Capture audio' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Capture audio' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Window-only audio is unavailable. Use a Browser source for isolated page audio.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Audio source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Application' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Capture cursor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor' })).toBeEnabled();
  });
});

describe('application audio picker scope', () => {
  it('uses the native audio-session catalog without presenting PIDs as app names', () => {
    render(<ApplicationAudioPicker options={[application]} targetSourceId={null} runtimesSnapshot={new Map()} working={false} onChoose={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Captures audio from the selected app, including its other windows.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor' })).toBeInTheDocument();
    expect(screen.queryByText(/PID/)).not.toBeInTheDocument();
  });

  it('explains when the native catalog has no apps with audio sessions', () => {
    render(<ApplicationAudioPicker options={[]} targetSourceId={null} runtimesSnapshot={new Map()} working={false} onChoose={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('No apps with audio sessions are available.')).toBeInTheDocument();
  });
});
