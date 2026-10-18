import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Clapperboard, Copy, FileVideo, MoreHorizontal, Pause, Play, Radio, Settings2, Square, X } from 'lucide-react';
import type { StreamRuntimeStatus } from '../../shared/desktop-api';

export interface ControlsDockProps {
  style?: CSSProperties;
  resizer?: ReactNode;
  onHide: () => void;
  working: boolean;
  studioMode: boolean;
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
  onToggleStudioMode: () => void;
  onRemuxRecording: () => void;
  onOpenSettings: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export function ControlsDock({
  style,
  resizer,
  onHide,
  working,
  studioMode,
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
  onToggleStudioMode,
  onRemuxRecording,
  onOpenSettings,
}: ControlsDockProps) {
  return (
    <aside className="dock controls-dock" style={style}>
      {resizer}
      <div className="dock-title"><span>Controls</span><MoreHorizontal size={16} className="title-more" /><button className="mini-icon" aria-label="Hide Controls" onClick={onHide}><X size={14} /></button></div>
      <div className="control-action-grid">
        {streamingStartedAt === null ? <button className="control-action live-action" disabled={working} onClick={onGoLive}><Radio size={13} />Go Live</button> : <button className="control-action live-action active-action" onClick={onStopStreaming}><Square size={11} fill="currentColor" />Stop Live</button>}
        {recordingFinalizing ? <button className="control-action" disabled><span className="record-button-dot" />Finalizing</button> : recordingStartedAt === null ? <button className="control-action record-action" disabled={working} onClick={onStartRecording}><span className="record-button-dot" />Record</button> : <>
          {recordingPausedAt === null
            ? <button className="control-action pause-action" onClick={onPauseRecording}><Pause size={12} fill="currentColor" />Pause</button>
            : <button className="control-action pause-action" onClick={onResumeRecording}><Play size={12} fill="currentColor" />Resume</button>}
          <button className="control-action active-action" onClick={onStopRecording}><Square size={11} fill="currentColor" />Stop Rec</button>
        </>}
        {replayBufferStartedAt === null ? <button className="control-action" disabled={working} onClick={onStartReplayBuffer}><Radio size={13} />Start Replay Buffer</button> : <button className="control-action active-action" onClick={onStopReplayBuffer}><Square size={11} />Stop Replay Buffer</button>}
        <button className="control-action" disabled={!canSaveReplay || working} onClick={onSaveReplay}><Copy size={13} />Save Replay</button>
      </div>
      <div className="control-status-lines">
        <span><i className={`control-status-dot ${streamStatus.state === 'live' ? 'live-dot' : ''}`} />{streamStatus.state === 'live' ? `Live on ${streamServiceLabel} · ${streamDuration}` : streamStatus.state === 'connecting' ? 'Connecting…' : streamStatus.state === 'error' ? 'Stream error' : 'Offline'}</span>
        <span><i className={`control-status-dot ${recordingStartedAt !== null || recordingFinalizing ? 'record-dot' : ''}`} />{recordingFinalizing ? 'Finalizing' : recordingStartedAt === null ? 'Recording stopped' : `${recordingPausedAt === null ? 'Recording' : 'Recording paused'} · ${recordingDuration}`}</span>
        {streamStatus.state === 'live' && <span className="control-bitrate">{streamStatus.bitrateKbps ?? 0} kb/s</span>}
      </div>
      <div className="control-bottom"><button className="control-small" onClick={onToggleStudioMode}><Clapperboard size={14} />{studioMode ? 'Exit Studio Mode' : 'Studio Mode'}</button><button className="control-small" aria-label="Remux recording" title="Remux recording" disabled={working} onClick={onRemuxRecording}><FileVideo size={14} />Remux</button><button className="control-small" onClick={onOpenSettings}><Settings2 size={14} />Settings</button></div>
    </aside>
  );
}
