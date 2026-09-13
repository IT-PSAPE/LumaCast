import type { Id } from '@lumacast/kernel';
import type { MediaAsset, Overlay, Stage } from '@lumacast/composition';
import type { Cue, Macro, TriggerBinding } from '@lumacast/automation';
import { describeCue } from '@lumacast/automation';
import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useOverlayEditor, useStageEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { useAutomation } from './automation-context';
import { CueIcon, MacroIcon } from './cue-icons';

export function SlideBindingsMenu({ slideId }: { slideId: Id }) {
  const {
    state: { cues, macros },
    actions: { deleteBinding, getBindingsForSource, setCurrentMacroId },
  } = useAutomation();
  const { overlays, mediaAssets, stages } = useProjectContent();
  const { setCurrentOverlayId } = useOverlayEditor();
  const { setCurrentStageId } = useStageEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();

  const bindings = getBindingsForSource('slide.activate', slideId);
  if (bindings.length === 0) return null;

  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const macroById = new Map(macros.map((macro) => [macro.id, macro]));

  function editTarget(binding: TriggerBinding, cue: Cue | undefined) {
    if (binding.targetType === 'macro') {
      setCurrentMacroId(binding.targetId);
      setWorkbenchMode('macro-editor');
      return;
    }
    if (!cue) return;
    if (cue.kind === 'stage.set') {
      const stageId = (cue.payload as { stageId?: Id }).stageId;
      if (stageId) {
        setCurrentStageId(stageId);
        setWorkbenchMode('stage-editor');
      }
      return;
    }
    if (cue.kind === 'overlay.activate' || cue.kind === 'overlay.clear') {
      const overlayId = (cue.payload as { overlayId?: Id }).overlayId;
      if (overlayId) {
        setCurrentOverlayId(overlayId);
        setWorkbenchMode('overlay-editor');
      }
    }
  }

  return (
    <>
      {bindings.map((binding) => (
        <SlideBindingMenuItem
          key={binding.id}
          binding={binding}
          cue={cueById.get(binding.targetId)}
          macro={macroById.get(binding.targetId)}
          overlays={overlays}
          stages={stages}
          mediaAssets={mediaAssets}
          macros={macros}
          onEdit={editTarget}
          onRemove={deleteBinding}
        />
      ))}
    </>
  );
}

function SlideBindingMenuItem(props: {
  binding: TriggerBinding;
  cue: Cue | undefined;
  macro: Macro | undefined;
  overlays: Overlay[];
  stages: Stage[];
  mediaAssets: MediaAsset[];
  macros: Macro[];
  onEdit: (binding: TriggerBinding, cue: Cue | undefined) => void;
  onRemove: (bindingId: Id) => Promise<void>;
}) {
  if (props.binding.targetType === 'macro') return <MacroBindingMenuItem {...props} />;
  return <CueBindingMenuItem {...props} />;
}

function MacroBindingMenuItem({ binding, cue, macro, onEdit, onRemove }: Parameters<typeof SlideBindingMenuItem>[0]) {
  return (
    <ContextMenu.Submenu
      label={(
        <span className="inline-flex min-w-0 items-center gap-2">
          <MacroIcon className="size-3.5 shrink-0 text-tertiary" />
          <span className="min-w-0 truncate">{macro?.name ?? 'Unknown macro'}</span>
        </span>
      )}
    >
      <ContextMenu.Item disabled={!macro} onSelect={() => onEdit(binding, cue)}>Edit</ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item variant="destructive" onSelect={() => { void onRemove(binding.id); }}>Remove</ContextMenu.Item>
    </ContextMenu.Submenu>
  );
}

function CueBindingMenuItem({ binding, cue, overlays, stages, mediaAssets, macros, onEdit, onRemove }: Parameters<typeof SlideBindingMenuItem>[0]) {
  return (
    <ContextMenu.Submenu
      label={(
        <span className="inline-flex min-w-0 items-center gap-2">
          {cue && <CueIcon cue={cue} mediaAssets={mediaAssets} className="size-3.5 shrink-0 text-tertiary" />}
          <span className="min-w-0 truncate">{describeCue(cue, { overlays, stages, mediaAssets, macros })}</span>
        </span>
      )}
    >
      <ContextMenu.Item
        disabled={cue?.kind !== 'stage.set' && cue?.kind !== 'overlay.activate' && cue?.kind !== 'overlay.clear'}
        onSelect={() => onEdit(binding, cue)}
      >
        Edit
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item variant="destructive" onSelect={() => { void onRemove(binding.id); }}>Remove</ContextMenu.Item>
    </ContextMenu.Submenu>
  );
}
