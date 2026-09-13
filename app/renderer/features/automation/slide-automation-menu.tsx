import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type { CueKind, CuePayload, TriggerType } from '@lumacast/automation';
import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useAutomation } from './automation-context';

export function SlideAutomationMenu({ slideId, slideIds }: { slideId?: Id; slideIds?: Id[] }) {
  const {
    state: { macros, isLoading },
    actions: { ensureCue, createBinding },
  } = useAutomation();
  const { overlays, mediaAssets, stages } = useProjectContent();
  const [triggerType, setTriggerType] = useState<TriggerType>('slide.activate');

  const images = mediaAssets.filter((asset) => asset.type === 'image');
  const videos = mediaAssets.filter((asset) => asset.type === 'video');
  const audios = mediaAssets.filter((asset) => asset.type === 'audio');
  const sourceIds = slideIds ?? (slideId ? [slideId] : []);

  async function bindCue(input: { kind: CueKind; payload: CuePayload }) {
    const cue = await ensureCue({ kind: input.kind, payload: input.payload });
    for (const sourceId of sourceIds) {
      await createBinding({
        triggerType,
        sourceId,
        targetType: 'cue',
        targetId: cue.id,
      });
    }
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
      <ContextMenu.Submenu label="When">
        <ContextMenu.Item closeOnSelect={false} onSelect={() => setTriggerType('slide.activate')}>
          <span className="inline-flex items-center gap-1.5">
            {triggerType === 'slide.activate' ? <Check className="size-3.5" /> : <span className="inline-block size-3.5" />}
            Activate
          </span>
        </ContextMenu.Item>
        <ContextMenu.Item closeOnSelect={false} onSelect={() => setTriggerType('slide.take')}>
          <span className="inline-flex items-center gap-1.5">
            {triggerType === 'slide.take' ? <Check className="size-3.5" /> : <span className="inline-block size-3.5" />}
            Take
          </span>
        </ContextMenu.Item>
      </ContextMenu.Submenu>
      <ContextMenu.Separator />

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
            key={`video.arm:${asset.id}`}
            onSelect={() => {
              void bindCue({ kind: 'video.arm', payload: { assetId: asset.id } });
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
              void (async () => {
                for (const sourceId of sourceIds) {
                  await createBinding({
                    triggerType,
                    sourceId,
                    targetType: 'macro',
                    targetId: macro.id,
                  });
                }
              })();
            }}
          >
            {macro.name}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Submenu>
    </ContextMenu.Submenu>
  );
}
