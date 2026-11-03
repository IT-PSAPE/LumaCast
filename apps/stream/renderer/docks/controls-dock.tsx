import { type CSSProperties, type ReactNode } from 'react';
import { Copy, Network, Pause, Play, Radio, SlidersHorizontal, Square } from 'lucide-react';
import { Panel, ReacstButton, StatusDot } from '@lumacast/ui';
import { DockHeader } from './dock-header';
import type { StreamRuntimeStatus } from '../../shared/desktop-api';
import './controls-dock.css';

export interface ControlsDockProps {
  ndiSending: boolean;
  ndiStarting?: boolean;
  ndiStopping?: boolean;
  onOpenNdiOutput: () => void;
  style?: CSSProperties;
  resizer?: ReactNode;
  onHide: () => void;
  working: boolean;
  streamingStartDisabled?: boolean;
  streamOutputs: Array<{ id: string; label: string; status: StreamRuntimeStatus; duration: string }>;
  onGoLive: () => void;
  onStopStreaming: (outputId: string) => void;
  recordingFinalizing: boolean;
  recordingStartedAt: number | null;
  recordingPausedAt: number | null;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStopRecording: () => void;
  replayBufferStartedAt: number | null;
  onStartReplayBuffer: () => void;
  onStopReplayBuffer: () => void;
  canSaveReplay: boolean;
  onSaveReplay: () => void;
  recordingDuration: string;
}

export function ControlsDock({
  ndiSending,
  ndiStarting = false,
  ndiStopping = false,
  onOpenNdiOutput,
  style,
  resizer,
  onHide,
  working,
  streamingStartDisabled = false,
  streamOutputs,
  onGoLive,
  onStopStreaming,
  recordingFinalizing,
  recordingStartedAt,
  recordingPausedAt,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  replayBufferStartedAt,
  onStartReplayBuffer,
  onStopReplayBuffer,
  canSaveReplay,
  onSaveReplay,
  recordingDuration,
}: ControlsDockProps) {
  const activeOutputs = streamOutputs.filter(({ status }) => status.state === 'live' || status.state === 'connecting');
  const failedOutputs = streamOutputs.filter(({ status }) => status.state === 'error');
  const ndiState = ndiStopping ? 'Stopping' : ndiStarting ? 'Starting' : ndiSending ? 'Active' : '';

  return (
    <Panel density="compact" className="dock controls-dock" style={style}>
      {resizer}
      <DockHeader title="Controls" icon={<SlidersHorizontal />} onHide={onHide} />

      <div className="control-body">
        <div className="control-rows">
          {activeOutputs.length === 0
            ? <ReacstButton className="control-row control-action" variant="success" disabled={working || streamingStartDisabled} onClick={onGoLive}><Radio size={13} />Start Streaming</ReacstButton>
            : activeOutputs.map(({ id, label, status, duration }) => {
              const connecting = status.state === 'connecting';
              const actionLabel = connecting ? `Cancel ${label}` : `Stop ${label}`;
              return (
                <div className="control-output-row" key={id}>
                  <span className="control-output-state"><StatusDot tone={connecting ? 'warning' : 'success'} />{connecting ? `Connecting · ${label}` : `Live · ${label}`}</span>
                  {!connecting && <span className="control-duration" aria-label={`${label} duration`}>{duration}</span>}
                  <ReacstButton className="control-row-action control-output-action" variant="danger" size="sm" aria-label={actionLabel} onClick={() => onStopStreaming(id)}>
                    <Square size={11} fill="currentColor" />{connecting ? 'Cancel' : 'Stop'}
                  </ReacstButton>
                </div>
              );
            })}

          {failedOutputs.map(({ id, label, status }) => (
            <div className="control-output-error" role="alert" key={`error-${id}`}>
              <StatusDot tone="error" />
              <span><strong>{label}</strong>{status.message ? ` · ${status.message}` : ' · Could not connect'}</span>
            </div>
          ))}

          <ReacstButton className="control-row control-action" aria-haspopup="dialog" onClick={onOpenNdiOutput}>
            <Network size={13} />NDI output{ndiState ? ` · ${ndiState}` : ''}
          </ReacstButton>

          {recordingFinalizing ? (
            <ReacstButton className="control-row control-action" disabled><StatusDot tone="error" size="md" />Finalizing recording…</ReacstButton>
          ) : recordingStartedAt === null ? (
            <ReacstButton className="control-row control-action" disabled={working} onClick={onStartRecording}><StatusDot tone="error" size="md" />Record</ReacstButton>
          ) : (
            <div className="control-recording-row">
              <span className="control-output-state"><StatusDot tone="error" />{recordingPausedAt === null ? 'Recording' : 'Paused'}</span>
              <span className="control-duration" aria-label="Recording duration">{recordingDuration}</span>
              {recordingPausedAt === null
                ? <ReacstButton className="control-row-action control-recording-action" size="sm" aria-label="Pause recording" onClick={onPauseRecording}><Pause size={12} fill="currentColor" />Pause</ReacstButton>
                : <ReacstButton className="control-row-action control-recording-action" size="sm" aria-label="Resume recording" onClick={onResumeRecording}><Play size={12} fill="currentColor" />Resume</ReacstButton>}
              <ReacstButton className="control-row-action control-recording-stop" variant="danger" size="sm" aria-label="Stop recording" onClick={onStopRecording}><Square size={11} fill="currentColor" />Stop</ReacstButton>
            </div>
          )}

          <ReacstButton className="control-row control-action" variant={replayBufferStartedAt === null ? 'default' : 'danger'} disabled={replayBufferStartedAt === null ? working : false} onClick={replayBufferStartedAt === null ? onStartReplayBuffer : onStopReplayBuffer}>
            {replayBufferStartedAt === null ? <><Radio size={13} />Start Replay Buffer</> : <><Square size={11} fill="currentColor" />Stop Replay Buffer</>}
          </ReacstButton>
          <ReacstButton className="control-row control-action" disabled={!canSaveReplay || working} onClick={onSaveReplay}><Copy size={13} />Save Replay</ReacstButton>
        </div>
      </div>
    </Panel>
  );
}
