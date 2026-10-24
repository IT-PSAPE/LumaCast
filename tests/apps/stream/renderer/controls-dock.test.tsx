import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ControlsDock, type ControlsDockProps } from '../../../../apps/stream/renderer/docks/controls-dock';

afterEach(cleanup);

function renderDock(overrides: Partial<ControlsDockProps> = {}) {
  const props: ControlsDockProps = {
    onHide: vi.fn(),
    working: false,
    streamingStartedAt: null,
    streamServiceLabel: 'YouTube',
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
    streamStatus: { state: 'stopped', message: '' },
    streamDuration: '00:00',
    recordingDuration: '00:00',
    onRemuxRecording: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<ControlsDock {...props} />);
  return props;
}

describe('ControlsDock', () => {
  it('keeps the idle output and utility actions available through shared buttons', () => {
    const props = renderDock();
    for (const [label, handler] of [
      ['Go Live', props.onGoLive],
      ['Record', props.onStartRecording],
      ['Start Replay Buffer', props.onStartReplayBuffer],
      ['Remux recording', props.onRemuxRecording],
      ['Settings', props.onOpenSettings],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(handler).toHaveBeenCalledOnce();
    }
    expect(screen.getByRole('button', { name: 'Save Replay' })).toBeDisabled();
  });

  it('prevents starting outputs and remuxing while working', () => {
    const props = renderDock({ working: true, canSaveReplay: true });
    for (const label of ['Go Live', 'Record', 'Start Replay Buffer', 'Save Replay', 'Remux recording']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(props.onStartRecording).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeEnabled();
  });

  it('keeps stop, pause, and replay actions available while outputs are active', () => {
    const props = renderDock({ streamingStartedAt: 1, recordingStartedAt: 1, replayBufferStartedAt: 1, canSaveReplay: true });
    for (const [label, handler] of [
      ['Stop Live', props.onStopStreaming],
      ['Pause', props.onPauseRecording],
      ['Stop Rec', props.onStopRecording],
      ['Stop Replay Buffer', props.onStopReplayBuffer],
      ['Save Replay', props.onSaveReplay],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(handler).toHaveBeenCalledOnce();
    }
  });

  it('offers resume for a paused recording and disables a finalizing recording', () => {
    const props = renderDock({ recordingStartedAt: 1, recordingPausedAt: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(props.onResumeRecording).toHaveBeenCalledOnce();
    cleanup();
    renderDock({ recordingFinalizing: true });
    expect(screen.getByRole('button', { name: 'Finalizing' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
  });
});
