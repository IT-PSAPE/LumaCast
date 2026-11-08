import { Histogram } from "./Histogram";
import type { HistogramData, PixelReadout } from "./histogram-data";
import { useCallback, useEffect, useRef } from "react";
import {
  RotateCcw,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Copy,
  ClipboardPaste,
  Layers,
} from "lucide-react";
import {
  adjustmentControls,
  type AdjustmentKey,
  type Photo,
  type Recipe,
} from "@lumacast/photo-model";
import {
  Accordion,
  Checkbox,
  Panel,
  ReacstButton,
  Select,
  Slider,
  Tabs,
} from "@lumacast/ui";

interface AdjustmentsProps {
  histogramData: HistogramData | null;
  pixelSample: PixelReadout;
  clipping: { shadows: boolean; highlights: boolean };
  onClipping: (kind: "shadows" | "highlights") => void;
  onClipHover: (kind: "shadows" | "highlights" | null) => void;
  tab: string;
  onTab: (tab: string) => void;
  aspect: string;
  onAspect: (value: string) => void;
  locked: boolean;
  onLocked: (value: boolean) => void;
  photo?: Photo;
  recipe?: Recipe;
  onDraft: (r: Recipe | null, photoId?: string, revision?: number) => void;
  onCommit: (
    patch: Partial<Recipe>,
    revision?: number,
    photoId?: string,
  ) => void;
  onAction: (name: string) => void;
  copied: boolean;
  busy: boolean;
}

type NumericAdjustmentKey = AdjustmentKey | "straighten";

interface RecipeControls {
  recipe?: Recipe;
  disabled: boolean;
  readOnly: boolean;
  interactionKey?: string;
  onCancel: () => void;
  onChange: (key: NumericAdjustmentKey, value: number) => void;
  onCommitValue: (key: NumericAdjustmentKey, value: number) => void;
  onCommit: AdjustmentsProps["onCommit"];
}

interface ToolPanelProps {
  photo?: Photo;
  controls: RecipeControls;
  onAction: AdjustmentsProps["onAction"];
}

