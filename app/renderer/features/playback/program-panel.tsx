import { useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, AlignLeft, Film, Image, Layers, Layers2, LayoutGrid, Pause, Play, Plus, RectangleHorizontal, SkipBack, SkipForward, Upload, Volume2, VolumeX, XCircle } from 'lucide-react';
import { NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT } from '@core/ndi';
import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Tabs } from '../../components/display/tabs';
import { Dropdown } from '../../components/form/dropdown';
import { FileTrigger } from '../../components/form/file-trigger';
import { GridSizeSlider } from '../../components/form/grid-size-slider';
import { IconGroup } from '@renderer/components/icon-group';
import { useNdi } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useOverlayEditor, useStageEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useAudio, useVideo, usePresentationLayers, useStagePlayback } from '../../contexts/playback/playback-context';
import { useElements, useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useWorkbench } from '../../contexts/workbench-context';
import type { ProgramSurfaceKind } from '../../types/ui';
import { BindingProvider } from '../canvas/binding-context';
import { AudioBinPanel } from '../assets/audio/audio-bin-panel';
import { MediaBinPanel } from '../assets/media/media-bin-panel';
import { OverlayBinPanel } from '../assets/overlays/overlay-bin-panel';
import { StageBinPanel } from '../assets/stages/stage-bin-panel';
import { useProgramOutput } from './use-program-output';
import { useProgramBindingValue, useStageBindingValue, useStageScene } from './use-stage-scene';
import { SceneStage } from '../canvas/scene-stage';

type BottomTab = 'overlays' | 'stage' | 'video' | 'audio';

