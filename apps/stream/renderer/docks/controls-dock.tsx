import { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Copy, FileVideo, MoreHorizontal, Pause, Play, Radio, Settings2, Square, X } from 'lucide-react';
import { DropdownMenu, Panel, ReacstButton, StatusDot, type MenuEntry } from '@lumacast/ui';
import type { StreamRuntimeStatus } from '../../shared/desktop-api';

export interface ControlsDockProps {
  style?: CSSProperties;
  resizer?: ReactNode;
  onHide: () => void;
  working: boolean;
  streamingStartedAt: number | null;
  streamServiceLabel: string;
  onGoLive: () => void;
  onStopStreaming: () => void;
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
  streamStatus: StreamRuntimeStatus;
  streamDuration: string;
  recordingDuration: string;
  onRemuxRecording: () => void;
  onOpenSettings: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export function ControlsDock({
  style,
  resizer,
  onHide,
  working,
  streamingStartedAt,
  streamServiceLabel,
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
  streamStatus,
  streamDuration,
  recordingDuration,
  onRemuxRecording,
  onOpenSettings,
}: ControlsDockProps) {
  const options: MenuEntry[] = [
    { id: 'controls.hide', label: 'Hide Controls', onSelect: onHide },
  ];

  return (
    <Panel density="compact" className="dock controls-dock" style={style}>
      {resizer}
      <Panel.Header data-dock-handle className="cursor-grab select-none">
        <Panel.HeaderTitle>Controls</Panel.HeaderTitle>
        <Panel.HeaderActions>
          <DropdownMenu
            align="end"
            sideOffset={2}
            entries={options}
            trigger={<ReacstButton.Icon variant="ghost" size="sm" label="Controls options"><MoreHorizontal /></ReacstButton.Icon>}
          />

          <ReacstButton.Icon variant="ghost" size="sm" label="Hide Controls" onClick={onHide}><X /></ReacstButton.Icon>
        </Panel.HeaderActions>
      </Panel.Header>
      <div className="control-body">
        <div className="control-action-grid">
          {streamingStartedAt === null ? <ReacstButton className="control-action" variant="take" disabled={working} onClick={onGoLive}><Radio size={13} />Go Live</ReacstButton> : <ReacstButton className="control-action" variant="danger" onClick={onStopStreaming}><Square size={11} fill="currentColor" />Stop Live</ReacstButton>}
          {recordingFinalizing ? <ReacstButton className="control-action" disabled><StatusDot tone="error" size="md" />Finalizing</ReacstButton> : recordingStartedAt === null ? <ReacstButton className="control-action" disabled={working} onClick={onStartRecording}><StatusDot tone="error" size="md" />Record</ReacstButton> : <>
            {recordingPausedAt === null
              ? <ReacstButton className="control-action" onClick={onPauseRecording}><Pause size={12} fill="currentColor" />Pause</ReacstButton>
              : <ReacstButton className="control-action" onClick={onResumeRecording}><Play size={12} fill="currentColor" />Resume</ReacstButton>}
            <ReacstButton className="control-action" variant="danger" onClick={onStopRecording}><Square size={11} fill="currentColor" />Stop Rec</ReacstButton>
          </>}
          {replayBufferStartedAt === null ? <ReacstButton className="control-action" disabled={working} onClick={onStartReplayBuffer}><Radio size={13} />Start Replay Buffer</ReacstButton> : <ReacstButton className="control-action" variant="danger" onClick={onStopReplayBuffer}><Square size={11} />Stop Replay Buffer</ReacstButton>}
          <ReacstButton className="control-action" disabled={!canSaveReplay || working} onClick={onSaveReplay}><Copy size={13} />Save Replay</ReacstButton>
        </div>
        <div className="control-status-lines">
          <span><StatusDot tone={streamStatus.state === 'live' ? 'error' : 'neutral'} />{streamStatus.state === 'live' ? `Live on ${streamServiceLabel} · ${streamDuration}` : streamStatus.state === 'connecting' ? 'Connecting…' : streamStatus.state === 'error' ? 'Stream error' : 'Offline'}</span>
          <span><StatusDot tone={recordingStartedAt !== null || recordingFinalizing ? 'error' : 'neutral'} />{recordingFinalizing ? 'Finalizing' : recordingStartedAt === null ? 'Recording stopped' : `${recordingPausedAt === null ? 'Recording' : 'Recording paused'} · ${recordingDuration}`}</span>
          {streamStatus.state === 'live' && <span className="control-bitrate">{streamStatus.bitrateKbps ?? 0} kb/s</span>}
        </div>
      </div>
      <div className="control-bottom"><ReacstButton className="control-small" label="Remux recording" disabled={working} onClick={onRemuxRecording}><FileVideo size={14} />Remux</ReacstButton><ReacstButton className="control-small" onClick={onOpenSettings}><Settings2 size={14} />Settings</ReacstButton></div>
    </Panel>
  );
}
