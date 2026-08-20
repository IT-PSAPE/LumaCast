import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, AlignLeft, Ellipsis, Film, Image, Layers, Layers2, LayoutGrid, Pencil, Plus, RectangleHorizontal, VolumeX, XCircle } from 'lucide-react';
import { NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT } from '@lumacast/protocol';
import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Tabs } from '../../components/display/tabs';
import { SceneFrame } from '../../components/display/scene-frame';
import { Dropdown } from '../../components/form/dropdown';
import { ThumbnailGrid } from '../../components/layout/thumbnail-grid';
import { InspectorSlider } from '../../components/form/inspector-slider';
import { IconGroup } from '@renderer/components/icon-group';
import { useNdi } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useOverlayEditor, useStageEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useAudio, usePresentationLayers, useStagePlayback } from '../../contexts/playback/playback-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useWorkbench } from '../../contexts/workbench-context';
import type { ProgramSurfaceKind, ResourceDrawerViewMode } from '../../types/ui';
import { BindingProvider } from '@lumacast/canvas';
import { OverlayBinPanel } from '../assets/overlays/overlay-bin-panel';
import { StageBinPanel } from '../assets/stages/stage-bin-panel';
import { MacroBinPanel } from '../automation/macro-bin-panel';
import { useAutomation } from '../automation/automation-context';
import { dispatchAutomationTriggerEvent } from '../automation/automation-events';
import { useProgramOutput } from './use-program-output';
import { useProgramBindingValue, useStageBindingValue, useStageScene } from './use-stage-scene';
import { SceneStage } from '../canvas/scene-stage';
import { useGridSize } from '../../hooks/use-grid-size';
import { BinControlsProvider, BinControlsSearchField, BinControlsViewOptions, type BinGridConfig } from '@renderer/components/controls/bin-controls';

type BottomTab = 'overlays' | 'stage' | 'macros';

const SEARCH_PLACEHOLDER_BY_TAB: Record<BottomTab, string> = {
  overlays: 'Search overlays…',
  stage: 'Search stages…',
  macros: 'Search macros…',
};

