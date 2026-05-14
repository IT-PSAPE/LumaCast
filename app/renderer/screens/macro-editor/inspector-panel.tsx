import { Trash2 } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Tabs } from '@renderer/components/display/tabs';
import { EmptyState } from '@renderer/components/display/empty-state';
import { Label } from '@renderer/components/display/text';
import { FieldInput, FieldSelect, FieldTextarea } from '@renderer/components/form/field';
import { Section } from '@renderer/features/inspector/inspector-section';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useSlides } from '@renderer/contexts/slide-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { useAutomation } from '@renderer/features/automation/automation-context';
import type { CueClearLayer, CueFailurePolicy, CueKind, CuePayload, Id } from '@core/types';
import { CUE_KIND_LABELS } from '@renderer/features/automation/describe-cue';
import { parseNumber } from '@renderer/utils/slides';
import { useMacroEditorScreen, type MacroEditorCueRow } from './screen-context';
import type { InspectorTab } from '@renderer/types/ui';

const CUE_KIND_OPTIONS = Object.entries(CUE_KIND_LABELS).map(([value, label]) => ({ value, label })) as Array<{ value: CueKind; label: string }>;
const FAILURE_POLICY_OPTIONS: Array<{ value: CueFailurePolicy; label: string }> = [
  { value: 'continue', label: 'Continue' },
  { value: 'abort', label: 'Abort' },
];
const CLEAR_LAYER_OPTIONS: Array<{ value: CueClearLayer; label: string }> = [
  { value: 'media', label: 'Media' },
  { value: 'video', label: 'Video' },
  { value: 'content', label: 'Content' },
  { value: 'overlay', label: 'Overlay' },
];

export function MacroEditorInspectorPanel() {
  const { state: { currentMacro, rows, selectedRowId, hasPendingChanges, isPushingChanges }, actions: { saveChanges } } = useMacroEditorScreen();
  const { inspectorTab, setInspectorTab } = useInspector();
  const selectedRow = rows.find((row) => row.localId === selectedRowId) ?? null;

  // Triggers only makes sense at the macro level — bindings are per-macro.
  // When a cue is selected, force back to Properties so the tab list and
  // visible panel stay consistent.
  const effectiveTab: InspectorTab = selectedRow
    ? 'properties'
    : (inspectorTab === 'triggers' || inspectorTab === 'properties')
    ? inspectorTab
    : 'properties';

  function handleTabChange(value: string) {
    setInspectorTab(value as InspectorTab);
  }

  if (!currentMacro) {
    return (
      <LumaCastPanel.Root className="h-full border-l border-secondary" data-ui-region="macro-inspector-panel">
        <div className="flex h-full items-center justify-center p-6">
          <EmptyState.Root>
            <EmptyState.Title>No macro selected</EmptyState.Title>
          </EmptyState.Root>
        </div>
      </LumaCastPanel.Root>
    );
  }

  return (
    <LumaCastPanel.Root className="h-full border-l border-secondary" data-ui-region="macro-inspector-panel">
      <Tabs.Root value={effectiveTab} onValueChange={handleTabChange}>
        <section className="flex flex-1 flex-col">
          <div className="border-b border-primary">
            <Tabs.List label="Inspector">
              <Tabs.Trigger value="properties">Properties</Tabs.Trigger>
              {!selectedRow && <Tabs.Trigger value="triggers">Triggers</Tabs.Trigger>}
            </Tabs.List>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {effectiveTab === 'properties' && (
              selectedRow ? <CueInspector row={selectedRow} /> : <MacroInspector />
            )}
            {effectiveTab === 'triggers' && <TriggersInspector />}
          </div>
        </section>
      </Tabs.Root>
      {hasPendingChanges && (
        <LumaCastPanel.Footer className="p-2">
          <ReacstButton onClick={() => { void saveChanges(); }} disabled={isPushingChanges} className="w-full">
            {isPushingChanges ? 'Pushing…' : 'Save Changes'}
          </ReacstButton>
        </LumaCastPanel.Footer>
      )}
    </LumaCastPanel.Root>
  );
}

