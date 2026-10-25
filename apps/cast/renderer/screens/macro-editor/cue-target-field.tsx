import type { Id } from '@lumacast/kernel';
import type {
  CueClearLayer,
  CueKind,
  CuePayload,
  LifecycleAction,
  LifecycleTarget,
} from '@lumacast/automation';
import { Select } from '@lumacast/ui';

interface CueTargetOptions {
  overlayOptions: Array<{ value: Id; label: string }>;
  stageOptions: Array<{ value: Id; label: string }>;
  mediaLayerOptions: Array<{ value: Id; label: string }>;
  videoOptions: Array<{ value: Id; label: string }>;
  audioOptions: Array<{ value: Id; label: string }>;
  macroOptions: Array<{ value: string; label: string }>;
}

interface CueTargetFieldProps {
  kind: CueKind;
  payload: CuePayload;
  options: CueTargetOptions;
  onChange: (payload: CuePayload) => void;
}

export function CueTargetField({ kind, payload, options, onChange }: CueTargetFieldProps) {
  if (kind === 'overlay.activate' || kind === 'overlay.clear') {
    return (
      <Select label="Overlay" value={String((payload as { overlayId?: Id }).overlayId ?? '')} onValueChange={(value) => onChange({ overlayId: value })} options={options.overlayOptions} className="col-span-full" />
    );
  }
  if (kind === 'mediaLayer.set') {
    return (
      <Select label="Asset" value={String((payload as { assetId?: Id }).assetId ?? '')} onValueChange={(value) => onChange({ assetId: value })} options={options.mediaLayerOptions} className="col-span-full" />
    );
  }
  if (kind === 'video.arm') {
    return (
      <Select label="Video" value={String((payload as { assetId?: Id }).assetId ?? '')} onValueChange={(value) => onChange({ assetId: value })} options={options.videoOptions} className="col-span-full" />
    );
  }
  if (kind === 'audio.arm') {
    return (
      <Select label="Audio" value={String((payload as { assetId?: Id }).assetId ?? '')} onValueChange={(value) => onChange({ assetId: value })} options={options.audioOptions} className="col-span-full" />
    );
  }
  if (kind === 'stage.set') {
    return (
      <Select label="Stage" value={String((payload as { stageId?: Id }).stageId ?? '')} onValueChange={(value) => onChange({ stageId: value })} options={options.stageOptions} className="col-span-full" />
    );
  }
  if (kind === 'layer.clear') {
    return (
      <Select label="Layer" value={String((payload as { layer?: CueClearLayer }).layer ?? 'media')} onValueChange={(value) => onChange({ layer: value as CueClearLayer })} options={[{ value: 'media' satisfies CueClearLayer, label: 'Media' }, { value: 'video' satisfies CueClearLayer, label: 'Video' }, { value: 'content' satisfies CueClearLayer, label: 'Content' }, { value: 'overlay' satisfies CueClearLayer, label: 'Overlay' }]} className="col-span-full" />
    );
  }
  if (kind === 'flow.lifecycle') {
    const lifecycle = payload as { action?: LifecycleAction; target?: LifecycleTarget };
    const action = lifecycle.action ?? 'cancel';
    const target = lifecycle.target ?? '*';
    return (
      <>
        <Select label="Action" value={action} onValueChange={(value) => onChange({ action: value as LifecycleAction, target })} options={[{ value: 'cancel' satisfies LifecycleAction, label: 'Cancel (stop future work)' }, { value: 'revert' satisfies LifecycleAction, label: 'Revert (stop + undo effects)' }]} className="col-span-full" />
        <Select label="Target" value={String(target)} onValueChange={(value) => onChange({ action, target: value as LifecycleTarget })} options={options.macroOptions} className="col-span-full" />
      </>
    );
  }
  return <div className="text-xs text-tertiary">No target needed for this cue.</div>;
}
