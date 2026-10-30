// The app's single toolbar: title/dirty on the left, document/import/look
// controls in the centre, export on the right. Every sub-control here is
// single-use, so each stays a local function in this one file rather than
// being split into separate wrapper-component files.
import { useState } from 'react';
import {
  ChevronDown, ListMusic, Redo2, Save, SlidersHorizontal, Undo2,
} from 'lucide-react';
import {
  cn, DropdownMenu, Modal, Popover, PointContextMenu, ReacstButton, Select, TextField, Toolbar,
  usePointContextMenu, type MenuEntry,
} from '@lumacast/ui';
import type { CueFileFormat } from '../../../shared/desktop-api';
import { COMPOSITION_PRESETS, FRAME_RATES, type FrameRate } from '../../../shared/project';
import { THEME_PRESETS } from '../../../shared/theme-presets';
import { useChordStore } from '../../store';
import { ExportDialog } from '../export/export-dialog';
import { importAudio, importBackground, importLyrics } from '../library/import-flows';
import {
  closeCueFormatChooser, closeExportDialog, openExportDialog, useShellUiState,
} from './shell-ui-state';

function TitleControl() {
  const title = useChordStore((s) => s.document.project.title);
  const dirty = useChordStore((s) => s.dirty);
  const setTitle = useChordStore((s) => s.setTitle);
  const [editing, setEditing] = useState(false);

  if (editing) {
    // Blur bubbles: the field commits (or reverts on Escape) first, then this
    // leaves edit mode.
    return (
      <div className="w-40" onBlur={() => setEditing(false)}>
        <TextField
          autoFocus
          size="sm"
          value={title}
          label="Project title"
          labelPlacement="hidden"
          commitOn="blur"
          onValueChange={(value) => {
            const next = value.trim();
            if (next && next !== title) setTitle(next);
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex cursor-pointer items-center gap-1.5 rounded-control px-2 py-1 hover:bg-tertiary"
    >
      <span className="label-sm max-w-40 truncate text-primary">{title}</span>
      {dirty ? <span aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-brand" /> : null}
    </button>
  );
}

function SaveControl() {
  const saveDocument = useChordStore((s) => s.saveDocument);

  return (
    <ReacstButton.Icon label="Save" onClick={() => void saveDocument()}>
      <Save size={16} />
    </ReacstButton.Icon>
  );
}

// Used once per project, so one menu instead of three buttons. New and Open
// are not in the bar: they live in the File menu (Cmd+N / Cmd+O).
const IMPORT_ENTRIES: MenuEntry[] = [
  { id: 'audio', label: 'Audio…', onSelect: () => void importAudio() },
  { id: 'lyrics', label: 'Lyrics…', onSelect: () => void importLyrics() },
  { id: 'background', label: 'Background…', onSelect: () => void importBackground() },
];

function ImportMenu() {
  return (
    <DropdownMenu
      entries={IMPORT_ENTRIES}
      trigger={(
        <button type="button" className="btn inline-flex items-center gap-1">
          Import… <ChevronDown size={12} />
        </button>
      )}
    />
  );
}

const COMPOSITION_OPTIONS = [
  ...COMPOSITION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
  { value: 'custom', label: 'Custom…' },
];

const FPS_OPTIONS = FRAME_RATES.map((fps) => ({ value: String(fps), label: `${fps} fps` }));

function CompositionFields() {
  const composition = useChordStore((s) => s.document.project.composition);
  const setComposition = useChordStore((s) => s.setComposition);
  const activePreset = COMPOSITION_PRESETS.find(
    (preset) => preset.size.width === composition.width && preset.size.height === composition.height,
  );

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={activePreset?.id ?? 'custom'}
        options={COMPOSITION_OPTIONS}
        label="Composition"
        onValueChange={(value) => {
          const preset = COMPOSITION_PRESETS.find((p) => p.id === value);
          if (preset) setComposition({ width: preset.size.width, height: preset.size.height });
        }}
      />
      <Select
        value={String(composition.fps)}
        options={FPS_OPTIONS}
        label="Frame rate"
        onValueChange={(value) => setComposition({ fps: Number(value) as FrameRate })}
      />
    </div>
  );
}

// Composition, frame rate and theme preset are set once per project; they
// share one popover rather than three always-visible controls.
function ProjectSettingsPopover() {
  const presetId = useChordStore((s) => s.document.project.theme.presetId);
  const applyPreset = useChordStore((s) => s.applyPreset);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const current = THEME_PRESETS.find((preset) => preset.id === presetId);

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-label="Project settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-1.5 rounded-control px-2 py-1.5 text-secondary hover:bg-tertiary"
      >
        <SlidersHorizontal size={14} />
        <span className="label-xs">Project</span>
        <ChevronDown size={12} />
      </button>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-start"
        offset={6}
        className="flex w-64 flex-col gap-3 rounded-container border border-primary bg-primary p-3 shadow-lg"
      >
        <CompositionFields />
        <div role="group" aria-label={`Theme preset, ${current?.label ?? 'Custom'}`} className="grid grid-cols-3 gap-2">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={presetId === preset.id}
              onClick={() => applyPreset(preset.id)}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1 rounded-container border p-1.5 transition-colors',
                presetId === preset.id ? 'border-brand bg-brand/10' : 'border-primary hover:bg-tertiary',
              )}
            >
              <span
                className="flex h-6 w-full items-center justify-center rounded-control text-[10px] font-semibold"
                style={{ backgroundColor: preset.swatch.background, color: preset.swatch.text }}
              >
                Aa
              </span>
              <span className="label-xs w-full truncate text-center text-secondary">{preset.label}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function HistoryControls() {
  const canUndo = useChordStore((s) => s.canUndo);
  const canRedo = useChordStore((s) => s.canRedo);
  const undo = useChordStore((s) => s.undo);
  const redo = useChordStore((s) => s.redo);

  return (
    <>
      <ReacstButton.Icon label="Undo" disabled={!canUndo} onClick={undo}>
        <Undo2 size={16} />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Redo" disabled={!canRedo} onClick={redo}>
        <Redo2 size={16} />
      </ReacstButton.Icon>
    </>
  );
}

const CUE_FILE_FORMATS: Array<{ value: CueFileFormat; label: string }> = [
  { value: 'csv', label: 'Export CSV' },
  { value: 'lrc', label: 'Export LRC' },
  { value: 'srt', label: 'Export SRT' },
];

function LyricsExportMenu() {
  const exportCueFile = useChordStore((s) => s.exportCueFile);
  const menu = usePointContextMenu();
  const entries: MenuEntry[] = CUE_FILE_FORMATS.map((format) => ({
    id: format.value,
    label: format.label,
    onSelect: () => void exportCueFile(format.value),
  }));

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        className="btn inline-flex items-center gap-1"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          menu.show({ clientX: rect.left, clientY: rect.bottom + 4, preventDefault() {} });
        }}
      >
        Lyrics <ChevronDown size={12} />
      </button>
      <PointContextMenu open={menu.open} position={menu.position} entries={entries} label="Export lyrics" onClose={menu.close} />
    </>
  );
}

