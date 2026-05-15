import type { CueKind, CuePayload, Id } from '@core/types';
import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useAutomation } from './automation-context';

export function SlideAutomationMenu({ slideId }: { slideId: Id }) {
  const {
    state: { macros, isLoading },
    actions: { ensureCue, createBinding },
  } = useAutomation();
  const { overlays, mediaAssets, stages } = useProjectContent();

  const images = mediaAssets.filter((asset) => asset.type === 'image');
  const videos = mediaAssets.filter((asset) => asset.type === 'video');
  const audios = mediaAssets.filter((asset) => asset.type === 'audio');

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
      <ContextMenu.Submenu label="Clear">
        <ContextMenu.Item
          onSelect={() => {
            void bindCue({ kind: 'layer.clearAll', payload: {} });
          }}
        >
          All Layers
        </ContextMenu.Item>
        <ContextMenu.Item
          onSelect={() => {
            void bindCue({ kind: 'stage.clear', payload: {} });
          }}
        >
          Stage
        </ContextMenu.Item>
        <ContextMenu.Item
          onSelect={() => {
            void bindCue({ kind: 'overlay.clearAll', payload: {} });
          }}
        >
          Overlays
        </ContextMenu.Item>
        <ContextMenu.Item
          onSelect={() => {
            void bindCue({ kind: 'layer.clear', payload: { layer: 'media' } });
          }}
        >
          Image Layer
        </ContextMenu.Item>
        <ContextMenu.Item
          onSelect={() => {
            void bindCue({ kind: 'video.clear', payload: {} });
          }}
        >
          Video Layer
        </ContextMenu.Item>
        <ContextMenu.Item
          onSelect={() => {
            void bindCue({ kind: 'audio.clear', payload: {} });
          }}
        >
          Audio
        </ContextMenu.Item>
      </ContextMenu.Submenu>

      <ContextMenu.Submenu label="Stage" disabled={stages.length === 0}>
        {stages.map((stage) => (
          <ContextMenu.Item
            key={`stage.set:${stage.id}`}
            onSelect={() => {
              void bindCue({ kind: 'stage.set', payload: { stageId: stage.id } });
            }}
          >
            {stage.name}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>

      <ContextMenu.Submenu label="Overlays" disabled={overlays.length === 0}>
        {overlays.map((overlay) => (
          <ContextMenu.Item
            key={`overlay.activate:${overlay.id}`}
            onSelect={() => {
              void bindCue({ kind: 'overlay.activate', payload: { overlayId: overlay.id } });
            }}
          >
            {overlay.name}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>

      <ContextMenu.Submenu label="Image" disabled={images.length === 0}>
        {images.map((asset) => (
          <ContextMenu.Item
            key={`mediaLayer.set:image:${asset.id}`}
            onSelect={() => {
              void bindCue({ kind: 'mediaLayer.set', payload: { assetId: asset.id } });
            }}
          >
            {asset.name}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>

      <ContextMenu.Submenu label="Video" disabled={videos.length === 0}>
        {videos.map((asset) => (
          <ContextMenu.Item
            key={`mediaLayer.set:video:${asset.id}`}
            onSelect={() => {
              void bindCue({ kind: 'mediaLayer.set', payload: { assetId: asset.id } });
            }}
          >
            {asset.name}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>

      <ContextMenu.Submenu label="Audio" disabled={audios.length === 0}>
        {audios.map((asset) => (
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

      <ContextMenu.Separator />

      <ContextMenu.Submenu label="Macros" disabled={macros.length === 0}>
        {macros.map((macro) => (
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
        ))}
      </ContextMenu.Submenu>
    </ContextMenu.Submenu>
  );
}
