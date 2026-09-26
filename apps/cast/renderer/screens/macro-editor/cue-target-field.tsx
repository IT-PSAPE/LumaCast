import { FieldSelect } from '@renderer/components/form/field';
import type { Id } from '@lumacast/kernel';
import type {
  CueClearLayer,
  CueKind,
  CuePayload,
  LifecycleAction,
  LifecycleTarget,
} from '@lumacast/automation';

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
        onChange={(value) => onChange({ layer: value as CueClearLayer })}
        wide
      >
        <FieldSelect.Option value={'media' satisfies CueClearLayer}>Media</FieldSelect.Option>
        <FieldSelect.Option value={'video' satisfies CueClearLayer}>Video</FieldSelect.Option>
        <FieldSelect.Option value={'content' satisfies CueClearLayer}>Content</FieldSelect.Option>
        <FieldSelect.Option value={'overlay' satisfies CueClearLayer}>Overlay</FieldSelect.Option>
      </FieldSelect>
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
          onChange={(value) => onChange({ action: value as LifecycleAction, target })}
          wide
        >
          <FieldSelect.Option value={'cancel' satisfies LifecycleAction}>Cancel (stop future work)</FieldSelect.Option>
          <FieldSelect.Option value={'revert' satisfies LifecycleAction}>Revert (stop + undo effects)</FieldSelect.Option>
        </FieldSelect>
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