/** Handles the native "Export Cues…" menu command, which has no submenu of its own. */
function CueFormatChooserDialog() {
  const open = useShellUiState((s) => s.cueFormatChooserOpen);
  const exportCueFile = useChordStore((s) => s.exportCueFile);

  return (
    <Modal open={open} onClose={closeCueFormatChooser} title="Export lyrics" size="sm">
      <div className="flex flex-col gap-2 p-4">
        {CUE_FILE_FORMATS.map((format) => (
          <ReacstButton
            key={format.value}
            onClick={() => {
              void exportCueFile(format.value);
              closeCueFormatChooser();
            }}
          >
            <ListMusic size={14} /> {format.label}
          </ReacstButton>
        ))}
      </div>
    </Modal>
  );
}

export function TopBar() {
  const isEmpty = useChordStore((s) => s.document.project.cues.length === 0 && s.document.project.audio === null);
  const exportDialogOpen = useShellUiState((s) => s.exportDialogOpen);

  return (
    <Toolbar size="md" variant="bordered" label="Project" className="bg-primary">
      <Toolbar.Start>
        <TitleControl />
      </Toolbar.Start>

      <Toolbar.Center>
        <Toolbar.Group label="Document"><SaveControl /></Toolbar.Group>
        <Toolbar.Group label="History"><HistoryControls /></Toolbar.Group>
      </Toolbar.Center>

      <Toolbar.End>
        <ImportMenu />
        <ProjectSettingsPopover />
        <LyricsExportMenu />
        <ReacstButton className="bg-brand text-white hover:bg-brand/90" disabled={isEmpty} onClick={openExportDialog}>
          Export
        </ReacstButton>
      </Toolbar.End>

      <ExportDialog open={exportDialogOpen} onClose={closeExportDialog} />
      <CueFormatChooserDialog />
    </Toolbar>
  );
}
