import { Trash2, X } from 'lucide-react';
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
import type { CueClearLayer, CueFailurePolicy, CueKind, CuePayload, Id, LifecycleAction, LifecycleTarget, OnScopeExit, ScopeLevel } from '@core/types';
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
const LIFECYCLE_ACTION_OPTIONS: Array<{ value: LifecycleAction; label: string }> = [
  { value: 'cancel', label: 'Cancel (stop future work)' },
  { value: 'revert', label: 'Revert (stop + undo effects)' },
];
const SCOPE_LEVEL_OPTIONS: Array<{ value: ScopeLevel; label: string }> = [
  { value: 'global', label: 'Global (runs until cancelled)' },
  { value: 'deckItem', label: 'Deck item (stops when leaving the deck item)' },
  { value: 'slide', label: 'Slide (stops when leaving the slide)' },
];
const ON_SCOPE_EXIT_OPTIONS: Array<{ value: OnScopeExit; label: string }> = [
  { value: 'cancel', label: 'Cancel pending work' },
  { value: 'revert', label: 'Revert (undo effects)' },
  { value: 'none', label: 'Keep running' },
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
  const { actions: { updateMacroFields } } = useAutomation();
  if (!currentMacro) return null;

  const macroId = currentMacro.id;
  const loopEnabled = currentMacro.loopEnabled;

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
      <Section.Root>
        <Section.Header><Label.xs>Scope & lifecycle</Label.xs></Section.Header>
        <Section.Body>
          <FieldSelect
            label="Scope"
            value={currentMacro.scopeLevel}
            options={SCOPE_LEVEL_OPTIONS}
            onChange={(value) => { void updateMacroFields(macroId, { scopeLevel: value as ScopeLevel }); }}
            wide
          />
          {currentMacro.scopeLevel !== 'global' && (
            <FieldSelect
              label="On scope exit"
              value={currentMacro.onScopeExit}
              options={ON_SCOPE_EXIT_OPTIONS}
              onChange={(value) => { void updateMacroFields(macroId, { onScopeExit: value as OnScopeExit }); }}
              wide
            />
          )}
        </Section.Body>
      </Section.Root>
      <Section.Root>
        <Section.Header><Label.xs>Looping</Label.xs></Section.Header>
        <Section.Body>
          <FieldSelect
            label="Loop"
            value={loopEnabled ? 'on' : 'off'}
            options={[{ value: 'off', label: 'Run once' }, { value: 'on', label: 'Repeat' }]}
            onChange={(value) => { void updateMacroFields(macroId, { loopEnabled: value === 'on' }); }}
            wide
          />
          {loopEnabled && (
            <FieldInput
              label="Max iterations (blank = until scope exit / cancel)"
              type="number"
              min={1}
              value={currentMacro.loopCount ?? ''}
              onChange={(value) => {
                const trimmed = value.trim();
                if (trimmed === '') { void updateMacroFields(macroId, { loopCount: null }); return; }
                const parsed = parseNumber(value, currentMacro.loopCount ?? 1);
                void updateMacroFields(macroId, { loopCount: Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : null });
              }}
              wide
            />
          )}
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
  const { state: { currentMacro }, actions: { updateRowKind, updateRowPayload, updateRowFailurePolicy, updateRowDelays, deleteRow, selectRow } } = useMacroEditorScreen();
  const { overlays, mediaAssets, stages, macros } = useProjectContent();
  const overlayOptions = overlays.map((overlay) => ({ value: overlay.id, label: overlay.name }));
  const stageOptions = stages.map((s) => ({ value: s.id, label: s.name }));
  const mediaLayerOptions = mediaAssets.filter((asset) => asset.type === 'image' || asset.type === 'video').map((asset) => ({ value: asset.id, label: `${asset.name} (${asset.type})` }));
  const videoOptions = mediaAssets.filter((asset) => asset.type === 'video').map((asset) => ({ value: asset.id, label: asset.name }));
  const audioOptions = mediaAssets.filter((asset) => asset.type === 'audio').map((asset) => ({ value: asset.id, label: asset.name }));
  // A lifecycle cue can target any macro except the one being edited (a macro
  // can't cancel itself this way), plus the "all active" wildcard.
  const macroOptions = [
    { value: '*', label: 'All active macros' },
    ...macros.filter((macro) => macro.id !== currentMacro?.id).map((macro) => ({ value: macro.id, label: macro.name })),
  ];

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
              options={{ overlayOptions, stageOptions, mediaLayerOptions, videoOptions, audioOptions, macroOptions }}
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
      <Section.Root>
        <Section.Header><Label.xs>Timing</Label.xs></Section.Header>
        <Section.Body>
          <FieldInput
            label="Delay before (ms)"
            type="number"
            min={0}
            value={row.draftDelayBeforeMs}
            onChange={(value) => { if (value.trim() !== '') updateRowDelays(row.localId, { before: parseNumber(value, row.draftDelayBeforeMs) }); }}
            wide
          />
          <FieldInput
            label="Delay after (ms)"
            type="number"
            min={0}
            value={row.draftDelayAfterMs}
            onChange={(value) => { if (value.trim() !== '') updateRowDelays(row.localId, { after: parseNumber(value, row.draftDelayAfterMs) }); }}
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
  macroOptions: Array<{ value: string; label: string }>;
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
  if (kind === 'flow.lifecycle') {
    const lifecycle = payload as { action?: LifecycleAction; target?: LifecycleTarget };
    const action = lifecycle.action ?? 'cancel';
    const target = lifecycle.target ?? '*';
    return (
      <>
        <FieldSelect
          label="Action"
          value={action}
          options={LIFECYCLE_ACTION_OPTIONS}
          onChange={(value) => onChange({ action: value as LifecycleAction, target })}
          wide
        />
        <FieldSelect
          label="Target"
          value={String(target)}
          options={options.macroOptions}
          onChange={(value) => onChange({ action, target: value as LifecycleTarget })}
          wide
        />
      </>
    );
  }
  return <div className="text-xs text-tertiary">No target needed for this cue.</div>;
}