const TRIGGER_CLASS = 'cursor-pointer transition-colors p-1 rounded-sm bg-transparent text-tertiary hover:bg-quaternary hover:text-primary [&>svg]:size-4';

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

  // Bin-controls state: per-bottom-tab view mode plus transient search that clears on tab switch.
  // Each grid key is read exactly once here, mirroring resource-drawer's pattern.
  const [bottomViewModes, setBottomViewModes] = useState<Record<BottomTab, ResourceDrawerViewMode>>({
    overlays: 'grid',
    stage: 'grid',
    macros: 'grid',
  });
  const [searchValue, setSearchValue] = useState('');
  const overlayGrid = useGridSize('lumacast.grid-size.overlay-bin', 3, 2, 4);
  const stageGrid = useGridSize('lumacast.grid-size.stage-bin', 3, 2, 4);
  const macroGrid = useGridSize('lumacast.grid-size.macro-bin', 3, 2, 4);

  useEffect(() => {
    setSearchValue('');
  }, [bottomTab]);

  const viewMode = bottomViewModes[bottomTab];
  const setViewMode = useCallback((mode: ResourceDrawerViewMode) => {
    setBottomViewModes((prev) => ({ ...prev, [bottomTab]: mode }));
  }, [bottomTab]);

  const searchPlaceholder = SEARCH_PLACEHOLDER_BY_TAB[bottomTab];
  const grid: BinGridConfig | null = useMemo(() => {
    switch (bottomTab) {
      case 'overlays':
        return { value: overlayGrid.gridSize, min: overlayGrid.min, max: overlayGrid.max, step: overlayGrid.step, onChange: overlayGrid.setGridSize };
      case 'stage':
        return { value: stageGrid.gridSize, min: stageGrid.min, max: stageGrid.max, step: stageGrid.step, onChange: stageGrid.setGridSize };
      case 'macros':
        return { value: macroGrid.gridSize, min: macroGrid.min, max: macroGrid.max, step: macroGrid.step, onChange: macroGrid.setGridSize };
    }
  }, [bottomTab, overlayGrid.gridSize, overlayGrid.min, overlayGrid.max, overlayGrid.step, overlayGrid.setGridSize, stageGrid.gridSize, stageGrid.min, stageGrid.max, stageGrid.step, stageGrid.setGridSize, macroGrid.gridSize, macroGrid.min, macroGrid.max, macroGrid.step, macroGrid.setGridSize]);

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
          <BinControlsProvider
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            searchPlaceholder={searchPlaceholder}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            grid={grid}
          >
            <LumaCastPanel.GroupTitle>
              <Tabs.List label="Bottom panel" className="mr-auto" tabsClassName="gap-2">
                <Tabs.Trigger value="overlays">Overlays</Tabs.Trigger>
                <Tabs.Trigger value="stage">Stage</Tabs.Trigger>
                <Tabs.Trigger value="macros">Macros</Tabs.Trigger>
              </Tabs.List>
            </LumaCastPanel.GroupTitle>
            <div className="w-full flex shrink-0 items-center gap-1.5 border-b border-secondary px-1.5 py-1">
              <div className="ml-auto min-w-0 w-full max-w-xs">
                <BinControlsSearchField />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Tabs.Panel value="overlays" className="flex items-center gap-1">
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
                </Tabs.Panel>
                <Tabs.Panel value="stage" className="flex items-center gap-1">
                  <ReacstButton.Icon label="Edit stages" variant="ghost" onClick={handleEditStages}>
                    <Pencil />
                  </ReacstButton.Icon>
                  <ReacstButton.Icon label="Add stage" onClick={handleCreateStage}>
                    <Plus />
                  </ReacstButton.Icon>
                </Tabs.Panel>
                <Tabs.Panel value="macros" className="flex items-center gap-1">
                  <ReacstButton.Icon label="Edit macros" variant="ghost" onClick={handleEditMacros}>
                    <Pencil />
                  </ReacstButton.Icon>
                  <ReacstButton.Icon label="Add macro" onClick={handleCreateMacro}>
                    <Plus />
                  </ReacstButton.Icon>
                </Tabs.Panel>
                <Dropdown>
                  <Dropdown.Trigger aria-label="More actions" className={TRIGGER_CLASS}>
                    <Ellipsis />
                  </Dropdown.Trigger>
                  <Dropdown.Panel placement="bottom-end" className="min-w-64">
                    <BinControlsViewOptions />
                  </Dropdown.Panel>
                </Dropdown>
              </div>
            </div>
            <Tabs.Panel value="overlays" className="flex flex-1 min-h-0 w-full">
              <LumaCastPanel.Content className='flex flex-1 min-h-0 w-full'>
                <OverlayBinPanel />
              </LumaCastPanel.Content>
            </Tabs.Panel>
            <Tabs.Panel value="stage" className="flex flex-1 min-h-0 w-full">
              <LumaCastPanel.Content className='flex flex-1 min-h-0 w-full'>
                <StageBinPanel />
              </LumaCastPanel.Content>
            </Tabs.Panel>
            <Tabs.Panel value="macros" className="flex flex-1 min-h-0 w-full">
              <LumaCastPanel.Content className='flex flex-1 min-h-0 w-full'>
                <MacroBinPanel />
              </LumaCastPanel.Content>
            </Tabs.Panel>
          </BinControlsProvider>
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

// The single and all program views each get their own header controls. The
// shared mode toggle stays in the dispatcher; the per-mode controls are
// explicit variants so each tree owns its own state shape.
function ProgramModeHeader() {
  const {
    state: { programMode },
    actions: { setProgramMode },
  } = useWorkbench();

  function handleModeToggle() {
    setProgramMode(programMode === 'single' ? 'all' : 'single');
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
      {programMode === 'single' ? <SingleSurfacePicker /> : <GridDensityControl />}
    </LumaCastPanel.GroupTitle>
  );
}