export function ProgramPanel() {
  const { clearLayer, clearAllLayers, mediaLayerAsset, videoLayerAsset, contentLayerVisible, activeOverlays, overlayMode, setOverlayMode } = usePresentationLayers();
  const { currentOutputDeckItemId } = useNavigation();
  const audio = useAudio();
  const { importMedia } = useElements();
  const { createOverlay } = useOverlayEditor();
  const { createStage } = useStageEditor();
  const { setCurrentStageId: setPlaybackStageId } = useStagePlayback();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const [bottomTab, setBottomTab] = useState<BottomTab>('overlays');
  const audioImportInputRef = useRef<HTMLInputElement>(null);
  const videoImportInputRef = useRef<HTMLInputElement>(null);
  const mediaActive = Boolean(mediaLayerAsset);
  const videoActive = Boolean(videoLayerAsset);
  const contentActive = contentLayerVisible && Boolean(currentOutputDeckItemId);
  const overlayActive = activeOverlays.length > 0;
  const audioActive = audio.isPlaying || audio.currentTime > 0;

  function handleClearMedia() { clearLayer('media'); }
  function handleClearVideo() { clearLayer('video'); }
  function handleClearContent() { clearLayer('content'); }
  function handleClearOverlay() { clearLayer('overlay'); }
  function handleClearAudio() { audio.clearAudio(); }
  function handleClearAll() {
    audio.clearAudio();
    clearAllLayers();
  }

  function handleOverlayModeToggle() {
    setOverlayMode(overlayMode === 'single' ? 'multiple' : 'single');
  }

  function handleCreateOverlay() {
    void createOverlay().then(() => {
      setWorkbenchMode('overlay-editor');
    });
  }

  function handleCreateStage() {
    void createStage().then((newStageId) => {
      if (newStageId) setPlaybackStageId(newStageId);
      setWorkbenchMode('stage-editor');
    });
  }

  function handleTabChange(value: string) {
    if (value === 'overlays' || value === 'stage' || value === 'video' || value === 'audio') setBottomTab(value);
  }

  function handleAudioImportClick() {
    audioImportInputRef.current?.click();
  }

  function handleVideoImportClick() {
    videoImportInputRef.current?.click();
  }

  function handleMediaImportSelect(_files: FileList, event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files || event.target.files.length === 0) return;
    void importMedia(event.target.files);
    event.target.value = '';
  }

  const overlayModeLabel = overlayMode === 'single' ? 'Single overlay mode — click to allow multiple' : 'Multiple overlay mode — click for single';

  return (
    <LumaCastPanel.Root className='h-full border-l border-secondary' >
      <LumaCastPanel.Group>
        <ProgramModeHeader />
        <SurfacesArea />
        <IconGroup.Root fill className='rounded-none' >
          <IconGroup.Item aria-label="Clear all layers" title="Clear all layers" onClick={handleClearAll}>
            <XCircle className="size-4" />
          </IconGroup.Item>
          <IconGroup.Item active={mediaActive} aria-label="Clear media layer" title="Clear media layer" onClick={handleClearMedia}>
            <Image className="size-4" />
          </IconGroup.Item>
          <IconGroup.Item active={videoActive} aria-label="Clear video layer" title="Clear video layer" onClick={handleClearVideo}>
            <Film className="size-4" />
          </IconGroup.Item>
          <IconGroup.Item active={contentActive} aria-label="Clear content layer" title="Clear content layer" onClick={handleClearContent}>
            <AlignLeft className="size-4" />
          </IconGroup.Item>
          <IconGroup.Item active={overlayActive} aria-label="Clear overlays" title="Clear overlays" onClick={handleClearOverlay}>
            <Layers2 className="size-4" />
          </IconGroup.Item>
          <IconGroup.Item active={audioActive} aria-label="Clear audio" title="Clear audio" onClick={handleClearAudio}>
            <VolumeX className="size-4" />
          </IconGroup.Item>
        </IconGroup.Root>
      </LumaCastPanel.Group>
      <LumaCastPanel.Group className='flex-1 min-h-0' >
        <Tabs.Root value={bottomTab} onValueChange={handleTabChange}>
          <LumaCastPanel.GroupTitle>
            <Tabs.List label="Bottom panel" className="mr-auto" tabsClassName="gap-2">
              <Tabs.Trigger value="overlays">Overlays</Tabs.Trigger>
              <Tabs.Trigger value="stage">Stage</Tabs.Trigger>
              <Tabs.Trigger value="video">Video</Tabs.Trigger>
              <Tabs.Trigger value="audio">Audio</Tabs.Trigger>
            </Tabs.List>
            {bottomTab === 'overlays' ? (
              <>
                <ReacstButton.Icon label={overlayModeLabel} variant="ghost" onClick={handleOverlayModeToggle}>
                  {overlayMode === 'single' ? <Layers /> : <Layers2 />}
                </ReacstButton.Icon>
                <ReacstButton.Icon label="Add overlay" onClick={handleCreateOverlay}>
                  <Plus />
                </ReacstButton.Icon>
              </>
            ) : bottomTab === 'stage' ? (
              <ReacstButton.Icon label="Add stage" onClick={handleCreateStage}>
                <Plus />
              </ReacstButton.Icon>
            ) : bottomTab === 'video' ? (
              <>
                <FileTrigger.Root
                  hidden
                  inputRef={videoImportInputRef}
                  accept="video/*"
                  multiple
                  onSelect={handleMediaImportSelect}
                />
                <ReacstButton.Icon label="Import video" onClick={handleVideoImportClick}>
                  <Upload />
                </ReacstButton.Icon>
              </>
            ) : (
              <>
                <FileTrigger.Root
                  hidden
                  inputRef={audioImportInputRef}
                  accept="audio/*"
                  multiple
                  onSelect={handleMediaImportSelect}
                />
                <ReacstButton.Icon label="Import audio" onClick={handleAudioImportClick}>
                  <Upload />
                </ReacstButton.Icon>
              </>
            )}
          </LumaCastPanel.GroupTitle>
          {bottomTab === 'audio' ? (
            <LumaCastPanel.Content className='flex flex-col flex-1 min-h-0'>
              <div className="w-full bg-primary border-b border-secondary px-1">
                <AudioBackgroundControls />
              </div>
              <div className='flex flex-1 min-h-0 w-full'>
                <AudioBinPanel />
              </div>
            </LumaCastPanel.Content>
          ) : bottomTab === 'video' ? (
            <LumaCastPanel.Content className='flex flex-col flex-1 min-h-0'>
              <div className="w-full bg-primary border-b border-secondary px-1">
                <VideoBackgroundControls />
              </div>
              <div className='flex flex-1 min-h-0 w-full'>
                <MediaBinPanel binKind="video" />
              </div>
            </LumaCastPanel.Content>
          ) : (
            <LumaCastPanel.Content className='flex-1 min-h-0 py-2 px-1'>
              {bottomTab === 'overlays' ? (
                <OverlayBinPanel />
              ) : (
                <StageBinPanel />
              )}
            </LumaCastPanel.Content>
          )}
        </Tabs.Root>
      </LumaCastPanel.Group>
    </LumaCastPanel.Root>
  );
}

