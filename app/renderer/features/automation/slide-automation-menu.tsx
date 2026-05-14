import type { CueKind, CuePayload, Id } from '@core/types';
import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useAutomation } from './automation-context';
import { describeCue } from './describe-cue';

export function SlideAutomationMenu({ slideId }: { slideId: Id }) {
  const {
    state: { cues, macros, isLoading },
    actions: { ensureCue, createBinding, deleteBinding, getBindingsForSource },
  } = useAutomation();
  const { overlays, mediaAssets, stages } = useProjectContent();

  const activateBindings = getBindingsForSource('slide.activate', slideId);
  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const macroById = new Map(macros.map((macro) => [macro.id, macro]));

  async function bindCue(input: { kind: CueKind; payload: CuePayload }) {
    const cue = await ensureCue({ kind: input.kind, payload: input.payload });
    await createBinding({
      triggerType: 'slide.activate',
      sourceId: slideId,
      targetType: 'cue',
      targetId: cue.id,
    });
  }

  if (isLoading) {
    return (
      <ContextMenu.Submenu label="Automation" disabled>
        <ContextMenu.Item disabled>Loading…</ContextMenu.Item>
      </ContextMenu.Submenu>
    );
  }

  return (
    <ContextMenu.Submenu label="Automation">
      <ContextMenu.Submenu label="Activate Overlay" disabled={overlays.length === 0}>
        {overlays.length === 0 ? (
          <ContextMenu.Item disabled>No overlays available</ContextMenu.Item>
        ) : (
          overlays.map((overlay) => (
            <ContextMenu.Item
              key={`overlay.activate:${overlay.id}`}
              onSelect={() => {
                void bindCue({ kind: 'overlay.activate', payload: { overlayId: overlay.id } });
              }}
            >
              {overlay.name}
            </ContextMenu.Item>
          ))
        )}
      </ContextMenu.Submenu>

      <ContextMenu.Submenu label="Clear Overlay" disabled={overlays.length === 0}>
        {overlays.length === 0 ? (
          <ContextMenu.Item disabled>No overlays available</ContextMenu.Item>
        ) : (
          overlays.map((overlay) => (
            <ContextMenu.Item
              key={`overlay.clear:${overlay.id}`}
              onSelect={() => {
                void bindCue({ kind: 'overlay.clear', payload: { overlayId: overlay.id } });
              }}
            >
              {overlay.name}
            </ContextMenu.Item>
          ))
        )}
      </ContextMenu.Submenu>

      <ContextMenu.Item
        onSelect={() => {
          void bindCue({ kind: 'overlay.clearAll', payload: {} });
        }}
      >
        Clear All Overlays
      </ContextMenu.Item>

      <ContextMenu.Submenu label="Set Background Media" disabled={!mediaAssets.some((asset) => asset.type === 'image' || asset.type === 'video')}>
        {mediaAssets.filter((asset) => asset.type === 'image' || asset.type === 'video').map((asset) => (
          <ContextMenu.Item
            key={`mediaLayer.set:${asset.id}`}
            onSelect={() => {
              void bindCue({ kind: 'mediaLayer.set', payload: { assetId: asset.id } });
            }}
          >
            {asset.name}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>

      <ContextMenu.Submenu label="Arm Video" disabled={!mediaAssets.some((asset) => asset.type === 'video')}>
        {mediaAssets.filter((asset) => asset.type === 'video').map((asset) => (
          <ContextMenu.Item
            key={`video.arm:${asset.id}`}
            onSelect={() => {
              void bindCue({ kind: 'video.arm', payload: { assetId: asset.id } });
            }}
          >
            {asset.name}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>

      <ContextMenu.Item
        onSelect={() => {
          void bindCue({ kind: 'video.clear', payload: {} });
        }}
      >
        Clear Video
      </ContextMenu.Item>

      <ContextMenu.Submenu label="Arm Audio" disabled={!mediaAssets.some((asset) => asset.type === 'audio')}>
        {mediaAssets.filter((asset) => asset.type === 'audio').map((asset) => (
          <ContextMenu.Item
            key={`audio.arm:${asset.id}`}
            onSelect={() => {
              void bindCue({ kind: 'audio.arm', payload: { assetId: asset.id } });
            }}
          >
            {asset.name}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>

      <ContextMenu.Item
        onSelect={() => {
          void bindCue({ kind: 'audio.clear', payload: {} });
        }}
      >
        Clear Audio
      </ContextMenu.Item>

      <ContextMenu.Submenu label="Set Stage" disabled={stages.length === 0}>
        {stages.length === 0 ? (
          <ContextMenu.Item disabled>No stages available</ContextMenu.Item>
        ) : (
          stages.map((stage) => (
            <ContextMenu.Item
              key={`stage.set:${stage.id}`}
              onSelect={() => {
                void bindCue({ kind: 'stage.set', payload: { stageId: stage.id } });
              }}
            >
              {stage.name}
            </ContextMenu.Item>
          ))
        )}
      </ContextMenu.Submenu>

      <ContextMenu.Item
        onSelect={() => {
          void bindCue({ kind: 'stage.clear', payload: {} });
        }}
      >
        Clear Stage
      </ContextMenu.Item>

      <ContextMenu.Submenu label="Clear Layer">
        {(['media', 'video', 'content', 'overlay'] as const).map((layer) => (
          <ContextMenu.Item
            key={`layer.clear:${layer}`}
            onSelect={() => {
              void bindCue({ kind: 'layer.clear', payload: { layer } });
            }}
          >
            {layer}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>

      <ContextMenu.Item
        onSelect={() => {
          void bindCue({ kind: 'layer.clearAll', payload: {} });
        }}
      >
        Clear All Layers
      </ContextMenu.Item>

      <ContextMenu.Separator />

      <ContextMenu.Submenu label="Macros" disabled={macros.length === 0}>
        {macros.length === 0 ? (
          <ContextMenu.Item disabled>No macros available</ContextMenu.Item>
        ) : (
          macros.map((macro) => (
            <ContextMenu.Item
              key={`macro:${macro.id}`}
              onSelect={() => {
                void createBinding({
                  triggerType: 'slide.activate',
                  sourceId: slideId,
                  targetType: 'macro',
                  targetId: macro.id,
                });
              }}
            >
              {macro.name}
            </ContextMenu.Item>
          ))
        )}
      </ContextMenu.Submenu>

      <ContextMenu.Separator />

      <ContextMenu.Submenu label="Remove Binding" disabled={activateBindings.length === 0}>
        {activateBindings.length === 0 ? (
          <ContextMenu.Item disabled>No bindings attached</ContextMenu.Item>
        ) : (
          activateBindings.map((binding) => {
            const label = binding.targetType === 'cue'
              ? `Cue: ${describeCue(cueById.get(binding.targetId), { overlays, stages, mediaAssets })}`
              : `Macro: ${macroById.get(binding.targetId)?.name ?? 'Unknown macro'}`;
            return (
              <ContextMenu.Item key={`remove:${binding.id}`} onSelect={() => { void deleteBinding(binding.id); }}>
                {label}
              </ContextMenu.Item>
            );
          })
        )}
      </ContextMenu.Submenu>
    </ContextMenu.Submenu>
  );
}