export function Adjustments({
  histogramData,
  pixelSample,
  clipping,
  onClipping,
  onClipHover,
  photo,
  recipe,
  onDraft,
  onCommit,
  onAction,
  copied,
  busy,
  tab,
  onTab,
  aspect,
  onAspect,
  locked,
  onLocked,
}: AdjustmentsProps) {
  const off = !photo || busy;
  const gesture = useRef<{
    photoId: string;
    revision: number;
    recipe: Recipe;
  } | null>(null);
  const cancelGesture = useCallback(() => {
    const activeGesture = gesture.current;
    if (!activeGesture) return;
    gesture.current = null;
    onDraft(null, activeGesture.photoId, activeGesture.revision);
  }, [onDraft]);
  useEffect(() => {
    const activeGesture = gesture.current;
    if (activeGesture && (busy || activeGesture.photoId !== photo?.id
      || activeGesture.revision !== photo?.revision)) cancelGesture();
  }, [busy, photo?.id, photo?.revision, cancelGesture]);
  function change(key: NumericAdjustmentKey, value: number) {
    if (!photo || !recipe || busy) return;
    if (gesture.current && gesture.current.photoId !== photo.id) return;
    if (!gesture.current) {
      gesture.current = {
        photoId: photo.id,
        revision: photo.revision,
        recipe: { ...recipe },
      };
    }
    gesture.current.recipe = { ...gesture.current.recipe, [key]: value };
    onDraft(
      gesture.current.recipe,
      gesture.current.photoId,
      gesture.current.revision,
    );
  }
  function commit(key: NumericAdjustmentKey, value: number) {
    if (!photo) return;
    const activeGesture = gesture.current;
    gesture.current = null;
    if (activeGesture && (activeGesture.photoId !== photo.id || busy)) {
      onDraft(null, activeGesture.photoId, activeGesture.revision);
      return;
    }
    if (busy || !recipe) return;
    onCommit(
      { [key]: value },
      activeGesture?.revision ?? photo.revision,
      activeGesture?.photoId ?? photo.id,
    );
  }
  const controls: RecipeControls = {
    recipe,
    disabled: !photo || !recipe,
    readOnly: busy,
    interactionKey: photo ? `${photo.id}:${photo.revision}` : undefined,
    onCancel: cancelGesture,
    onChange: change,
    onCommitValue: commit,
    onCommit,
  };
  return (
    <Panel className="border-l border-primary bg-secondary">
      <Histogram
        data={histogramData}
        sample={pixelSample}
        photo={photo}
        recipe={recipe}
        busy={busy}
        onDraft={(next, photoId, revision) =>
          onDraft(next, photoId ?? photo?.id, revision ?? photo?.revision)
        }
        onCommit={onCommit}
        clipping={clipping}
        onClipping={onClipping}
        onHover={onClipHover}
      />
      <Tabs value={tab} onValueChange={onTab} className="min-h-0 flex-1">
        <Tabs.List aria-label="Photo tools" className="flex-none">
          <Tabs.Tab value="Adjustments" className="min-h-9 flex-1">
            Adjustments
          </Tabs.Tab>
          <Tabs.Tab value="Composition" className="min-h-9 flex-1">
            Composition
          </Tabs.Tab>
          <Tabs.Tab value="Info" className="min-h-9 flex-1">
            Info
          </Tabs.Tab>
        </Tabs.List>
        <AdjustmentsPanel photo={photo} controls={controls} onAction={onAction} />
        <CompositionPanel
          photo={photo}
          controls={controls}
          onAction={onAction}
          aspect={aspect}
          onAspect={onAspect}
          locked={locked}
          onLocked={onLocked}
        />
        <InfoPanel photo={photo} onAction={onAction} />
      </Tabs>
      <Panel.Footer className="gap-1 py-2">
        <ReacstButton.Icon
          size="sm"
          aria-label="Copy"
          title="Copy adjustments"
          className="shrink-0"
          disabled={!photo}
          onClick={() => onAction("copy")}
        >
          <Copy size={14} />
        </ReacstButton.Icon>
        <ReacstButton.Icon
          size="sm"
          aria-label="Paste"
          title="Paste adjustments"
          className="shrink-0"
          disabled={!photo || !copied || busy}
          onClick={() => onAction("paste")}
        >
          <ClipboardPaste size={14} />
        </ReacstButton.Icon>
        <ReacstButton
          size="sm"
          className="flex-1"
          disabled={off}
          onClick={() => onAction("sync")}
        >
          <Layers size={13} />
          Apply to selected
        </ReacstButton>
      </Panel.Footer>
    </Panel>
  );
}

function PhotoSelectionHint({ photo }: Pick<AdjustmentsProps, "photo">) {
  return !photo ? (
    <p className="muted small p-3">
      Select a photo to adjust light, color, and composition.
    </p>
  ) : null;
}

function AdjustmentsPanel({ photo, controls, onAction }: ToolPanelProps) {
  return (
    <Tabs.Panel value="Adjustments" className="overflow-auto">
      <PhotoSelectionHint photo={photo} />
      <Accordion variant="bordered" size="sm" defaultValue={["Light", "Color"]}>
        <LightSection photo={photo} controls={controls} onAction={onAction} />
        <ColorSection controls={controls} />
        <DetailSection controls={controls} />
      </Accordion>
    </Tabs.Panel>
  );
}

