import { Histogram } from "./Histogram";
import type { HistogramData, PixelReadout } from "./histogram-data";
import { useRef } from "react";
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
  type Photo,
  type Recipe,
} from "@lumacast/photo-model";
import {
  Accordion,
  Checkbox,
  ReacstButton,
  Select,
  Slider,
  Tabs,
} from "@lumacast/ui";
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
}: {
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
  onDraft: (r: Recipe | null) => void;
  onCommit: (patch: Partial<Recipe>, revision?: number) => void;
  onAction: (name: string) => void;
  copied: boolean;
  busy: boolean;
}) {
  const off = !photo || busy;
  const gesture = useRef<{ revision: number; recipe: Recipe } | null>(null);
  function change(key: keyof Recipe, value: number) {
    if (!photo || !recipe) return;
    if (!gesture.current)
      gesture.current = { revision: photo.revision, recipe: { ...recipe } };
    gesture.current.recipe = { ...gesture.current.recipe, [key]: value };
    onDraft(gesture.current.recipe);
  }
  function commit(key: keyof Recipe, value: number) {
    if (!photo) return;
    const revision = gesture.current?.revision ?? photo.revision;
    gesture.current = null;
    onCommit({ [key]: value }, revision);
  }
  const groups =
    tab === "Composition"
      ? ["Lens correction"]
      : tab === "Adjustments"
        ? ["Light", "Color", "Detail"]
        : [];
  return (
    <aside className="adjustments panel">
      <Histogram
        data={histogramData}
        sample={pixelSample}
        photo={photo}
        recipe={recipe}
        busy={busy}
        onDraft={onDraft}
        onCommit={onCommit}
        clipping={clipping}
        onClipping={onClipping}
        onHover={onClipHover}
      />
      <Tabs value={tab} onValueChange={onTab} className="min-h-0 flex-1">
        <Tabs.List className="flex-none">
          {["Adjustments", "Composition", "Info"].map((name) => (
            <Tabs.Tab key={name} value={name} className="min-h-9 flex-1">
              {name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value={tab} className="overflow-auto">
          {!photo && (
            <p className="muted small p-3">
              Select a photo to adjust light, color, and composition.
            </p>
          )}
          <Accordion
            key={tab}
            variant="bordered"
            size="sm"
            defaultValue={
              tab === "Composition"
                ? ["Composition", "Lens correction"]
                : tab === "Adjustments"
                  ? ["Light", "Color"]
                  : ["File information"]
            }
          >
            {tab === "Composition" && (
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
                        onCommit({
                          rotation: ((recipe?.rotation ?? 0) + 3) % 4,
                        })
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
                        onCommit({
                          rotation: ((recipe?.rotation ?? 0) + 1) % 4,
                        })
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
                      formatValue={(v) => `${v.toFixed(1)}°`}
                      min={-45}
                      max={45}
                      step={0.1}
                      disabled={off}
                      value={recipe?.straighten ?? 0}
                      onValueChange={(v) => change("straighten", v)}
                      onCommit={(v) => commit("straighten", v)}
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
                    Drag crop edges or corners. Rotation keeps the frame inside
                    your photo.
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
            )}
            {groups.map((group) => {
              const title = group === "Detail" ? "Details" : group;
              const autoLabel =
                group === "Light" ? "Auto light" : "Auto lens correction";
              return (
                <Accordion.Item key={group} value={group}>
                  <Accordion.Header
                    actions={
                      group === "Light" || group === "Lens correction" ? (
                        <ReacstButton
                          size="xs"
                          variant="outline"
                          aria-label={autoLabel}
                          title={autoLabel}
                          disabled={off || photo?.missing}
                          onClick={() =>
                            onAction(
                              group === "Light"
                                ? "auto_adjust"
                                : "auto_lens_correction",
                            )
                          }
                        >
                          Auto
                        </ReacstButton>
                      ) : undefined
                    }
                  >
                    {title}
                  </Accordion.Header>
                  <Accordion.Panel>
                    {group === "Lens correction" &&
                      (recipe?.lensProfile ? (
                        <dl className="lens-meta">
                          <dt>Profile</dt>
                          <dd>{recipe.lensProfile.name}</dd>
                          <dt>Focal length</dt>
                          <dd>
                            {Number(recipe.lensProfile.focal.toFixed(1))} mm
                          </dd>
                          <dt>Source</dt>
                          <dd>{recipe.lensProfile.source}</dd>
                        </dl>
                      ) : (
                        <p className="lens-meta-empty muted">
                          No matched profile
                        </p>
                      ))}
                    {group === "Lens correction" && recipe?.lensProfile && (
                      <ReacstButton
                        size="sm"
                        className="mb-2 ml-auto flex w-fit"
                        disabled={off}
                        onClick={() => onCommit({ lensProfile: null })}
                      >
                        Remove profile
                      </ReacstButton>
                    )}
                    {group === "Detail" && (
                      <p className="muted panel-help">
                        Noise reduction preserves edges. Use 1:1 to judge fine
                        detail.
                      </p>
                    )}
                    {adjustmentControls
                      .filter((c) => c[5] === group)
                      .map(([key, label, min, max, step]) => (
                        <div key={key} className="adjustment">
                          <div className="slider-label">
                            <span>{label}</span>
                            <button
                              className="value-reset"
                              title={`Reset ${label}`}
                              onClick={() => onCommit({ [key]: 0 })}
                              disabled={off}
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
                            disabled={off}
                            min={min}
                            max={max}
                            step={step}
                            value={recipe?.[key] ?? 0}
                            onValueChange={(value) => change(key, value)}
                            onCommit={(value) => commit(key, value)}
                          />
                        </div>
                      ))}
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
            {photo && tab === "Info" && (
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
                  <ReacstButton
                    size="sm"
                    fullWidth
                    className="mt-2"
                    onClick={() => onAction("relink")}
                  >
                    Relink original file
                  </ReacstButton>
                </Accordion.Panel>
              </Accordion.Item>
            )}
          </Accordion>
        </Tabs.Panel>
      </Tabs>
      <div className="adjustments-footer">
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
      </div>
    </aside>
  );
}
