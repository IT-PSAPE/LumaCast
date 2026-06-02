import type { Cue, Id, TriggerBinding } from '@core/types';
import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useOverlayEditor, useStageEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { useAutomation } from './automation-context';
import { MACRO_ICON, getCueIcon } from './cue-icons';
import { describeCue } from './describe-cue';

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
      {bindings.map((binding) => {
        const cue = binding.targetType === 'cue' ? cueById.get(binding.targetId) : undefined;
        const macro = binding.targetType === 'macro' ? macroById.get(binding.targetId) : undefined;
        const Icon = binding.targetType === 'macro'
          ? MACRO_ICON
          : cue ? getCueIcon(cue, mediaAssets) : null;
        const label = binding.targetType === 'macro'
          ? (macro?.name ?? 'Unknown macro')
          : describeCue(cue, { overlays, stages, mediaAssets, macros });
        const canEdit = binding.targetType === 'macro'
          ? Boolean(macro)
          : cue?.kind === 'stage.set'
            || cue?.kind === 'overlay.activate'
            || cue?.kind === 'overlay.clear';

        return (
          <ContextMenu.Submenu
            key={binding.id}
            label={(
              <span className="inline-flex min-w-0 items-center gap-2">
                {Icon ? <Icon className="size-3.5 shrink-0 text-tertiary" /> : null}
                <span className="min-w-0 truncate">{label}</span>
              </span>
            )}
          >
            <ContextMenu.Item disabled={!canEdit} onSelect={() => editTarget(binding, cue)}>
              Edit
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item variant="destructive" onSelect={() => { void deleteBinding(binding.id); }}>
              Remove
            </ContextMenu.Item>
          </ContextMenu.Submenu>
        );
      })}
    </>
  );
}