const SURFACE_LABELS: Record<ProgramSurfaceKind, string> = {
  program: 'Program',
  monitor: 'Monitor',
  stage: 'Stage',
};

const SURFACE_ORDER: ProgramSurfaceKind[] = ['program', 'monitor', 'stage'];

function ProgramModeHeader() {
  const {
    state: { programMode, programSingleSurface, programGridDensity },
    actions: { setProgramMode, setProgramSingleSurface, setProgramGridDensity },
  } = useWorkbench();

  function handleModeToggle() {
    setProgramMode(programMode === 'single' ? 'all' : 'single');
  }

  function handleSurfacePick(surface: ProgramSurfaceKind) {
    setProgramSingleSurface(surface);
  }

  function handleDensityChange(next: number) {
    if (next !== 1 && next !== 2) return;
    setProgramGridDensity(next);
  }

  return (
    <LumaCastPanel.GroupTitle>
      <ReacstButton.Icon
        variant="ghost"
        label={programMode === 'single' ? 'Switch to all program views' : 'Switch to single program view'}
        onClick={handleModeToggle}
      >
        {programMode === 'single' ? <RectangleHorizontal /> : <LayoutGrid />}
      </ReacstButton.Icon>
      {programMode === 'single' ? (
        <Dropdown className="ml-auto">
          <Dropdown.Trigger className="flex min-w-0 items-center gap-1 rounded-sm bg-tertiary px-2 py-1 text-sm text-primary transition-colors hover:bg-quaternary">
            <span className="truncate">{SURFACE_LABELS[programSingleSurface]}</span>
            <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
          </Dropdown.Trigger>
          <Dropdown.Panel placement="bottom-end">
            {SURFACE_ORDER.map((kind) => (
              <Dropdown.Item key={kind} onClick={() => handleSurfacePick(kind)}>
                {SURFACE_LABELS[kind]}
              </Dropdown.Item>
            ))}
          </Dropdown.Panel>
        </Dropdown>
      ) : (
        <span className="ml-auto">
          <GridSizeSlider value={programGridDensity} min={1} max={2} onChange={handleDensityChange} />
        </span>
      )}
    </LumaCastPanel.GroupTitle>
  );
}

function SurfacesArea() {
  const {
    state: { programMode, programSingleSurface, programGridDensity },
  } = useWorkbench();

  if (programMode === 'single') {
    return (
      <div className="flex w-full justify-center">
        <Surface kind={programSingleSurface} showBadge={false} />
      </div>
    );
  }

  // All-mode grid: slider value IS the column count. 1 = stacked vertically,
  // 2 = two columns. Each cell is a 16:9 frame so rows auto-size to identical
  // heights regardless of which surface (Program/Monitor/Stage) lands in them.
  const columnCount = programGridDensity;
  return (
    <div
      className="grid w-full gap-1"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {SURFACE_ORDER.map((kind) => (
        <Surface key={kind} kind={kind} showBadge />
      ))}
    </div>
  );
}

