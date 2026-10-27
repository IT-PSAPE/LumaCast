import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ControlsDock, type ControlsDockProps } from '../../../../apps/stream/renderer/docks/controls-dock';

afterEach(cleanup);

function renderDock(overrides: Partial<ControlsDockProps> = {}) {
  const props: ControlsDockProps = {
    onHide: vi.fn(),
    working: false,
    streamOutputs: [],
    onGoLive: vi.fn(),
    onStopStreaming: vi.fn(),
    recordingFinalizing: false,
    recordingStartedAt: null,
    recordingPausedAt: null,
    onStartRecording: vi.fn(),
    onPauseRecording: vi.fn(),
    onResumeRecording: vi.fn(),
    onStopRecording: vi.fn(),
    replayBufferStartedAt: null,
    onStartReplayBuffer: vi.fn(),
    onStopReplayBuffer: vi.fn(),
    canSaveReplay: false,
    onSaveReplay: vi.fn(),
    recordingDuration: '00:00',
    ...overrides,
  };
  render(<ControlsDock {...props} />);
  return props;
}

describe('ControlsDock', () => {
  it('shows only useful idle actions and keeps save disabled until a replay is ready', () => {
    const props = renderDock();
    for (const [label, handler] of [
      ['Go Live', props.onGoLive],
      ['Record', props.onStartRecording],
      ['Start Replay Buffer', props.onStartReplayBuffer],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(handler).toHaveBeenCalledOnce();
    }
    expect(screen.getByRole('button', { name: 'Save Replay' })).toBeDisabled();
    expect(screen.queryByText('Offline')).toBeNull();
    expect(screen.queryByText('Recording stopped')).toBeNull();
    expect(screen.queryByRole('button', { name: /Controls options|Remux|Settings/ })).toBeNull();
  });

  it('keeps the hide control and disables starting actions while a task is working', () => {
    const props = renderDock({ working: true, canSaveReplay: true });
    for (const label of ['Go Live', 'Record', 'Start Replay Buffer', 'Save Replay']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Hide Controls' }));
    expect(props.onHide).toHaveBeenCalledOnce();
  });

  it('shows and stops each active output independently, including a connecting output', () => {
    const props = renderDock({
      streamOutputs: [
        { id: 'youtube', label: 'YouTube', status: { state: 'live' }, duration: '05:41' },
        { id: 'zoom', label: 'Zoom', status: { state: 'connecting' }, duration: '' },
      ],
    });
    expect(screen.queryByRole('button', { name: 'Go Live' })).toBeNull();
    expect(screen.getByText('Live · YouTube')).toBeTruthy();
    expect(screen.getByText('Connecting · Zoom')).toBeTruthy();
    expect(screen.getByLabelText('YouTube duration').textContent).toBe('05:41');
    expect(screen.queryByLabelText('Zoom duration')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop YouTube' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Zoom' }));
    expect(props.onStopStreaming).toHaveBeenNthCalledWith(1, 'youtube');
    expect(props.onStopStreaming).toHaveBeenNthCalledWith(2, 'zoom');
  });

  it('keeps every destination error visible while another destination is active', () => {
    renderDock({
      streamOutputs: [
        { id: 'twitch', label: 'Twitch', status: { state: 'error', message: 'Authentication expired' }, duration: '' },
        { id: 'youtube', label: 'YouTube', status: { state: 'live' }, duration: '01:20' },
        { id: 'facebook', label: 'Facebook', status: { state: 'error', message: '' }, duration: '' },
      ],
    });
    expect(screen.getAllByRole('alert')[0].textContent).toContain('Twitch · Authentication expired');
    expect(screen.getAllByRole('alert')[1].textContent).toContain('Facebook · Could not connect');
    expect(screen.getByText('Live · YouTube')).toBeTruthy();
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('keeps active recording controls, duration, and replay actions available', () => {
    const props = renderDock({ recordingStartedAt: 1, recordingDuration: '02:34', replayBufferStartedAt: 2, canSaveReplay: true });
    expect(screen.getByText('Recording')).toBeTruthy();
    expect(screen.getByLabelText('Recording duration').textContent).toBe('02:34');
    for (const [label, handler] of [
      ['Pause recording', props.onPauseRecording],
      ['Stop recording', props.onStopRecording],
      ['Stop Replay Buffer', props.onStopReplayBuffer],
      ['Save Replay', props.onSaveReplay],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(handler).toHaveBeenCalledOnce();
    }
  });

  it('offers resume while paused and gives disabled feedback during finalization', () => {
    const props = renderDock({ recordingStartedAt: 1, recordingPausedAt: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Resume recording' }));
    expect(props.onResumeRecording).toHaveBeenCalledOnce();
    cleanup();
    renderDock({ recordingFinalizing: true });
    expect(screen.getByRole('button', { name: 'Finalizing recording…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
  });
});
