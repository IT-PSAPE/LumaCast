// The app's single toolbar: title/dirty on the left, document/import/look
// controls in the centre, export on the right. Every sub-control here is
// single-use, so each stays a local function in this one file rather than
// being split into separate wrapper-component files.
import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import {
  ChevronDown, FilePlus2, FolderOpen, ListMusic, Redo2, Save, Undo2,
} from 'lucide-react';
import { cn, Modal, PlainButton, ReacstButton } from '@lumacast/ui';
import type { CueFileFormat } from '../../../shared/desktop-api';
import { COMPOSITION_PRESETS, FRAME_RATES, type FrameRate } from '../../../shared/project';
import { THEME_PRESETS } from '../../../shared/theme-presets';
import { useChordStore } from '../../store';
import { SelectField } from '../../components/field';
import { ExportDialog } from '../export/export-dialog';
import { importAudio, importBackground, importLyrics } from '../library/import-flows';
import {
  closeCueFormatChooser, closeExportDialog, openExportDialog, useShellUiState,
} from './shell-ui-state';

function ToolbarSeparator() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-(--border-color-primary)" />;
}

function TitleControl() {
  const title = useChordStore((s) => s.document.project.title);
  const dirty = useChordStore((s) => s.dirty);
  const setTitle = useChordStore((s) => s.setTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label="Project title"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          const next = draft.trim();
          if (next && next !== title) setTitle(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(title);
            event.currentTarget.blur();
          }
        }}
        className="label-sm w-40 rounded-sm bg-tertiary px-2 py-1 text-primary outline-none focus:ring-1 focus:ring-brand"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(title);
        setEditing(true);
      }}
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
      <SelectField
        value={activePreset?.id ?? 'custom'}
        options={COMPOSITION_OPTIONS}
        ariaLabel="Composition"
        className="w-36"
        onChange={(value) => {
          const preset = COMPOSITION_PRESETS.find((p) => p.id === value);
          if (preset) setComposition({ width: preset.size.width, height: preset.size.height });
        }}
      />
      <SelectField
        value={String(composition.fps)}
        options={FPS_OPTIONS}
        ariaLabel="Frame rate"
        className="w-24"
        onChange={(value) => setComposition({ fps: Number(value) as FrameRate })}
      />
    </>
  );
}

function ThemePresetPopover() {
  const presetId = useChordStore((s) => s.document.project.theme.presetId);
  const applyPreset = useChordStore((s) => s.applyPreset);
  const [open, setOpen] = useState(false);
  const current = THEME_PRESETS.find((preset) => preset.id === presetId);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Theme preset"
        className="flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-secondary hover:bg-tertiary"
      >
        <span
          className="size-3.5 shrink-0 rounded-full border border-primary"
          style={{ backgroundColor: current?.swatch.background ?? '#000000' }}
        />
        <span className="label-xs">{current?.label ?? 'Custom'}</span>
        <ChevronDown size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="z-[60] outline-none">
          <Popover.Popup className="grid w-56 grid-cols-3 gap-2 rounded-md border border-primary bg-primary p-2 shadow-lg">
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
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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

  return (
    <Menu.Root>
      <Menu.Trigger className="btn inline-flex items-center gap-1">
        Lyrics <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} className="z-[60] outline-none">
          <Menu.Popup className="min-w-36 rounded-md border border-primary bg-primary p-1 shadow-lg">
            {CUE_FILE_FORMATS.map((format) => (
              <Menu.Item
                key={format.value}
                render={<button type="button" />}
                nativeButton
                onClick={() => void exportCueFile(format.value)}
                className="label-xs w-full cursor-pointer select-none rounded px-2 py-1.5 text-left text-secondary outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-primary"
              >
                {format.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Handles the native "Export Cues…" menu command, which has no submenu of its own. */
function CueFormatChooserDialog() {
  const open = useShellUiState((s) => s.cueFormatChooserOpen);
  const exportCueFile = useChordStore((s) => s.exportCueFile);

  return (
    <Modal open={open} onClose={closeCueFormatChooser} title="Export lyrics">
      <div className="flex flex-col gap-2">
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
        <ToolbarSeparator />
        <ImportControls />
        <ToolbarSeparator />
        <CompositionControls />
        <ThemePresetPopover />
        <ToolbarSeparator />
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
