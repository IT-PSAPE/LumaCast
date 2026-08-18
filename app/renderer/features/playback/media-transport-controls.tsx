import { useRef, useState } from 'react';
import { Pause, Play, Repeat, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { useAudio, useVideo } from '../../contexts/playback/playback-context';

// Transport for the armed video/audio asset. These live next to the video and
// audio bins in the resource drawer — arming a clip and driving it are the same
// operator gesture, so the controls sit above the bin that arms them.

export function VideoTransportControls() {
  const video = useVideo();
  const armed = video.currentVideoAsset;
  const hasVideo = Boolean(armed);
  const safeDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draftTime, setDraftTime] = useState(0);
  const resumeAfterScrubRef = useRef(false);

  function handleSeek(event: React.ChangeEvent<HTMLInputElement>) {
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    setDraftTime(next);
    video.seekTo(next);
  }

  function handleScrubStart() {
    if (!hasVideo || safeDuration === 0) return;
    resumeAfterScrubRef.current = video.isPlaying;
    setDraftTime(Math.min(video.currentTime, safeDuration));
    setIsScrubbing(true);
    if (video.isPlaying) video.pause();
  }

  function handleScrubEnd() {
    if (!isScrubbing) return;
    setIsScrubbing(false);
    if (resumeAfterScrubRef.current) {
      video.play();
    }
    resumeAfterScrubRef.current = false;
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-secondary/40 p-2 mt-2">
      <div className="flex min-w-0 items-center gap-1">
        <ReacstButton.Icon variant="ghost" label="Previous video" disabled={!hasVideo} onClick={video.playPrevious}>
          <SkipBack />
        </ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" label={video.isPlaying ? 'Pause' : 'Play'} disabled={!hasVideo} onClick={video.togglePlayback}>
          {video.isPlaying ? <Pause /> : <Play />}
        </ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" label={video.muted ? 'Unmute video' : 'Mute video'} disabled={!hasVideo} onClick={video.toggleMuted}>
          {video.muted ? <VolumeX /> : <Volume2 />}
        </ReacstButton.Icon>
        <ReacstButton.Icon
          variant="ghost"
          active={video.loopEnabled}
          label={video.loopEnabled ? 'Loop on — click to stop at end' : 'Loop off — click to repeat'}
          onClick={video.toggleLoop}
        >
          <Repeat />
        </ReacstButton.Icon>
        <ReacstButton.Icon variant="ghost" label="Next video" disabled={!hasVideo} onClick={video.playNext}>
          <SkipForward />
        </ReacstButton.Icon>
        <span className={`min-w-0 flex-1 truncate pl-2 text-xs ${hasVideo ? 'text-secondary' : 'text-tertiary'}`}>
          {armed?.name ?? 'No video armed'}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={0.1}
          value={isScrubbing ? draftTime : Math.min(video.currentTime, safeDuration)}
          onChange={handleSeek}
          onMouseDown={handleScrubStart}
          onMouseUp={handleScrubEnd}
          onTouchStart={handleScrubStart}
          onTouchEnd={handleScrubEnd}
          onBlur={handleScrubEnd}
          disabled={!hasVideo || safeDuration === 0}
          aria-label="Video scrubber"
          className="w-full accent-brand_solid disabled:opacity-40"
        />
        <div className="flex items-center justify-between text-[10px] tabular-nums text-tertiary">
          <span>{formatPlaybackTime(isScrubbing ? draftTime : video.currentTime)}</span>
          <span>{formatPlaybackTime(safeDuration)}</span>
        </div>
      </div>
    </div>
  );
}

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

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
