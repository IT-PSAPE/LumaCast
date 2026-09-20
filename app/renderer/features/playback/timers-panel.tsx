import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, Copy, Ellipsis, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { createId, type Id } from '@lumacast/kernel';
import type { Timer, TimerFormat, TimerKind, TimerReading, TimerRunState, TimerThreshold } from '@lumacast/composition';
import { Accordion, useAccordionItem } from '@renderer/components/display/accordion';
import { EmptyState } from '@renderer/components/display/empty-state';
import { ReacstButton } from '@renderer/components/controls/button';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { Dropdown } from '@renderer/components/form/dropdown';
import { FieldCheckbox, FieldColor, FieldInput, FieldSelect } from '@renderer/components/form/field';
import { RenameField, type RenameFieldHandle } from '@renderer/components/form/rename-field';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirmDelete } from '@renderer/components/overlays/confirm-dialog';
import { useTimers } from '@renderer/contexts/timers/timers-context';
import { cn } from '@renderer/utils/cn';
import { filterByText } from '../../utils/filter-by-text';
import { formatDurationInput, parseDurationSeconds } from './timer-duration-input';

type TimerPatch = Partial<Omit<Timer, 'id' | 'createdAt' | 'updatedAt'>>;

export function TimersPanel() {
  const { timers, runStates, readings, createTimer, updateTimer, deleteTimer, duplicateTimer, toggle, reset, pauseAll, resetAll } = useTimers();
  const { state: { searchValue } } = useBinControls();
  const [openIds, setOpenIds] = useState<string[]>([]);
  const confirmDelete = useConfirmDelete();

  const filtered = useMemo(
    () => filterByText(timers, searchValue, (timer: Timer) => [timer.name]),
    [timers, searchValue],
  );

  async function handleDelete(timer: Timer) {
    const ok = await confirmDelete(`"${timer.name}"`);
    // deleteTimer may race a concurrent delete of the same row; the store
    // layer has already surfaced the failure, so absorb the rethrow here.
    if (ok) await deleteTimer(timer.id).catch(() => undefined);
  }

  return (
    <BinShell>
      <div className="flex w-full shrink-0 items-center justify-end gap-1 border-b border-secondary px-1.5 py-1">
        <Dropdown>
          <Dropdown.Trigger aria-label="More timer actions" className="cursor-pointer rounded-sm bg-transparent p-1 text-tertiary transition-colors hover:bg-tertiary hover:text-primary [&>svg]:size-4">
            <Ellipsis />
          </Dropdown.Trigger>
          <Dropdown.Panel placement="bottom-end">
            <Dropdown.Item onClick={resetAll}>
              <RotateCcw size={14} strokeWidth={1.5} /> Reset all
            </Dropdown.Item>
            <Dropdown.Item onClick={pauseAll}>
              <Pause size={14} strokeWidth={1.5} /> Pause all
            </Dropdown.Item>
          </Dropdown.Panel>
        </Dropdown>
        <ReacstButton.Icon label="Add timer" onClick={() => { void createTimer(); }}>
          <Plus />
        </ReacstButton.Icon>
      </div>
      <BinShell.Content className={timers.length === 0 ? undefined : 'px-0 py-0'}>
        {timers.length === 0 ? (
          <EmptyState.Root>
            <EmptyState.Title>No timers yet.</EmptyState.Title>
          </EmptyState.Root>
        ) : (
          <Accordion type="multiple" value={openIds} onValueChange={(value) => setOpenIds(value as string[])}>
            {filtered.map((timer) => (
              <ContextMenu.Root key={timer.id}>
                <TimerRow
                  timer={timer}
                  runStatus={runStates[timer.id]?.status ?? 'idle'}
                  reading={readings[timer.id] ?? null}
                  onToggle={() => toggle(timer.id)}
                  onReset={() => reset(timer.id)}
                  onRename={(name) => { void updateTimer(timer.id, { name }); }}
                  onUpdate={(patch) => { void updateTimer(timer.id, patch); }}
                  onDuplicate={() => { void duplicateTimer(timer.id); }}
                  onDelete={() => { void handleDelete(timer); }}
                />
              </ContextMenu.Root>
            ))}
          </Accordion>
        )}
      </BinShell.Content>
    </BinShell>
  );
}

// ─── Row ─────────────────────────────────────────────────

interface TimerRowProps {
  timer: Timer;
  runStatus: TimerRunState['status'];
  reading: TimerReading | null;
  onToggle: () => void;
  onReset: () => void;
  onRename: (name: string) => void;
  onUpdate: (patch: TimerPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function TimerRow({ timer, runStatus, reading, onToggle, onReset, onRename, onUpdate, onDuplicate, onDelete }: TimerRowProps) {
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete });
  const isCountdownToTime = timer.kind === 'countdown-to-time';
  const phase = reading?.phase ?? 'idle';
  const readoutColor = reading?.color ?? null;

