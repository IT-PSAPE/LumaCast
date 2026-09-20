import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlignLeft, Ellipsis, Film, Image, Layers, Layers2, Pencil, Plus, Square, VolumeX, XCircle } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Tabs } from '../../components/display/tabs';
import { Dropdown } from '../../components/form/dropdown';
import { IconGroup } from '@renderer/components/icon-group';
import { useNavigation } from '../../contexts/navigation-context';
import { useOverlayEditor, useStageEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useAudio, usePresentationLayers, useStagePlayback } from '../../contexts/playback/playback-context';
import { useWorkbench } from '../../contexts/workbench-context';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { OverlayBinPanel } from '../assets/overlays/overlay-bin-panel';
import { StageBinPanel } from '../assets/stages/stage-bin-panel';
import { MacroBinPanel } from '../automation/macro-bin-panel';
import { useAutomation } from '../automation/automation-context';
import { dispatchAutomationTriggerEvent } from '../automation/automation-events';
import { useGridSize } from '../../hooks/use-grid-size';
import { BinControlsProvider, BinControlsSearchField, BinControlsViewOptions, type BinGridConfig } from '@renderer/components/controls/bin-controls';
import { ProgramModeHeader } from './program-mode-header';
import { SurfacesArea } from './surfaces-area';
import { TimersPanel } from './timers-panel';

type BottomTab = 'overlays' | 'stage' | 'macros' | 'timers';

export function ProgramPanel() {
  const { clearLayer, clearAllLayers, mediaLayerAsset, videoLayerAsset, contentLayerVisible, activeOverlays, overlayMode, setOverlayMode } = usePresentationLayers();
  const { currentOutputItemRef } = useNavigation();
  const audio = useAudio();
  const { createOverlay } = useOverlayEditor();
  const { createStage } = useStageEditor();
  const { setCurrentStageId: setPlaybackStageId } = useStagePlayback();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const [bottomTab, setBottomTab] = useState<BottomTab>('overlays');
  const { actions: { createMacro, cancelActiveMacros } } = useAutomation();
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
    timers: 'list',
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

  const grid: BinGridConfig | null = useMemo(() => {
    switch (bottomTab) {
      case 'overlays':
        return { value: overlayGrid.gridSize, min: overlayGrid.min, max: overlayGrid.max, step: overlayGrid.step, onChange: overlayGrid.setGridSize };
      case 'stage':
        return { value: stageGrid.gridSize, min: stageGrid.min, max: stageGrid.max, step: stageGrid.step, onChange: stageGrid.setGridSize };
      case 'macros':
        return { value: macroGrid.gridSize, min: macroGrid.min, max: macroGrid.max, step: macroGrid.step, onChange: macroGrid.setGridSize };
      case 'timers':
        // Timers render as a flat list, never a card grid — no size/view toggle applies.
        return null;
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
    if (value === 'overlays' || value === 'stage' || value === 'macros' || value === 'timers') setBottomTab(value);
  }

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
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            grid={grid}
          >
            <LumaCastPanel.GroupTitle>
              <Tabs.List label="Bottom panel" className="mr-auto" tabsClassName="gap-2">
                <Tabs.Trigger value="overlays">Overlays</Tabs.Trigger>
                <Tabs.Trigger value="stage">Stage</Tabs.Trigger>
                <Tabs.Trigger value="macros">Macros</Tabs.Trigger>
                <Tabs.Trigger value="timers">Timers</Tabs.Trigger>
              </Tabs.List>
            </LumaCastPanel.GroupTitle>
            <div className="w-full flex shrink-0 items-center gap-1.5 border-b border-secondary px-1.5 py-1">
              <div className="ml-auto min-w-0 w-full max-w-xs">
                <BottomTabSearchField tab={bottomTab} />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Tabs.Panel value="overlays" className="flex items-center gap-1">
                  <ReacstButton.Icon
                    label={overlayMode === 'single' ? 'Single overlay mode — click to allow multiple' : 'Multiple overlay mode — click for single'}
                    variant="ghost"
                    onClick={handleOverlayModeToggle}
                  >
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
                  <ReacstButton.Icon label="Cancel active macros" variant="ghost" onClick={cancelActiveMacros}>
                    <Square />
                  </ReacstButton.Icon>
                  <ReacstButton.Icon label="Edit macros" variant="ghost" onClick={handleEditMacros}>
                    <Pencil />
                  </ReacstButton.Icon>
                  <ReacstButton.Icon label="Add macro" onClick={handleCreateMacro}>
                    <Plus />
                  </ReacstButton.Icon>
                </Tabs.Panel>
                {bottomTab !== 'timers' && (
                  <Dropdown>
                    <Dropdown.Trigger aria-label="More actions" className="cursor-pointer rounded-sm bg-transparent p-1 text-tertiary transition-colors hover:bg-tertiary hover:text-primary [&>svg]:size-4">
                      <Ellipsis />
                    </Dropdown.Trigger>
                    <Dropdown.Panel placement="bottom-end" className="min-w-64">
                      <BinControlsViewOptions />
                    </Dropdown.Panel>
                  </Dropdown>
                )}
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
            <Tabs.Panel value="timers" className="flex flex-1 min-h-0 w-full">
              <LumaCastPanel.Content className='flex flex-1 min-h-0 w-full'>
                <TimersPanel />
              </LumaCastPanel.Content>
            </Tabs.Panel>
          </BinControlsProvider>
        </Tabs.Root>
      </LumaCastPanel.Group>
    </LumaCastPanel.Root>
  );
}

function BottomTabSearchField({ tab }: { tab: BottomTab }) {
  switch (tab) {
    case 'overlays': return <BinControlsSearchField placeholder="Search overlays…" />;
    case 'stage': return <BinControlsSearchField placeholder="Search stages…" />;
    case 'macros': return <BinControlsSearchField placeholder="Search macros…" />;
    case 'timers': return <BinControlsSearchField placeholder="Search timers…" />;
  }

  return assertNever(tab);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled program panel tab: ${String(value)}`);
}