function SingleSurfacePicker() {
  const {
    state: { programSingleSurface },
    actions: { setProgramSingleSurface },
  } = useWorkbench();

  function handleSurfacePick(surface: ProgramSurfaceKind) {
    setProgramSingleSurface(surface);
  }

  return (
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
  );
}

function GridDensityControl() {
  const {
    state: { programGridDensity },
    actions: { setProgramGridDensity },
  } = useWorkbench();

  function handleDensityChange(next: number) {
    if (next !== 1 && next !== 2) return;
    setProgramGridDensity(next);
  }

  return (
    <span className="ml-auto w-32 shrink-0">
      <InspectorSlider
        value={programGridDensity}
        min={1}
        max={2}
        onChange={handleDensityChange}
        label="Columns"
        ariaLabel="Grid columns"
      />
    </span>
  );
}

function SurfacesArea() {
  const {
    state: { programMode, programSingleSurface, programGridDensity },
  } = useWorkbench();

  if (programMode === 'single') {
    // Single mode names the surface in the header dropdown, so the cell
    // composes no label badge.
    return (
      <div className="flex w-full justify-center">
        <Surface kind={programSingleSurface} />
      </div>
    );
  }

  // All-mode grid: slider value IS the column count. 1 = stacked vertically,
  // 2 = two columns. Each cell is a 16:9 frame so rows auto-size to identical
  // heights regardless of which surface (Program/Monitor/Stage) lands in them.
  const columnCount = programGridDensity;
  return (
    <ThumbnailGrid columns={columnCount} className="w-full gap-1">
      {SURFACE_ORDER.map((kind) => (
        <Surface key={kind} kind={kind} label={SURFACE_LABELS[kind]} />
      ))}
    </ThumbnailGrid>
  );
}

function Surface({ kind, label }: { kind: ProgramSurfaceKind; label?: React.ReactNode }) {
  if (kind === 'program') return <ProgramSurface label={label} />;
  if (kind === 'monitor') return <MonitorSurface label={label} />;
  return <StageSurface label={label} />;
}

function ProgramSurface({ label }: { label?: React.ReactNode }) {
  const { scene, background } = useProgramOutput();
  const bindingValue = useProgramBindingValue();
  const checkerboard = background === 'transparent';

  return (
    <BindingProvider value={bindingValue}>
      <SurfaceFrame label={label} checkerboard={checkerboard}>
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

function MonitorSurface({ label }: { label?: React.ReactNode }) {
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
      <SurfaceFrame label={label} checkerboard={checkerboard}>
        <SceneStage scene={showScene} surface="monitor" className="h-full w-full" />
      </SurfaceFrame>
    </BindingProvider>
  );
}

function StageSurface({ label }: { label?: React.ReactNode }) {
  const stageScene = useStageScene();
  const bindingValue = useStageBindingValue();

  // Mirrors the configured alpha for the stage NDI sender so the operator
  // sees exactly what the stage feed would look like over a transparent base.
  const { state: { outputConfigs } } = useNdi();
  const checkerboard = outputConfigs.stage.withAlpha;

  return (
    <BindingProvider value={bindingValue}>
      <SurfaceFrame label={label} checkerboard={checkerboard}>
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
// heights and the optional panel label can float on top instead of stealing a
// row above. The label is an explicit slot decision: the caller supplies it
// only when the mode needs one (all-mode grid);
// in single mode the header dropdown already names the surface, so no label
// is composed and the badge is absent.
function SurfaceFrame({ label, checkerboard = false, children }: { label?: React.ReactNode; checkerboard?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative max-h-full max-w-full w-full">
      <SceneFrame
        width={NDI_OUTPUT_WIDTH}
        height={NDI_OUTPUT_HEIGHT}
        className="max-h-full max-w-full bg-black"
        checkerboard={checkerboard}
      >
        {children}
      </SceneFrame>
      {label ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
          {label}
        </span>
      ) : null}
    </div>
  );
}