  return (
    <>
      <Accordion.Item value={timer.id} className="border-b border-secondary/60 last:border-b-0">
        <div
          {...triggerHandlers}
          ref={triggerRef}
          className="flex items-center gap-1.5 px-1.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Accordion.Trigger
            aria-label="Toggle timer settings"
            className="w-auto shrink-0 rounded-sm p-1 text-tertiary transition-colors hover:bg-tertiary hover:text-primary"
          >
            <DisclosureChevron />
          </Accordion.Trigger>
          <div className="min-w-0 flex-1" onClick={() => renameRef.current?.startEditing()}>
            <RenameField ref={renameRef} value={timer.name} onValueChange={onRename} className="label-xs" />
          </div>
          <span
            className={cn(
              'shrink-0 font-mono text-sm tabular-nums',
              !readoutColor && phase === 'idle' && 'text-tertiary',
              !readoutColor && (phase === 'overrun' || phase === 'finished') && 'font-semibold text-error',
              !readoutColor && (phase === 'running' || phase === 'paused') && 'text-primary',
            )}
            style={readoutColor ? { color: readoutColor } : undefined}
          >
            {reading?.text ?? '--:--'}
          </span>
          <ReacstButton.Icon
            label={runStatus === 'running' ? 'Pause' : 'Start'}
            variant={runStatus === 'running' ? 'default' : 'take'}
            disabled={isCountdownToTime}
            onClick={onToggle}
          >
            {runStatus === 'running' ? <Pause /> : <Play />}
          </ReacstButton.Icon>
          <ReacstButton.Icon label="Reset" variant="ghost" onClick={onReset}>
            <RotateCcw />
          </ReacstButton.Icon>
        </div>
        <Accordion.Content>
          <TimerConfig timer={timer} onUpdate={onUpdate} />
        </Accordion.Content>
      </Accordion.Item>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={onDuplicate}>
            <span className="inline-flex items-center gap-1.5"><Copy className="size-3.5" />Duplicate</span>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={onDelete}>
            <span className="inline-flex items-center gap-1.5"><Trash2 className="size-3.5" />Delete</span>
          </ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

function DisclosureChevron() {
  const { isOpen } = useAccordionItem();
  return <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} />;
}

// ─── Expanded config ─────────────────────────────────────

function TimerConfig({ timer, onUpdate }: { timer: Timer; onUpdate: (patch: TimerPatch) => void }) {
  const durationDraft = useDurationDraft(timer.durationSeconds, (next) => onUpdate({ durationSeconds: next }));
  const elapsedStartDraft = useDurationDraft(timer.elapsedStartSeconds, (next) => onUpdate({ elapsedStartSeconds: next }));
  const elapsedEndDraft = useOptionalDurationDraft(timer.elapsedEndSeconds, (next) => onUpdate({ elapsedEndSeconds: next }));

  function handleAddThreshold() {
    const next: TimerThreshold = { id: createId(), atSeconds: 30, color: '#facc15' };
    onUpdate({ thresholds: sortThresholds([...timer.thresholds, next]) });
  }

  function handleRemoveThreshold(id: Id) {
    onUpdate({ thresholds: timer.thresholds.filter((threshold) => threshold.id !== id) });
  }

  function handleThresholdSecondsCommit(id: Id, seconds: number) {
    onUpdate({ thresholds: sortThresholds(timer.thresholds.map((threshold) => (threshold.id === id ? { ...threshold, atSeconds: seconds } : threshold))) });
  }

  function handleThresholdColorChange(id: Id, color: string) {
    onUpdate({ thresholds: timer.thresholds.map((threshold) => (threshold.id === id ? { ...threshold, color } : threshold)) });
  }

  return (
    <div className="flex flex-col gap-2 px-1.5 pb-2 pt-1">
      <FieldSelect value={timer.kind} onChange={(value) => onUpdate({ kind: value as TimerKind })} label="Kind">
        <FieldSelect.Option value={'countdown' satisfies TimerKind}>Countdown</FieldSelect.Option>
        <FieldSelect.Option value={'countdown-to-time' satisfies TimerKind}>Countdown to time</FieldSelect.Option>
        <FieldSelect.Option value={'elapsed' satisfies TimerKind}>Elapsed</FieldSelect.Option>
      </FieldSelect>

      {timer.kind === 'countdown' && (
        <FieldInput
          label="Duration"
          value={durationDraft.draft}
          onChange={durationDraft.setDraft}
          onBlur={durationDraft.commit}
          onKeyDown={durationDraft.handleKeyDown}
        />
      )}

      {timer.kind === 'countdown-to-time' && (
        <label className="flex min-w-0 flex-col gap-0.5 text-sm text-secondary">
          <span className="truncate">Target time</span>
          <input
            type="time"
            step={1}
            value={timer.targetTime ?? ''}
            onChange={(event) => onUpdate({ targetTime: event.target.value === '' ? null : event.target.value })}
            className="min-h-8 w-full min-w-0 rounded bg-tertiary px-2 text-sm text-primary outline-none transition-colors focus:ring-1 focus:ring-brand"
          />
        </label>
      )}

      {timer.kind === 'elapsed' && (
        <div className="flex gap-1.5">
          <FieldInput
            label="Start"
            value={elapsedStartDraft.draft}
            onChange={elapsedStartDraft.setDraft}
            onBlur={elapsedStartDraft.commit}
            onKeyDown={elapsedStartDraft.handleKeyDown}
          />
          <FieldInput
            label="End"
            placeholder="No end"
            value={elapsedEndDraft.draft}
            onChange={elapsedEndDraft.setDraft}
            onBlur={elapsedEndDraft.commit}
            onKeyDown={elapsedEndDraft.handleKeyDown}
          />
        </div>
      )}

      <FieldSelect value={timer.format} onChange={(value) => onUpdate({ format: value as TimerFormat })} label="Format">
        <FieldSelect.Option value={'mm:ss' satisfies TimerFormat}>MM:SS</FieldSelect.Option>
        <FieldSelect.Option value={'hh:mm:ss' satisfies TimerFormat}>HH:MM:SS</FieldSelect.Option>
      </FieldSelect>

      <FieldCheckbox checked={timer.allowOverrun} label="Allow overrun" onChange={(checked) => onUpdate({ allowOverrun: checked })} />

      <div className="flex flex-col gap-1.5 border-t border-secondary/60 pt-2">
        {timer.thresholds.map((threshold) => (
          <ThresholdRow
            key={threshold.id}
            threshold={threshold}
            onCommitSeconds={(seconds) => handleThresholdSecondsCommit(threshold.id, seconds)}
            onColorChange={(color) => handleThresholdColorChange(threshold.id, color)}
            onRemove={() => handleRemoveThreshold(threshold.id)}
          />
        ))}
        <ReacstButton variant="ghost" className="self-start" onClick={handleAddThreshold}>
          <span className="inline-flex items-center gap-1.5"><Plus className="size-3.5" />Add threshold</span>
        </ReacstButton>
      </div>
    </div>
  );
}

function ThresholdRow({ threshold, onCommitSeconds, onColorChange, onRemove }: {
  threshold: TimerThreshold;
  onCommitSeconds: (seconds: number) => void;
  onColorChange: (color: string) => void;
  onRemove: () => void;
}) {
  const draft = useDurationDraft(threshold.atSeconds, onCommitSeconds);

  return (
    <div className="flex items-center gap-1.5">
      <FieldInput
        ariaLabel="Threshold time"
        value={draft.draft}
        onChange={draft.setDraft}
        onBlur={draft.commit}
        onKeyDown={draft.handleKeyDown}
      />
      <FieldColor value={threshold.color} onChange={onColorChange} />
      <ReacstButton.Icon label="Remove threshold" variant="ghost" onClick={onRemove}>
        <Trash2 />
      </ReacstButton.Icon>
    </div>
  );
}

function sortThresholds(thresholds: TimerThreshold[]): TimerThreshold[] {
  return [...thresholds].sort((a, b) => a.atSeconds - b.atSeconds);
}

// ─── Duration draft helpers ──────────────────────────────
// A local text draft that only reaches `updateTimer` on blur/Enter, per the
// app's field convention of not committing free-text inputs per keystroke.
// Shared across the timer duration, elapsed start/end, and threshold fields.

function useDurationDraft(seconds: number, onCommit: (next: number) => void) {
  const [draft, setDraft] = useState(() => formatDurationInput(seconds));

  useEffect(() => {
    setDraft(formatDurationInput(seconds));
  }, [seconds]);

  function commit() {
    const parsed = parseDurationSeconds(draft);
    if (parsed === null) {
      setDraft(formatDurationInput(seconds));
      return;
    }
    if (parsed !== seconds) onCommit(parsed);
    setDraft(formatDurationInput(parsed));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(formatDurationInput(seconds));
    }
  }

  return { draft, setDraft, commit, handleKeyDown };
}

function useOptionalDurationDraft(seconds: number | null, onCommit: (next: number | null) => void) {
  const [draft, setDraft] = useState(() => (seconds === null ? '' : formatDurationInput(seconds)));

  useEffect(() => {
    setDraft(seconds === null ? '' : formatDurationInput(seconds));
  }, [seconds]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (seconds !== null) onCommit(null);
      setDraft('');
      return;
    }
    const parsed = parseDurationSeconds(trimmed);
    if (parsed === null) {
      setDraft(seconds === null ? '' : formatDurationInput(seconds));
      return;
    }
    if (parsed !== seconds) onCommit(parsed);
    setDraft(formatDurationInput(parsed));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(seconds === null ? '' : formatDurationInput(seconds));
    }
  }

  return { draft, setDraft, commit, handleKeyDown };
}