function TriggersInspector() {
  const { state: { currentMacro } } = useMacroEditorScreen();
  const { actions: { getBindingsForMacro, deleteBinding } } = useAutomation();
  const slidesContext = useSlides();
  if (!currentMacro) return null;
  const triggerBindings = getBindingsForMacro(currentMacro.id);

  if (triggerBindings.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState.Root>
          <EmptyState.Title>No triggers attached</EmptyState.Title>
          <EmptyState.Description>Right-click a slide and choose Automation → Macros to bind this macro to a slide, or right-click the macro in the bin and toggle Run on startup.</EmptyState.Description>
        </EmptyState.Root>
      </div>
    );
  }

  return (
    <Section.Root>
      <Section.Header><Label.xs>Triggered by</Label.xs></Section.Header>
      <Section.Body>
        {triggerBindings.map((binding) => {
          let label: string;
          let triggerLabel: string;
          if (binding.triggerType === 'app.startup') {
            label = 'App';
            triggerLabel = 'on Startup';
          } else {
            const sourceSlide = binding.sourceId ? slidesContext.slides.find((slide) => slide.id === binding.sourceId) ?? null : null;
            label = sourceSlide ? `Slide ${slidesContext.slides.indexOf(sourceSlide) + 1}` : 'Slide';
            triggerLabel = binding.triggerType === 'slide.take' ? 'on Take' : 'on Activate';
          }
          return (
            <div key={binding.id} className="flex items-center justify-between gap-2 rounded border border-primary bg-secondary/40 px-2 py-1.5 text-sm text-primary">
              <div className="min-w-0">
                <div className="truncate font-medium">{label}</div>
                <div className="text-xs text-tertiary">{triggerLabel}</div>
              </div>
              <button
                type="button"
                aria-label="Remove trigger"
                onClick={() => { void deleteBinding(binding.id); }}
                className="shrink-0 rounded p-1 text-tertiary hover:bg-tertiary hover:text-primary"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </Section.Body>
    </Section.Root>
  );
}
