import { Children, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { PanelBottom, PanelLeft, PanelRight, Search, Settings } from 'lucide-react';
import { useWorkbench } from '../../contexts/workbench-context';
import type { WorkbenchMode } from '../../types/ui';
import type { PaneId, SplitId } from '@renderer/components/layout/panel-split/workbench-panel-layout';
import { usePanelRoute } from '@renderer/components/layout/panel-split/split-panel';
import { ReacstButton } from '@renderer/components/controls/button';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
import { cv } from '@renderer/utils/cv';
import { useNdi } from '@renderer/contexts/app-context';
import { useCommandPalette } from '../command-palette/command-palette-context';
import { OverflowViewMenu } from './overflow-view-menu';

const isMac = window.castApi?.platform === 'darwin';

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const outputDotStyles = cv({
  base: 'inline-block h-2 w-2 rounded-full transition-colors',
  variants: {
    active: {
      true: ['bg-success'],
      false: ['bg-error'],
    },
  },
});

const outputBorderStyles = cv({
  base: 'flex items-center gap-1.5 rounded border bg-tertiary px-2 py-1 text-sm cursor-pointer transition-colors hover:border-text-muted',
  variants: {
    active: {
      true: ['border-success/40'],
      false: ['border-red-500/40'],
    },
  },
});

interface PanelToggleProps {
  id: 'left' | 'right' | 'bottom';
  label: string;
  splitId: SplitId;
  paneId: PaneId;
  children: ReactNode;
}

export function AppToolbar() {
  const { state: { workbenchMode }, actions: { setWorkbenchMode } } = useWorkbench();
  const { state: { outputState }, actions: { toggleAudienceOutput, toggleStageOutput } } = useNdi();
  const { open: openCommandPalette } = useCommandPalette();

  function handleWorkbenchModeChange(nextValue: string | string[]) {
    if (Array.isArray(nextValue)) return;
    if (!isWorkbenchMode(nextValue) || nextValue === workbenchMode) return;
    setWorkbenchMode(nextValue);
  }

  function handleOpenSettings() {
    if (workbenchMode !== 'settings') {
      setWorkbenchMode('settings');
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div style={noDragStyle}>
        <SegmentedControl value={workbenchMode} onValueChange={handleWorkbenchModeChange} label="Application views">
          <SegmentedControl.Label value="show">Show</SegmentedControl.Label>
          <SegmentedControl.Label value="item-editor">Edit</SegmentedControl.Label>
          <SegmentedControl.Label value="theme-editor">Themes</SegmentedControl.Label>
          <OverflowViewMenu value={workbenchMode} onSelect={handleWorkbenchModeChange} />
        </SegmentedControl>
      </div>

      <div aria-hidden="true" className="min-w-3 flex-1 self-stretch" style={dragStyle} />

      <div style={noDragStyle} className="min-w-0 max-w-md flex-[2_0_180px]">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Open command palette"
          title={`Search commands (${isMac ? '⌘' : 'Ctrl+'}K)`}
          className="group flex h-7 w-full min-w-0 items-center gap-2 rounded-md border border-primary bg-tertiary px-2 text-left text-sm text-tertiary transition-colors hover:border-secondary hover:bg-tertiary hover:text-secondary"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search commands</span>
          <kbd className="shrink-0 rounded border border-primary bg-primary px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-tertiary">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>

      <div aria-hidden="true" className="min-w-3 flex-1 self-stretch" style={dragStyle} />

      <div className="flex items-center gap-2" style={noDragStyle}>
        <ReacstButton
          variant="ghost"
          onClick={toggleAudienceOutput}
          type="button"
          className={outputBorderStyles({ active: outputState.audience })}
          aria-pressed={outputState.audience}
        >
          <span className={outputDotStyles({ active: outputState.audience })} aria-hidden="true" />
          <span className="text-primary">Audience</span>
        </ReacstButton>
        <ReacstButton
          variant="ghost"
          onClick={toggleStageOutput}
          type="button"
          className={outputBorderStyles({ active: outputState.stage })}
          aria-pressed={outputState.stage}
        >
          <span className={outputDotStyles({ active: outputState.stage })} aria-hidden="true" />
          <span className="text-primary">Stage</span>
        </ReacstButton>

        <PanelVisibilityControls mode={workbenchMode} />

        <ReacstButton.Icon label="Settings" onClick={handleOpenSettings}>
          <Settings />
        </ReacstButton.Icon>
      </div>
    </div>
  );
}

function PanelVisibilityControls({ mode }: { mode: WorkbenchMode }) {
  switch (mode) {
    case 'show':
      return (
        <PanelToggles.Root>
          <PanelToggles.Toggle id="left" label="Left" splitId="show-main" paneId="show-left"><PanelLeft size={14} strokeWidth={1.5} /></PanelToggles.Toggle>
          <PanelToggles.Toggle id="bottom" label="Bottom" splitId="show-center" paneId="show-bottom"><PanelBottom size={14} strokeWidth={1.5} /></PanelToggles.Toggle>
          <PanelToggles.Toggle id="right" label="Right" splitId="show-main" paneId="show-right"><PanelRight size={14} strokeWidth={1.5} /></PanelToggles.Toggle>
        </PanelToggles.Root>
      );
    case 'item-editor':
      return (
        <PanelToggles.Root>
          <PanelToggles.Toggle id="left" label="Left" splitId="edit-main" paneId="edit-left"><PanelLeft size={14} strokeWidth={1.5} /></PanelToggles.Toggle>
          <PanelToggles.Toggle id="bottom" label="Bottom" splitId="edit-center" paneId="edit-bottom"><PanelBottom size={14} strokeWidth={1.5} /></PanelToggles.Toggle>
          <PanelToggles.Toggle id="right" label="Right" splitId="edit-main" paneId="edit-right"><PanelRight size={14} strokeWidth={1.5} /></PanelToggles.Toggle>
        </PanelToggles.Root>
      );
    case 'overlay-editor':
    case 'theme-editor':
    case 'stage-editor':
    case 'macro-editor':
      return (
        <PanelToggles.Root>
          <PanelToggles.Toggle id="left" label="Left" splitId="editor-main" paneId="editor-left"><PanelLeft size={14} strokeWidth={1.5} /></PanelToggles.Toggle>
          <PanelToggles.Toggle id="right" label="Right" splitId="editor-main" paneId="editor-right"><PanelRight size={14} strokeWidth={1.5} /></PanelToggles.Toggle>
        </PanelToggles.Root>
      );
    case 'settings':
      return null;
  }

  return assertNever(mode);
}

function PanelTogglesRoot({ children }: { children: ReactNode }) {
  const panelRoute = usePanelRoute();
  const toggles = Children.toArray(children).filter(
    (child): child is ReactElement<PanelToggleProps> => isValidElement<PanelToggleProps>(child) && child.type === PanelToggle,
  );
  const activePanelIds = toggles
    .filter((toggle) => panelRoute.meta.isPanelVisible(toggle.props.splitId, toggle.props.paneId))
    .map((toggle) => toggle.props.id);

  function handleChange(nextValue: string | string[]) {
    if (!Array.isArray(nextValue)) return;
    for (const toggle of toggles) {
      const active = panelRoute.meta.isPanelVisible(toggle.props.splitId, toggle.props.paneId);
      if (nextValue.includes(toggle.props.id) !== active) {
        panelRoute.actions.togglePanel(toggle.props.splitId, toggle.props.paneId);
      }
    }
  }

  return (
    <SegmentedControl label="Panel visibility" selectionMode="multiple" value={activePanelIds} onValueChange={handleChange}>
      {toggles}
    </SegmentedControl>
  );
}

function PanelToggle({ id, label, splitId, paneId, children }: PanelToggleProps) {
  const panelRoute = usePanelRoute();
  const active = panelRoute.meta.isPanelVisible(splitId, paneId);

  return (
    <SegmentedControl.Icon value={id} title={`${active ? 'Hide' : 'Show'} ${label} panel`}>
      {children}
      <span className="sr-only">{label}</span>
    </SegmentedControl.Icon>
  );
}

const PanelToggles = { Root: PanelTogglesRoot, Toggle: PanelToggle };

function isWorkbenchMode(value: string): value is WorkbenchMode {
  return value === 'show' || value === 'item-editor' || value === 'overlay-editor' || value === 'theme-editor' || value === 'stage-editor' || value === 'macro-editor' || value === 'settings';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench mode: ${String(value)}`);
}
