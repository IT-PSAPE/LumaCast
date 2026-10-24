// The app's single toolbar: title/dirty on the left, document/import/look
// controls in the centre, export on the right. Every sub-control here is
// single-use, so each stays a local function in this one file rather than
// being split into separate wrapper-component files.
import { useState } from 'react';
import {
  ChevronDown, FilePlus2, FolderOpen, ListMusic, Redo2, Save, Undo2,
} from 'lucide-react';
import {
  cn, Modal, PlainButton, Popover, PointContextMenu, ReacstButton, Select, Separator, TextField,
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
      className="flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-tertiary"
    >
      <span className="label-sm max-w-40 truncate text-primary">{title}</span>
      {dirty ? <span aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-brand" /> : null}
    </button>
  );
}

function DocumentControls() {
  const newDocument = useChordStore((s) => s.newDocument);
  const openDocument = useChordStore((s) => s.openDocument);
  const saveDocument = useChordStore((s) => s.saveDocument);

  return (
    <>
      <ReacstButton.Icon label="New" onClick={() => void newDocument()}>
        <FilePlus2 size={16} />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Open" onClick={() => void openDocument()}>
        <FolderOpen size={16} />
      </ReacstButton.Icon>
      <ReacstButton.Icon label="Save" onClick={() => void saveDocument()}>
        <Save size={16} />
      </ReacstButton.Icon>
    </>
  );
}

function ImportControls() {
  return (
    <>
      <PlainButton onClick={() => void importAudio()}>Audio…</PlainButton>
      <PlainButton onClick={() => void importLyrics()}>Lyrics…</PlainButton>
      <PlainButton onClick={() => void importBackground()}>Background…</PlainButton>
    </>
  );
}

const COMPOSITION_OPTIONS = [
  ...COMPOSITION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
  { value: 'custom', label: 'Custom…' },
];

const FPS_OPTIONS = FRAME_RATES.map((fps) => ({ value: String(fps), label: `${fps} fps` }));

function CompositionControls() {
  const composition = useChordStore((s) => s.document.project.composition);
  const setComposition = useChordStore((s) => s.setComposition);
  const activePreset = COMPOSITION_PRESETS.find(
    (preset) => preset.size.width === composition.width && preset.size.height === composition.height,
  );

  return (
    <>
      <Select
        value={activePreset?.id ?? 'custom'}
        options={COMPOSITION_OPTIONS}
        label="Composition"
        labelPlacement="hidden"
        className="w-36"
        onValueChange={(value) => {
          const preset = COMPOSITION_PRESETS.find((p) => p.id === value);
          if (preset) setComposition({ width: preset.size.width, height: preset.size.height });
        }}
      />
      <Select
        value={String(composition.fps)}
        options={FPS_OPTIONS}
        label="Frame rate"
        labelPlacement="hidden"
        className="w-24"
        onValueChange={(value) => setComposition({ fps: Number(value) as FrameRate })}
      />
    </>
  );
}

function ThemePresetPopover() {
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
        aria-label="Theme preset"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-secondary hover:bg-tertiary"
      >
        <span
          className="size-3.5 shrink-0 rounded-full border border-primary"
          style={{ backgroundColor: current?.swatch.background ?? '#000000' }}
        />
        <span className="label-xs">{current?.label ?? 'Custom'}</span>
        <ChevronDown size={12} />
      </button>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-start"
        offset={6}
        className="grid w-56 grid-cols-3 gap-2 rounded-md border border-primary bg-primary p-2 shadow-lg"
      >
        {THEME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              applyPreset(preset.id);
              setOpen(false);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-sm border p-1.5 transition-colors',
              presetId === preset.id ? 'border-brand bg-brand/10' : 'border-primary hover:bg-tertiary',
            )}
          >
            <span
              className="flex h-6 w-full items-center justify-center rounded-sm text-[10px] font-semibold"
              style={{ backgroundColor: preset.swatch.background, color: preset.swatch.text }}
            >
              Aa
            </span>
            <span className="label-xs w-full truncate text-center text-secondary">{preset.label}</span>
          </button>
        ))}
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
  const exportDialogOpen = useShellUiState((s) => s.exportDialogOpen);

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-primary bg-primary px-2">
      <div className="flex min-w-0 flex-1 items-center">
        <TitleControl />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <DocumentControls />
        <Separator orientation="vertical" className="mx-1" />
        <ImportControls />
        <Separator orientation="vertical" className="mx-1" />
        <CompositionControls />
        <ThemePresetPopover />
        <Separator orientation="vertical" className="mx-1" />
        <HistoryControls />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <LyricsExportMenu />
        <ReacstButton className="bg-brand text-white hover:bg-brand/90" onClick={openExportDialog}>
          Export
        </ReacstButton>
      </div>

      <ExportDialog open={exportDialogOpen} onClose={closeExportDialog} />
      <CueFormatChooserDialog />
    </div>
  );
}
