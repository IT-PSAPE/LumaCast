// Playback transport, timecode readout, the tap tool toggle, and zoom
// controls. Every interaction goes through a store action — this component
// holds no playback or view state of its own beyond the timecode/clock
// display toggle.
import { useState } from 'react';
import {
  ChevronFirst,
  ChevronLast,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ReacstButton } from '@lumacast/ui';
import { nextCueStart, previousCueStart } from '../../../shared/cue-model';
import { useChordStore } from '../../store';
import { formatClock, formatTimecode, timelineEndMs } from '../playback';

const ZOOM_MIN_PX_PER_SEC = 10;
const ZOOM_MAX_PX_PER_SEC = 800;
const ZOOM_WHEEL_FACTOR = 1.25;

export function TransportBar() {
  const playing = useChordStore((state) => state.playback.playing);
  const loop = useChordStore((state) => state.playback.loop);
  const timeMs = useChordStore((state) => state.playback.timeMs);
  const zoom = useChordStore((state) => state.timeline.zoom);
  const tool = useChordStore((state) => state.tool);
  const project = useChordStore((state) => state.document.project);
  const togglePlay = useChordStore((state) => state.togglePlay);
  const seek = useChordStore((state) => state.seek);
  const stepFrames = useChordStore((state) => state.stepFrames);
  const setLoop = useChordStore((state) => state.setLoop);
  const setTool = useChordStore((state) => state.setTool);
  const setTimelineView = useChordStore((state) => state.setTimelineView);
  const zoomBy = useChordStore((state) => state.zoomBy);
  const zoomToFit = useChordStore((state) => state.zoomToFit);
  const addCue = useChordStore((state) => state.addCue);

  const [showFrames, setShowFrames] = useState(true);

  const cues = project.cues;
  const fps = project.composition.fps;
  const totalMs = timelineEndMs(project);
  const currentLabel = showFrames ? formatTimecode(timeMs, fps) : formatClock(timeMs);
  const totalLabel = showFrames ? formatTimecode(totalMs, fps) : formatClock(totalMs);

  function goToPreviousCue() {
    seek(previousCueStart(cues, timeMs) ?? 0);
  }

  function goToNextCue() {
    const target = nextCueStart(cues, timeMs);
    if (target !== null) seek(target);
  }

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-secondary bg-primary px-2"
      data-ui-region="transport-bar"
    >
      <ReacstButton.Icon label="Go to start" onClick={() => seek(0)}>
        <ChevronFirst />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Previous cue" onClick={goToPreviousCue}>
        <SkipBack />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Step back one frame" onClick={() => stepFrames(-1)}>
        <StepBack />
      </ReacstButton.Icon>
      <ReacstButton.Icon label={playing ? 'Pause' : 'Play'} variant="take" active={playing} onClick={togglePlay}>
        {playing ? <Pause /> : <Play />}
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Step forward one frame" onClick={() => stepFrames(1)}>
        <StepForward />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Next cue" onClick={goToNextCue}>
        <SkipForward />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Go to end" onClick={() => seek(totalMs)}>
        <ChevronLast />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Loop" active={loop} onClick={() => setLoop(!loop)}>
        <Repeat />
      </ReacstButton.Icon>

      <button
        type="button"
        className="ml-1 shrink-0 rounded-sm px-1.5 py-1 label-xs tabular-nums text-secondary hover:bg-tertiary hover:text-primary"
        onClick={() => setShowFrames((current) => !current)}
        title="Toggle timecode / clock"
      >
        {currentLabel} / {totalLabel}
      </button>

      <ReacstButton
        variant="ghost"
        active={tool === 'tap'}
        title="Tap tool — T, then M to mark"
        onClick={() => setTool(tool === 'tap' ? 'select' : 'tap')}
      >
        Tap
      </ReacstButton>
      {tool === 'tap' ? <span className="label-xs text-tertiary">Tap M to mark</span> : null}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ReacstButton.Icon label="Zoom out" onClick={() => zoomBy(1 / ZOOM_WHEEL_FACTOR)}>
          <ZoomOut />
        </ReacstButton.Icon>
        <input
          type="range"
          aria-label="Zoom"
          min={ZOOM_MIN_PX_PER_SEC}
          max={ZOOM_MAX_PX_PER_SEC}
          step={1}
          value={Math.min(ZOOM_MAX_PX_PER_SEC, Math.max(ZOOM_MIN_PX_PER_SEC, zoom))}
          onChange={(event) => setTimelineView({ zoom: Number(event.target.value) })}
          className="w-24"
        />
        <ReacstButton.Icon label="Zoom in" onClick={() => zoomBy(ZOOM_WHEEL_FACTOR)}>
          <ZoomIn />
        </ReacstButton.Icon>
        <ReacstButton variant="ghost" onClick={zoomToFit}>Fit</ReacstButton>
        <ReacstButton onClick={() => addCue(timeMs)}>
          <Plus className="size-3.5" />
          Cue
        </ReacstButton>
      </div>
    </div>
  );
}