function LightSection({ photo, controls, onAction }: ToolPanelProps) {
  return (
    <Accordion.Item value="Light">
      <Accordion.Header
        actions={
          <ReacstButton
            size="xs"
            variant="outline"
            aria-label="Auto light"
            title="Auto light"
            disabled={controls.disabled || controls.readOnly || photo?.missing}
            onClick={() => onAction("auto_adjust")}
          >
            Auto
          </ReacstButton>
        }
      >
        Light
      </Accordion.Header>
      <Accordion.Panel>
        <AdjustmentControls group="Light" controls={controls} />
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function ColorSection({ controls }: Pick<ToolPanelProps, "controls">) {
  return (
    <Accordion.Item value="Color">
      <Accordion.Header>Color</Accordion.Header>
      <Accordion.Panel>
        <AdjustmentControls group="Color" controls={controls} />
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function DetailSection({ controls }: Pick<ToolPanelProps, "controls">) {
  return (
    <Accordion.Item value="Detail">
      <Accordion.Header>Details</Accordion.Header>
      <Accordion.Panel>
        <p className="muted panel-help">
          Noise reduction preserves edges. Use 1:1 to judge fine detail.
        </p>
        <AdjustmentControls group="Detail" controls={controls} />
      </Accordion.Panel>
    </Accordion.Item>
  );
}

type CompositionPanelProps = ToolPanelProps &
  Pick<AdjustmentsProps, "aspect" | "onAspect" | "locked" | "onLocked">;

function CompositionPanel({
  photo,
  controls,
  onAction,
  aspect,
  onAspect,
  locked,
  onLocked,
}: CompositionPanelProps) {
  return (
    <Tabs.Panel value="Composition" className="overflow-auto">
      <PhotoSelectionHint photo={photo} />
      <Accordion
        variant="bordered"
        size="sm"
        defaultValue={["Composition", "Lens correction"]}
      >
        <CropCompositionSection
          controls={controls}
          aspect={aspect}
          onAspect={onAspect}
          locked={locked}
          onLocked={onLocked}
        />
        <LensCorrectionSection photo={photo} controls={controls} onAction={onAction} />
      </Accordion>
    </Tabs.Panel>
  );
}

function CropCompositionSection({
  controls,
  aspect,
  onAspect,
  locked,
  onLocked,
}: Omit<CompositionPanelProps, "photo" | "onAction">) {
  const { recipe, disabled, readOnly, interactionKey, onCancel, onChange, onCommitValue, onCommit } = controls;
  const off = disabled || readOnly;
  return (
    <Accordion.Item value="Composition">
      <Accordion.Header>Composition</Accordion.Header>
      <Accordion.Panel>
        <div className="flex gap-1.5 pb-2.5">
          <ReacstButton.Icon
            size="sm"
            aria-label="Rotate left"
            title="Rotate left"
            disabled={off}
            onClick={() =>
              onCommit({ rotation: ((recipe?.rotation ?? 0) + 3) % 4 })
            }
          >
            <RotateCcw size={16} />
          </ReacstButton.Icon>
          <ReacstButton.Icon
            size="sm"
            aria-label="Rotate right"
            title="Rotate right"
            disabled={off}
            onClick={() =>
              onCommit({ rotation: ((recipe?.rotation ?? 0) + 1) % 4 })
            }
          >
            <RotateCw size={16} />
          </ReacstButton.Icon>
          <ReacstButton.Icon
            size="sm"
            aria-label="Flip horizontal"
            title="Flip horizontal"
            disabled={off}
            onClick={() => onCommit({ flipX: !recipe?.flipX })}
          >
            <FlipHorizontal2 size={16} />
          </ReacstButton.Icon>
          <ReacstButton.Icon
            size="sm"
            aria-label="Flip vertical"
            title="Flip vertical"
            disabled={off}
            onClick={() => onCommit({ flipY: !recipe?.flipY })}
          >
            <FlipVertical2 size={16} />
          </ReacstButton.Icon>
        </div>
        <div className="adjustment">
          <Slider
            size="sm"
            label="Straighten"
            showValue
            formatValue={(value) => `${value.toFixed(1)}°`}
            min={-45}
            max={45}
            step={0.1}
            disabled={disabled}
            readOnly={readOnly}
            interactionKey={interactionKey}
            onCancel={onCancel}
            value={recipe?.straighten ?? 0}
            onValueChange={(value) => onChange("straighten", value)}
            onCommit={(value) => onCommitValue("straighten", value)}
          />
        </div>
        <Select
          size="sm"
          className="mb-2.5"
          label="Crop ratio"
          labelPlacement="inline"
          disabled={off}
          value={aspect}
          onValueChange={onAspect}
          options={[
            { value: "free", label: "Free" },
            { value: "original", label: "Original" },
            { value: "1", label: "1:1" },
            { value: "1.5", label: "3:2" },
            { value: "1.333333333", label: "4:3" },
            { value: "1.777777778", label: "16:9" },
            { value: "0.8", label: "4:5" },
          ]}
        />
        <Checkbox
          className="my-2.5"
          label="Lock aspect ratio"
          disabled={off}
          checked={locked}
          onCheckedChange={onLocked}
        />
        <p className="panel-help muted">
          Drag crop edges or corners. Rotation keeps the frame inside your photo.
        </p>
        <ReacstButton
          size="sm"
          fullWidth
          disabled={off || !recipe?.crop}
          onClick={() => onCommit({ crop: null })}
        >
          Reset crop
        </ReacstButton>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function LensCorrectionSection({ photo, controls, onAction }: ToolPanelProps) {
  const { recipe, disabled, readOnly, onCommit } = controls;
  return (
    <Accordion.Item value="Lens correction">
      <Accordion.Header
        actions={
          <ReacstButton
            size="xs"
            variant="outline"
            aria-label="Auto lens correction"
            title="Auto lens correction"
            disabled={disabled || readOnly || photo?.missing}
            onClick={() => onAction("auto_lens_correction")}
          >
            Auto
          </ReacstButton>
        }
      >
        Lens correction
      </Accordion.Header>
      <Accordion.Panel>
        {recipe?.lensProfile ? (
          <dl className="lens-meta">
            <dt>Profile</dt>
            <dd>{recipe.lensProfile.name}</dd>
            <dt>Focal length</dt>
            <dd>{Number(recipe.lensProfile.focal.toFixed(1))} mm</dd>
            <dt>Source</dt>
            <dd>{recipe.lensProfile.source}</dd>
          </dl>
        ) : (
          <p className="lens-meta-empty muted">No matched profile</p>
        )}
        {recipe?.lensProfile && (
          <ReacstButton
            size="sm"
            className="mb-2 ml-auto flex w-fit"
            disabled={disabled || readOnly}
            onClick={() => onCommit({ lensProfile: null })}
          >
            Remove profile
          </ReacstButton>
        )}
        <AdjustmentControls group="Lens correction" controls={controls} />
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function AdjustmentControls({
  group,
  controls,
}: {
  group: (typeof adjustmentControls)[number][5];
  controls: RecipeControls;
}) {
  const { recipe, disabled, readOnly, interactionKey, onCancel, onChange, onCommitValue, onCommit } = controls;
  return adjustmentControls
    .filter((control) => control[5] === group)
    .map(([key, label, min, max, step]) => (
      <div key={key} className="adjustment">
        <div className="slider-label">
          <span>{label}</span>
          <button
            className="value-reset"
            title={`Reset ${label}`}
            onClick={() => onCommit({ [key]: 0 })}
            disabled={disabled || readOnly}
          >
            {(recipe?.[key] ?? 0) > 0 ? "+" : ""}
            {key === "exposure"
              ? (recipe?.[key] ?? 0).toFixed(2)
              : (recipe?.[key] ?? 0)}
          </button>
        </div>
        <Slider
          size="sm"
          label={label}
          labelPlacement="hidden"
          disabled={disabled}
          readOnly={readOnly}
          interactionKey={interactionKey}
          onCancel={onCancel}
          min={min}
          max={max}
          step={step}
          value={recipe?.[key] ?? 0}
          onValueChange={(value) => onChange(key, value)}
          onCommit={(value) => onCommitValue(key, value)}
        />
      </div>
    ));
}

function InfoPanel({
  photo,
  onAction,
}: Pick<ToolPanelProps, "photo" | "onAction">) {
  return (
    <Tabs.Panel value="Info" className="overflow-auto">
      <PhotoSelectionHint photo={photo} />
      <Accordion variant="bordered" size="sm" defaultValue={["File information"]}>
        {photo && <FileInformationSection photo={photo} onAction={onAction} />}
      </Accordion>
    </Tabs.Panel>
  );
}

function FileInformationSection({
  photo,
  onAction,
}: {
  photo: Photo;
  onAction: AdjustmentsProps["onAction"];
}) {
  return (
    <Accordion.Item value="File information">
      <Accordion.Header>File information</Accordion.Header>
      <Accordion.Panel>
        <dl className="metadata">
          <dt>Name</dt>
          <dd>{photo.name}</dd>
          <dt>Dimensions</dt>
          <dd>
            {photo.width} × {photo.height}
          </dd>
          <dt>Format</dt>
          <dd>{photo.format.toUpperCase()}</dd>
          <dt>Size</dt>
          <dd>{(photo.size / 1024 / 1024).toFixed(1)} MB</dd>
          <dt>Folder</dt>
          <dd>{photo.folder}</dd>
          {Object.entries(photo.metadata ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ReacstButton size="sm" fullWidth className="mt-2" onClick={() => onAction("relink")}>
          Relink original file
        </ReacstButton>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
