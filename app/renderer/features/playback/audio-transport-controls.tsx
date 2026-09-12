import { VolumeControl } from './volume-control';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Repeat, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { useAudio } from '../../contexts/playback/playback-context';
import { useWorkbench } from '../../contexts/workbench-context';
import { AudioWaveformTrack } from './audio-waveform-track';
import { AudioSyncEditor, useAudioSync } from './audio-sync-editor';

function isEditableTargetScoped(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable || target.closest<HTMLElement>('[contenteditable="true"]') !== null;
}

// The marker shortcut is deliberately narrow: it only fires while focus sits
// inside an audio-focus scope (transport or audio bin), never from editable
// controls, with modifier keys, on auto-repeat, once consumed, or while an
// overlay is open.
function canRecordAudioMarker(event: KeyboardEvent): boolean {
  if (event.repeat) return false;
  if (event.key !== 'm' && event.key !== 'M') return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (isEditableTargetScoped(target as HTMLElement)) return false;
  if (target.closest('[data-shortcuts-scope="ignore"]')) return false;
  return target.closest('[data-shortcuts-scope="audio-focus"]') !== null;
}

// Transport for the armed audio asset. It mirrors the video transport (same
// operator gesture, arming then driving), sits above the audio bin, and hosts
// the record-audio-marker button (M) plus the audio sync editor.
export function AudioTransportControls() {
  const audio = useAudio();
  const audioSync = useAudioSync();
  const { overlayStack } = useWorkbench();
  const armed = audio.currentAudioAsset;
  const hasAudio = Boolean(armed);
  const safeDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draftTime, setDraftTime] = useState(0);
  const resumeAfterScrubRef = useRef(false);
  const overlayOpen = overlayStack.stack.length > 0;

  function handleMarkerShortcut(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (overlayOpen) return;
    if (!hasAudio || !audioSync.assetId || !canRecordAudioMarker(event)) return;
    event.preventDefault();
    audioSync.record();
  }

  useEffect(() => {
    window.addEventListener('keydown', handleMarkerShortcut);
    return () => window.removeEventListener('keydown', handleMarkerShortcut);
    // `audioSync.record` stays stable between playback ticks (it only changes
    // on draft edits), so the listener is not re-registered on every timeupdate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSync.record, audioSync.assetId, hasAudio, overlayOpen]);

  function handleSeek(next: number) {
    if (!Number.isFinite(next)) return;
    setDraftTime(next);
    audio.seekTo(next);
  }

  function handleScrubStart() {
    if (!hasAudio || safeDuration === 0) return;
    resumeAfterScrubRef.current = audio.isPlaying;
    setDraftTime(Math.min(audio.currentTime, safeDuration));
    setIsScrubbing(true);
    if (audio.isPlaying) audio.pause();
  }

  function handleScrubEnd() {
    if (!isScrubbing) return;
    setIsScrubbing(false);
    if (resumeAfterScrubRef.current) {
      audio.play();
    }
    resumeAfterScrubRef.current = false;
  }

  return (
    <div data-shortcuts-scope="audio-focus" className="flex flex-col gap-1.5 rounded-md bg-secondary/40 p-2 mt-2">
      <div className="flex min-w-0 items-center gap-1">
        <ReacstButton.Icon variant="ghost" label="Previous track" disabled={!hasAudio} onClick={audio.playPrevious}>
          <SkipBack />
        </ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" label={audio.isPlaying ? 'Pause' : 'Play'} disabled={!hasAudio} onClick={audio.togglePlayback}>
          {audio.isPlaying ? <Pause /> : <Play />}
        </ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" label={audio.muted ? 'Unmute audio' : 'Mute audio'} disabled={!hasAudio} onClick={audio.toggleMuted}>
          {audio.muted ? <VolumeX /> : <Volume2 />}
        </ReacstButton.Icon>
        <VolumeControl kind="Audio" volume={audio.volume} disabled={!hasAudio} onChange={audio.setVolume} />
        <ReacstButton.Icon
          variant="ghost"
          active={audio.loopEnabled}
          label={audio.loopEnabled ? 'Loop on — click to stop at end' : 'Loop off — click to repeat'}
          onClick={audio.toggleLoop}
        >
          <Repeat />
        </ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" label="Next track" disabled={!hasAudio} onClick={audio.playNext}>
          <SkipForward />
        </ReacstButton.Icon>
        <span className={`min-w-0 flex-1 truncate pl-2 text-xs ${hasAudio ? 'text-secondary' : 'text-tertiary'}`}>
          {armed?.name ?? 'No audio armed'}
        </span>
        {hasAudio ? <AudioSyncEditor controller={audioSync} /> : null}
        <ReacstButton variant="ghost" label="Add marker (M)" disabled={!hasAudio || !audioSync.assetId} onClick={audioSync.record}>
          M
        </ReacstButton>
      </div>
      <AudioWaveformTrack key={armed?.id ?? 'empty'} src={armed?.src} duration={safeDuration}
        currentTime={isScrubbing ? draftTime : audio.currentTime} disabled={!hasAudio} controller={audioSync}
        onSeek={handleSeek} onScrubStart={handleScrubStart} onScrubEnd={handleScrubEnd} />
      {audioSync.error ? <div role="alert" className="text-xs text-error_primary">{audioSync.error}</div> : null}
    </div>
  );
}