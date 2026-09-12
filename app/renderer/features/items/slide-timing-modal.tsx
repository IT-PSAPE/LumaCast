import { useCallback, useMemo, useState } from 'react';
import { GripVertical } from 'lucide-react';
import type { ItemRef } from '@lumacast/composition';
import type { PlaybackSchedule } from '@lumacast/automation';
import { ReacstButton } from '../../components/controls/button';
import { Dialog } from '../../components/overlays/dialog';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { SortableList, useSortableItem, useSortableOrder, type SortableOrderCommit } from '../../components/layout/sortable-list';
import { SceneFrame } from '../../components/display/scene-frame';
import { LazySceneStage } from '../../components/display/lazy-scene-stage';
import { useNavigation } from '../../contexts/navigation-context';
import { useThumbnailScene } from '../../contexts/canvas/canvas-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { usePlaybackSchedules } from '../../contexts/playback-schedules-context';

type DraftStep = { slideId: string; seconds: string };
const getStepId = (step: DraftStep) => step.slideId;

function TimingRow({ step, index, disabled, onChange }: {
  step: DraftStep; index: number; disabled: boolean; onChange: (id: string, value: string) => void;
}) {
  const { containerRef, containerStyle, handleProps } = useSortableItem(step.slideId);
  const getThumbnailScene = useThumbnailScene();
  const scene = getThumbnailScene(step.slideId, 'list');
  return (
    <div ref={containerRef} style={containerStyle} className="flex items-center gap-3 rounded-md border border-secondary bg-primary p-3">
      <button {...handleProps} type="button" disabled={disabled} aria-label={`Reorder slide ${index + 1}`} className="cursor-grab text-tertiary"><GripVertical size={16} /></button>
      <div className="w-28 shrink-0" aria-label={`Slide ${index + 1} thumbnail`}>
        {scene ? <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
          <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
        </SceneFrame> : <div className="aspect-video rounded bg-tertiary" />}
      </div>
      <span className="min-w-0 flex-1 text-sm">Slide {index + 1}</span>
      <label className="flex items-center gap-2 text-sm text-secondary">
        <input type="number" min="0.001" step="0.001" aria-label={`Slide ${index + 1} duration in seconds`} value={step.seconds}
          disabled={disabled} onChange={event => onChange(step.slideId, event.target.value)}
          className="w-24 rounded border border-secondary bg-primary px-2 py-1 text-right tabular-nums" />
        <span>s</span>
      </label>
    </div>
  );
}

export function SlideTimingModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { currentItemRef } = useNavigation();
  if (!isOpen || !currentItemRef) return null;
  return <TimingEditor key={`${currentItemRef.type}:${currentItemRef.id}`} itemRef={currentItemRef} onClose={onClose} />;
}

function TimingEditor({ itemRef, onClose }: { itemRef: ItemRef; onClose: () => void }) {
  const { schedules, saveSchedule } = usePlaybackSchedules();
  const { slidesForItemRef } = useProjectContent();
  const confirm = useConfirm();
  const slides = slidesForItemRef(itemRef);
  const existing = schedules.find((schedule): schedule is Extract<PlaybackSchedule, { kind: 'slide-timing' }> =>
    schedule.kind === 'slide-timing' && schedule.itemRef?.type === itemRef.type && schedule.itemRef.id === itemRef.id);
  const [draft, setDraft] = useState<DraftStep[]>(() => {
    const ids = new Set(slides.map(slide => slide.id));
    const saved = (existing?.steps ?? []).filter(step => ids.has(step.slideId));
    const savedIds = new Set(saved.map(step => step.slideId));
    return [...saved.map(step => ({ slideId: step.slideId, seconds: String(step.durationMs / 1000) })),
      ...slides.filter(slide => !savedIds.has(slide.id)).map(slide => ({ slideId: slide.id, seconds: '5' }))];
  });
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [initial] = useState(() => JSON.stringify({ draft, enabled }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commitOrder = useCallback(({ orderedIds }: SortableOrderCommit) => {
    setDraft(current => {
      const byId = new Map(current.map(step => [step.slideId, step]));
      const moved = new Set(orderedIds);
      return [...orderedIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []), ...current.filter(step => !moved.has(step.slideId))];
    });
  }, []);
  const { items, dnd } = useSortableOrder({ items: draft, getId: getStepId, commit: commitOrder, disabled: saving });
  const changeDuration = useCallback((id: string, seconds: string) => {
    setDraft(current => current.map(step => step.slideId === id ? { ...step, seconds } : step));
  }, []);
  const dirty = useMemo(() => JSON.stringify({ draft, enabled }) !== initial, [draft, enabled, initial]);
  async function close() {
    if (saving) return;
    if (dirty && !await confirm({ title: 'Discard timing changes?', confirmLabel: 'Discard', destructive: true })) return;
    onClose();
  }
  async function save() {
    if (saving) return;
    if (draft.some(step => !Number.isFinite(Number(step.seconds)) || Number(step.seconds) <= 0 || Math.round(Number(step.seconds) * 1000) < 1)) {
      setError('Enter a positive duration for every slide.'); return;
    }
    const available = new Set(slides.map(slide => slide.id));
    if (draft.some(step => !available.has(step.slideId))) {
      setError('A slide was removed. Reopen slide timing to refresh the list.'); return;
    }
    setSaving(true); setError(null);
    try {
      await saveSchedule({ id: existing?.id ?? `timing:${itemRef.type}:${itemRef.id}`, kind: 'slide-timing', itemRef, enabled,
        steps: draft.map(step => ({ slideId: step.slideId, durationMs: Math.round(Number(step.seconds) * 1000) })) });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save slide timing.'); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open) void close(); }}>
    <Dialog.Portal><Dialog.Backdrop /><Dialog.Positioner>
      <Dialog.Content className="w-full max-w-xl" data-ui-region="slide-timing-modal">
        <Dialog.Header><Dialog.Title>Slide timing</Dialog.Title><Dialog.CloseButton /></Dialog.Header>
        <Dialog.Body className="space-y-3 p-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={saving} onChange={event => setEnabled(event.target.checked)} />Enable slide timing</label>
          <div className="max-h-[60vh] space-y-2 overflow-auto">
            <SortableList.Root {...dnd} layout="vertical">
              {items.map((step, index) => <TimingRow key={step.slideId} step={step} index={index} disabled={saving} onChange={changeDuration} />)}
            </SortableList.Root>
            {items.length === 0 && <p className="text-sm text-secondary">Add slides to set their timing.</p>}
          </div>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
        </Dialog.Body>
        <Dialog.Footer><ReacstButton variant="ghost" disabled={saving} onClick={() => void close()}>Cancel</ReacstButton>
          <ReacstButton variant="take" disabled={saving || items.length === 0} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</ReacstButton></Dialog.Footer>
      </Dialog.Content>
    </Dialog.Positioner></Dialog.Portal>
  </Dialog.Root>;
}