function Surface({ kind, showBadge }: { kind: ProgramSurfaceKind; showBadge: boolean }) {
  if (kind === 'program') return <ProgramSurface showBadge={showBadge} />;
  if (kind === 'monitor') return <MonitorSurface showBadge={showBadge} />;
  return <StageSurface showBadge={showBadge} />;
}

function ProgramSurface({ showBadge }: { showBadge: boolean }) {
  const { scene, background } = useProgramOutput();
  const bindingValue = useProgramBindingValue();
  const checkerboard = background === 'transparent';

  return (
    <BindingProvider value={bindingValue}>
      <SurfaceFrame label="Program" showLabel={showBadge} checkerboard={checkerboard}>
        <SceneStage
          scene={scene}
          surface="show"
          className="h-full w-full"
          fixedViewport={{ width: NDI_OUTPUT_WIDTH, height: NDI_OUTPUT_HEIGHT }}
          ndiCaptureSource="audience"
        />
      </SurfaceFrame>
    </BindingProvider>
  );
}

function MonitorSurface({ showBadge }: { showBadge: boolean }) {
  const { showScene } = useRenderScenes();
  const bindingValue = useProgramBindingValue();
  // Monitor mirrors what's about to go to the audience NDI feed, so its
  // transparent-background indicator follows the audience output's alpha
  // config. With alpha on, the checker shows through wherever the scene
  // lacks an opaque fill — easier to spot transparent text/elements.
  const { state: { outputConfigs } } = useNdi();
  const checkerboard = outputConfigs.audience.withAlpha;

  return (
    <BindingProvider value={bindingValue}>
      <SurfaceFrame label="Monitor" showLabel={showBadge} checkerboard={checkerboard}>
        <SceneStage scene={showScene} surface="monitor" className="h-full w-full" />
      </SurfaceFrame>
    </BindingProvider>
  );
}

function StageSurface({ showBadge }: { showBadge: boolean }) {
  const stageScene = useStageScene();
  const bindingValue = useStageBindingValue();

  // Mirrors the configured alpha for the stage NDI sender so the operator
  // sees exactly what the stage feed would look like over a transparent base.
  const { state: { outputConfigs } } = useNdi();
  const checkerboard = outputConfigs.stage.withAlpha;

  return (
    <BindingProvider value={bindingValue}>
      <SurfaceFrame label="Stage" showLabel={showBadge} checkerboard={checkerboard}>
        <SceneStage
          scene={stageScene}
          surface="stage"
          className="h-full w-full"
          fixedViewport={{ width: NDI_OUTPUT_WIDTH, height: NDI_OUTPUT_HEIGHT }}
          ndiCaptureSource="stage"
        />
      </SurfaceFrame>
    </BindingProvider>
  );
}

function VideoBackgroundControls() {
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

function AudioBackgroundControls() {
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

// Single 16:9 frame used by every surface so grid rows auto-size to identical
// heights and the panel label (in all-mode only) can float on top instead of
// stealing a row above. In single mode the dropdown already names the surface,
// so the floating badge would be redundant.
function SurfaceFrame({ label, showLabel, checkerboard = false, children }: { label: string; showLabel: boolean; checkerboard?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="relative max-h-full max-w-full w-full overflow-hidden bg-black"
      style={{ aspectRatio: `${NDI_OUTPUT_WIDTH} / ${NDI_OUTPUT_HEIGHT}` }}
    >
      {checkerboard ? (
        <div className="pointer-events-none absolute inset-0 bg-[repeating-conic-gradient(var(--color-background-tertiary)_0%_25%,var(--color-background-quaternary)_0%_50%)] bg-[length:24px_24px]" />
      ) : null}
      <div className="absolute inset-0">{children}</div>
      {showLabel ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
          {label}
        </span>
      ) : null}
    </div>
  );
}
