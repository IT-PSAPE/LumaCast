import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ControlsDock, type ControlsDockProps } from '../../../../apps/stream/renderer/docks/controls-dock';

afterEach(cleanup);

async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

function renderDock(overrides: Partial<ControlsDockProps> = {}) {
  const props: ControlsDockProps = {
    ndiSending: false,
    onOpenNdiOutput: vi.fn(),
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
  it('blocks only streaming while a provider destination is being configured', () => {
    renderDock({ streamingStartDisabled: true });
    expect(screen.getByRole('button', { name: 'Start Streaming' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Start Replay Buffer' })).toBeEnabled();
  });

  it('shows only useful idle actions and keeps save disabled until a replay is ready', () => {
    const props = renderDock();
    for (const [label, handler] of [
      ['Start Streaming', props.onGoLive],
      ['NDI output', props.onOpenNdiOutput],
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

  it.each([false, true])('keeps NDI output in the action list with its active state (%s)', (ndiSending) => {
    const props = renderDock({ ndiSending });
    const ndi = screen.getByRole('button', { name: ndiSending ? 'NDI output · Active' : 'NDI output' });
    const actions = screen.getByRole('button', { name: 'Start Streaming' }).parentElement!;
    expect(ndi.parentElement).toBe(actions);
    expect([...actions.children].map((action) => action.textContent)).toEqual([
      'Start Streaming', ndiSending ? 'NDI output · Active' : 'NDI output', 'Record', 'Start Replay Buffer', 'Save Replay',
    ]);
    expect(ndi).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(ndi);
    expect(props.onOpenNdiOutput).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ndiStarting: true }, 'NDI output · Starting'],
    [{ ndiStopping: true }, 'NDI output · Stopping'],
    [{ ndiSending: true, ndiStopping: true }, 'NDI output · Stopping'],
  ])('keeps NDI transitions visible in Controls (%s)', (state, label) => {
    const props = renderDock(state);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(props.onOpenNdiOutput).toHaveBeenCalledOnce();
  });

  it('keeps hide in the header actions menu and disables starting actions while a task is working', async () => {
    const props = renderDock({ working: true, canSaveReplay: true });
    for (const label of ['Start Streaming', 'Record', 'Start Replay Buffer', 'Save Replay']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Controls actions' }));
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide Controls' }));
    await settle();
    expect(props.onHide).toHaveBeenCalledOnce();
  });

  it('shows and stops each active output independently, including a connecting output', () => {
    const props = renderDock({
      streamOutputs: [
        { id: 'youtube', label: 'YouTube', status: { state: 'live' }, duration: '05:41' },
        { id: 'zoom', label: 'Zoom', status: { state: 'connecting' }, duration: '' },
      ],
    });
    expect(screen.queryByRole('button', { name: 'Start Streaming' })).toBeNull();
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