function MacroInspector() {
  const {
    state: { currentMacro, rows, pendingName, pendingDescription },
    actions: { updateMacroName, updateMacroDescription, deleteCurrentMacro },
  } = useMacroEditorScreen();
  if (!currentMacro) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Section.Root>
        <Section.Header><Label.xs>Macro</Label.xs></Section.Header>
        <Section.Body>
          <FieldInput
            label="Name"
            value={pendingName}
            onChange={updateMacroName}
            wide
          />
          <FieldTextarea
            label="Description"
            value={pendingDescription}
            onChange={updateMacroDescription}
            rows={3}
            wide
          />
          <div className="text-xs text-tertiary">
            {rows.length} {rows.length === 1 ? 'cue' : 'cues'} in this macro.
          </div>
        </Section.Body>
      </Section.Root>
      <div className="mt-auto p-2">
        <ReacstButton variant="danger" onClick={() => { void deleteCurrentMacro(); }} className="w-full">
          <span className="inline-flex items-center gap-1.5"><Trash2 className="size-4" />Delete macro</span>
        </ReacstButton>
      </div>
    </div>
  );
}

function CueInspector({ row }: { row: MacroEditorCueRow }) {
  const { actions: { updateRowKind, updateRowPayload, updateRowFailurePolicy, deleteRow, selectRow } } = useMacroEditorScreen();
  const { overlays, mediaAssets, stages } = useProjectContent();
  const overlayOptions = overlays.map((overlay) => ({ value: overlay.id, label: overlay.name }));
  const stageOptions = stages.map((s) => ({ value: s.id, label: s.name }));
  const mediaLayerOptions = mediaAssets.filter((asset) => asset.type === 'image' || asset.type === 'video').map((asset) => ({ value: asset.id, label: `${asset.name} (${asset.type})` }));
  const videoOptions = mediaAssets.filter((asset) => asset.type === 'video').map((asset) => ({ value: asset.id, label: asset.name }));
  const audioOptions = mediaAssets.filter((asset) => asset.type === 'audio').map((asset) => ({ value: asset.id, label: asset.name }));

  const kind = row.link?.cue.kind ?? row.draftKind ?? null;
  const payload: CuePayload = row.link?.cue.payload ?? row.draftPayload ?? ({} as CuePayload);
  const failurePolicy = row.link?.cue.failurePolicy ?? row.draftFailurePolicy;

  function handleDelete() {
    deleteRow(row.localId);
    selectRow(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Section.Root>
        <Section.Header><Label.xs>Cue</Label.xs></Section.Header>
        <Section.Body>
          <FieldSelect
            label="Cue type"
            value={kind ?? ''}
            options={kind ? CUE_KIND_OPTIONS : [{ value: '', label: 'Pick a cue type…' }, ...CUE_KIND_OPTIONS]}
            onChange={(value) => { if (value) updateRowKind(row.localId, value as CueKind); }}
            wide
          />
          {kind ? (
            <CueTargetField
              kind={kind}
              payload={payload}
              options={{ overlayOptions, stageOptions, mediaLayerOptions, videoOptions, audioOptions }}
              onChange={(next) => updateRowPayload(row.localId, next)}
            />
          ) : null}
          <FieldSelect
            label="On failure"
            value={failurePolicy}
            options={FAILURE_POLICY_OPTIONS}
            onChange={(value) => updateRowFailurePolicy(row.localId, value as CueFailurePolicy)}
            wide
          />
        </Section.Body>
      </Section.Root>
      <div className="mt-auto p-2">
        <ReacstButton variant="danger" onClick={handleDelete} className="w-full">
          <span className="inline-flex items-center gap-1.5"><Trash2 className="size-4" />Remove cue</span>
        </ReacstButton>
      </div>
    </div>
  );
}

interface CueTargetOptions {
  overlayOptions: Array<{ value: Id; label: string }>;
  stageOptions: Array<{ value: Id; label: string }>;
  mediaLayerOptions: Array<{ value: Id; label: string }>;
  videoOptions: Array<{ value: Id; label: string }>;
  audioOptions: Array<{ value: Id; label: string }>;
}

function CueTargetField({
  kind,
  payload,
  options,
  onChange,
}: {
  kind: CueKind;
  payload: CuePayload;
  options: CueTargetOptions;
  onChange: (payload: CuePayload) => void;
}) {
  if (kind === 'overlay.activate' || kind === 'overlay.clear') {
    return (
      <FieldSelect
        label="Overlay"
        value={String((payload as { overlayId?: Id }).overlayId ?? '')}
        options={options.overlayOptions}
        onChange={(value) => onChange({ overlayId: value })}
        wide
      />
    );
  }
  if (kind === 'mediaLayer.set') {
    return (
      <FieldSelect
        label="Asset"
        value={String((payload as { assetId?: Id }).assetId ?? '')}
        options={options.mediaLayerOptions}
        onChange={(value) => onChange({ assetId: value })}
        wide
      />
    );
  }
  if (kind === 'video.arm') {
    return (
      <FieldSelect
        label="Video"
        value={String((payload as { assetId?: Id }).assetId ?? '')}
        options={options.videoOptions}
        onChange={(value) => onChange({ assetId: value })}
        wide
      />
    );
  }
  if (kind === 'audio.arm') {
    return (
      <FieldSelect
        label="Audio"
        value={String((payload as { assetId?: Id }).assetId ?? '')}
        options={options.audioOptions}
        onChange={(value) => onChange({ assetId: value })}
        wide
      />
    );
  }
  if (kind === 'stage.set') {
    return (
      <FieldSelect
        label="Stage"
        value={String((payload as { stageId?: Id }).stageId ?? '')}
        options={options.stageOptions}
        onChange={(value) => onChange({ stageId: value })}
        wide
      />
    );
  }
  if (kind === 'layer.clear') {
    return (
      <FieldSelect
        label="Layer"
        value={String((payload as { layer?: CueClearLayer }).layer ?? 'media')}
        options={CLEAR_LAYER_OPTIONS}
        onChange={(value) => onChange({ layer: value as CueClearLayer })}
        wide
      />
    );
  }
  if (kind === 'flow.wait') {
    const currentMs = Number((payload as { ms?: number }).ms ?? 0);
    return (
      <FieldInput
        label="Delay (ms)"
        type="number"
        min={0}
        value={Number.isFinite(currentMs) ? currentMs : 0}
        onChange={(value) => {
          const parsed = parseNumber(value, currentMs);
          onChange({ ms: Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0 });
        }}
        wide
      />
    );
  }
  return <div className="text-xs text-tertiary">No target needed for this cue.</div>;
}

function TriggersInspector() {
  const { state: { currentMacro } } = useMacroEditorScreen();
  const { actions: { getBindingsForMacro } } = useAutomation();
  const slidesContext = useSlides();
  if (!currentMacro) return null;
  const triggerBindings = getBindingsForMacro(currentMacro.id);

  if (triggerBindings.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState.Root>
          <EmptyState.Title>No triggers attached</EmptyState.Title>
          <EmptyState.Description>Right-click a slide and choose Automation → Macros to bind this macro to a slide.</EmptyState.Description>
        </EmptyState.Root>
      </div>
    );
  }

  return (
    <Section.Root>
      <Section.Header><Label.xs>Triggered by</Label.xs></Section.Header>
      <Section.Body>
        {triggerBindings.map((binding) => {
          const sourceSlide = binding.sourceId ? slidesContext.slides.find((slide) => slide.id === binding.sourceId) ?? null : null;
          const label = sourceSlide ? `Slide ${slidesContext.slides.indexOf(sourceSlide) + 1}` : 'Slide';
          const triggerLabel = binding.triggerType === 'slide.take' ? 'on Take' : 'on Activate';
          return (
            <div key={binding.id} className="rounded border border-primary bg-secondary/40 px-2 py-1.5 text-sm text-primary">
              <div className="font-medium">{label}</div>
              <div className="text-xs text-tertiary">{triggerLabel}</div>
            </div>
          );
        })}
      </Section.Body>
    </Section.Root>
  );
}
