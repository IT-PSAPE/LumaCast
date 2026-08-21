import { useRef, useState } from 'react';
import { Pause, Play, Repeat, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { useAudio } from '../../contexts/playback/playback-context';
import { formatPlaybackTime } from './format-playback-time';

// Transport for the armed audio asset. It mirrors the video transport (same
// operator gesture, arming then driving) and sits above the audio bin.
export function AudioTransportControls() {
  const audio = useAudio();
  const armed = audio.currentAudioAsset;
  const hasAudio = Boolean(armed);
  const safeDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draftTime, setDraftTime] = useState(0);
  const resumeAfterScrubRef = useRef(false);

  function handleSeek(event: React.ChangeEvent<HTMLInputElement>) {
    const next = Number(event.target.value);
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
    <div className="flex flex-col gap-1.5 rounded-md bg-secondary/40 p-2 mt-2">
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
      </div>
      <div className="flex flex-col gap-0.5">
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={0.1}
          value={isScrubbing ? draftTime : Math.min(audio.currentTime, safeDuration)}
          onChange={handleSeek}
          onMouseDown={handleScrubStart}
          onMouseUp={handleScrubEnd}
          onTouchStart={handleScrubStart}
          onTouchEnd={handleScrubEnd}
          onBlur={handleScrubEnd}
          disabled={!hasAudio || safeDuration === 0}
          aria-label="Audio scrubber"
          className="w-full accent-brand_solid disabled:opacity-40"
        />
        <div className="flex items-center justify-between text-[10px] tabular-nums text-tertiary">
          <span>{formatPlaybackTime(isScrubbing ? draftTime : audio.currentTime)}</span>
          <span>{formatPlaybackTime(safeDuration)}</span>
        </div>
      </div>
    </div>
  );
}
