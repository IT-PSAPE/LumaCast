import { useState } from 'react';
import { ChevronDown, AlignLeft, Film, Image, Layers, Layers2, LayoutGrid, Pencil, Plus, RectangleHorizontal, VolumeX, XCircle } from 'lucide-react';
import { NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT } from '@lumacast/protocol';
import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Tabs } from '../../components/display/tabs';
import { Dropdown } from '../../components/form/dropdown';
import { GridSizeSlider } from '../../components/form/grid-size-slider';
import { IconGroup } from '@renderer/components/icon-group';
import { useNdi } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useOverlayEditor, useStageEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useAudio, usePresentationLayers, useStagePlayback } from '../../contexts/playback/playback-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useWorkbench } from '../../contexts/workbench-context';
import type { ProgramSurfaceKind } from '../../types/ui';
import { BindingProvider } from '@lumacast/canvas';
import { OverlayBinPanel } from '../assets/overlays/overlay-bin-panel';
import { StageBinPanel } from '../assets/stages/stage-bin-panel';
import { MacroBinPanel } from '../automation/macro-bin-panel';
import { useAutomation } from '../automation/automation-context';
import { dispatchAutomationTriggerEvent } from '../automation/automation-events';
import { useProgramOutput } from './use-program-output';
import { useProgramBindingValue, useStageBindingValue, useStageScene } from './use-stage-scene';
import { SceneStage } from '../canvas/scene-stage';

type BottomTab = 'overlays' | 'stage' | 'macros';

export function ProgramPanel() {
  const { clearLayer, clearAllLayers, mediaLayerAsset, videoLayerAsset, contentLayerVisible, activeOverlays, overlayMode, setOverlayMode } = usePresentationLayers();
  const { currentOutputItemRef } = useNavigation();
  const audio = useAudio();
  const { createOverlay } = useOverlayEditor();
  const { createStage } = useStageEditor();
  const { setCurrentStageId: setPlaybackStageId } = useStagePlayback();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const [bottomTab, setBottomTab] = useState<BottomTab>('overlays');
  const { actions: { createMacro } } = useAutomation();
  const mediaActive = Boolean(mediaLayerAsset);
  const videoActive = Boolean(videoLayerAsset);
  const contentActive = contentLayerVisible && Boolean(currentOutputItemRef);
  const overlayActive = activeOverlays.length > 0;
  const audioActive = audio.isPlaying || audio.currentTime > 0;

  function handleClearMedia() { clearLayer('media'); }
  function handleClearVideo() { clearLayer('video'); }
  // Clearing content blanks the live slide. Signal "no slide live" so slide-/
  // deck-item-scoped macro runs are swept (same path as advancing off a slide).
  // Only the operator clear buttons do this — the layer.clear/clearAll *cues*
  // call clearLayer directly and must not sweep, or a macro would cancel itself.
  function handleClearContent() {
    clearLayer('content');
    dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: null });
  }
  function handleClearOverlay() { clearLayer('overlay'); }
  function handleClearAudio() { audio.clearAudio(); }
  function handleClearAll() {
    audio.clearAudio();
    clearAllLayers();
    dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: null });
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

  function handleCreateMacro() {
    void createMacro().then(() => {
      setWorkbenchMode('macro-editor');
    });
  }

  function handleEditOverlays() {
    setWorkbenchMode('overlay-editor');
  }

  function handleEditStages() {
    setWorkbenchMode('stage-editor');
  }

  function handleEditMacros() {
    setWorkbenchMode('macro-editor');
  }

  function handleTabChange(value: string) {
    if (value === 'overlays' || value === 'stage' || value === 'macros') setBottomTab(value);
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
              <Tabs.Trigger value="macros">Macros</Tabs.Trigger>
            </Tabs.List>
          </LumaCastPanel.GroupTitle>
          <div className="w-full flex shrink-0 items-center gap-1 border-b border-secondary px-1.5 py-1">
            <div className="ml-auto flex items-center gap-1">
              {bottomTab === 'overlays' ? (
                <>
                  <ReacstButton.Icon label={overlayModeLabel} variant="ghost" onClick={handleOverlayModeToggle}>
                    {overlayMode === 'single' ? <Layers /> : <Layers2 />}
                  </ReacstButton.Icon>
                  <span aria-hidden className="mx-1 h-5 w-px bg-secondary" />
                  <ReacstButton.Icon label="Edit overlays" variant="ghost" onClick={handleEditOverlays}>
                    <Pencil />
                  </ReacstButton.Icon>
                  <ReacstButton.Icon label="Add overlay" onClick={handleCreateOverlay}>
                    <Plus />
                  </ReacstButton.Icon>
                </>
              ) : bottomTab === 'stage' ? (
                <>
                  <ReacstButton.Icon label="Edit stages" variant="ghost" onClick={handleEditStages}>
                    <Pencil />
                  </ReacstButton.Icon>
                  <ReacstButton.Icon label="Add stage" onClick={handleCreateStage}>
                    <Plus />
                  </ReacstButton.Icon>
                </>
              ) : (
                <>
                  <ReacstButton.Icon label="Edit macros" variant="ghost" onClick={handleEditMacros}>
                    <Pencil />
                  </ReacstButton.Icon>
                  <ReacstButton.Icon label="Add macro" onClick={handleCreateMacro}>
                    <Plus />
                  </ReacstButton.Icon>
                </>
              )}
            </div>
          </div>
          {bottomTab === 'macros' ? (
            <LumaCastPanel.Content className='flex flex-1 min-h-0 w-full'>
              <MacroBinPanel />
            </LumaCastPanel.Content>
          ) : (
            <LumaCastPanel.Content className='flex flex-1 min-h-0 w-full'>
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
