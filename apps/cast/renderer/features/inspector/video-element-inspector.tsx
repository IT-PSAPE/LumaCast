import { useEffect, useRef } from 'react';
import type { SlideBackgroundFit, VideoElementPayload } from '@lumacast/composition';
import { readMediaFit } from '@lumacast/composition';
import { FieldInput } from '@renderer/components/form/field';
import { EmptyState, Label, Select, Checkbox } from '@lumacast/ui';
import { Section } from './inspector-section';
import { useElements } from '../../contexts/canvas/canvas-context';
import { parseNumber } from '../../utils/slides';

function clampPlaybackRate(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0.1, value));
}

export function VideoElementInspector() {
  const { selectedElement, elementPayloadDraft, setElementPayloadDraft } = useElements();
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const draft = selectedElement?.type === 'video'
    ? elementPayloadDraft as VideoElementPayload | null
    : null;

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !draft?.src) return;
    if (preview.dataset.src !== draft.src) {
      preview.src = draft.src;
      preview.dataset.src = draft.src;
      preview.load();
    }
  }, [draft?.src]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !draft) return;
    preview.loop = draft.loop ?? false;
    preview.muted = draft.muted ?? false;
    preview.playbackRate = draft.playbackRate ?? 1;
  }, [draft]);

  if (!draft) {
    return <EmptyState.Root><EmptyState.Title>Select a video element to edit playback settings.</EmptyState.Title></EmptyState.Root>;
  }

  const payload = draft;
  const fit = readMediaFit('video', payload);

  function updatePayload(patch: Partial<VideoElementPayload>) {
    setElementPayloadDraft((current) => ({ ...(current as VideoElementPayload), ...patch }));
  }

  return (
    <div>
      <Section.Root>
        <Section.Header>
          <Label.xs>Playback</Label.xs>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <Checkbox
              checked={payload.autoplay ?? false}
              label="Autoplay"
              onCheckedChange={(checked) => updatePayload({ autoplay: checked })}
            />
            <Checkbox
              checked={payload.loop ?? false}
              label="Loop"
              onCheckedChange={(checked) => updatePayload({ loop: checked })}
            />
          </Section.Row>
          <Section.Row>
            <Checkbox
              checked={payload.muted ?? false}
              label="Mute"
              onCheckedChange={(checked) => updatePayload({ muted: checked })}
            />
            <FieldInput
              label="Speed"
              type="number"
              min={0.1}
              max={4}
              step={0.1}
              value={payload.playbackRate ?? 1}
              onChange={(value) => updatePayload({ playbackRate: clampPlaybackRate(parseNumber(value, payload.playbackRate ?? 1)) })}
            />
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Display</Label.xs>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <Select value={fit} onValueChange={(value) => updatePayload({ fit: value as SlideBackgroundFit })} options={[{ value: 'cover' satisfies SlideBackgroundFit, label: 'Cover' }, { value: 'contain' satisfies SlideBackgroundFit, label: 'Contain' }, { value: 'fill' satisfies SlideBackgroundFit, label: 'Fill / Stretch' }]} className="w-full" />
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Preview</Label.xs>
        </Section.Header>
        <Section.Body>
          <div className="overflow-hidden rounded-control border border-primary bg-black">
            <video
              ref={previewRef}
              src={payload.src}
              controls
              playsInline
              preload="metadata"
              muted={payload.muted ?? false}
              loop={payload.loop ?? false}
              className="block aspect-video w-full object-contain"
              onLoadedData={(event) => {
                event.currentTarget.playbackRate = payload.playbackRate ?? 1;
              }}
            />
          </div>
        </Section.Body>
      </Section.Root>
    </div>
  );
}
