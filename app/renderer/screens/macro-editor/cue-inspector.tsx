import { Trash2 } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { Label } from '@renderer/components/display/text';
import { FieldInput, FieldSelect } from '@renderer/components/form/field';
import { Section } from '@renderer/features/inspector/inspector-section';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { CUE_KIND_LABELS } from '@lumacast/automation';
import { parseNumber } from '@renderer/utils/slides';
import { useMacroEditorScreen, type MacroEditorCueRow } from './screen-context';
import { CueTargetField } from './cue-target-field';
import type { CueFailurePolicy, CueKind, CuePayload } from '@lumacast/automation';

const CUE_KIND_OPTIONS = Object.entries(CUE_KIND_LABELS).map(([value, label]) => ({ value, label })) as Array<{ value: CueKind; label: string }>;
const FAILURE_POLICY_OPTIONS: Array<{ value: CueFailurePolicy; label: string }> = [
  { value: 'continue', label: 'Continue' },
  { value: 'abort', label: 'Abort' },
];

export function CueInspector({ row }: { row: MacroEditorCueRow }) {
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
