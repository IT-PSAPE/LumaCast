import { Histogram } from "./Histogram";
import type { HistogramData, PixelReadout } from "./histogram-data";
import { useRef } from "react";
import { Slider } from "@base-ui/react/slider";
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
import { Btn } from "./ui";
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
      <div className="inspector-tabs" role="tablist" aria-label="Photo tools">
        {["Adjustments", "Composition", "Info"].map((name) => (
          <button
            key={name}
            role="tab"
            id={`tab-${name}`}
            aria-controls="inspector-content"
            tabIndex={tab === name ? 0 : -1}
            onKeyDown={(e) => {
              const names = ["Adjustments", "Composition", "Info"];
              const direction =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (direction) {
                e.preventDefault();
                const next = names[(names.indexOf(name) + direction + 3) % 3];
                onTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            aria-selected={tab === name}
            onClick={() => onTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        className="adjustments-scroll"
        id="inspector-content"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
      >
        {!photo && (
          <p className="muted panel-help">
            Select a photo to adjust light, color, and composition.
          </p>
        )}
        <fieldset disabled={!photo || busy}>
          {tab === "Composition" && (
            <details open aria-label="Composition">
              <summary>Composition</summary>
              <div className="tool-row">
                <Btn
                  aria-label="Rotate left"
                  title="Rotate left"
                  onClick={() =>
                    onCommit({ rotation: ((recipe?.rotation ?? 0) + 3) % 4 })
                  }
                >
                  <RotateCcw size={16} />
                </Btn>
                <Btn
                  aria-label="Rotate right"
                  title="Rotate right"
                  onClick={() =>
                    onCommit({ rotation: ((recipe?.rotation ?? 0) + 1) % 4 })
                  }
                >
                  <RotateCw size={16} />
                </Btn>
                <Btn
                  aria-label="Flip horizontal"
                  title="Flip horizontal"
                  onClick={() => onCommit({ flipX: !recipe?.flipX })}
                >
                  <FlipHorizontal2 size={16} />
                </Btn>
                <Btn
                  aria-label="Flip vertical"
                  title="Flip vertical"
                  onClick={() => onCommit({ flipY: !recipe?.flipY })}
                >
                  <FlipVertical2 size={16} />
                </Btn>
              </div>
              <Slider.Root
                className="adjustment"
                min={-45}
                max={45}
                step={0.1}
                value={recipe?.straighten ?? 0}
                onValueChange={(v) => change("straighten", Number(v))}
                onValueCommitted={(v) => commit("straighten", Number(v))}
              >
                <div className="slider-label">
                  <Slider.Label>Straighten</Slider.Label>
                  <span>{(recipe?.straighten ?? 0).toFixed(1)}°</span>
                </div>
                <Slider.Control className="slider-control">
                  <Slider.Track className="slider-track">
                    <Slider.Indicator className="slider-indicator" />
                    <Slider.Thumb
                      className="slider-thumb"
                      aria-label="Straighten"
                    />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
              <label className="number-row">
                Crop ratio
                <select
                  aria-label="Crop aspect ratio"
                  value={aspect}
                  onChange={(e) => onAspect(e.target.value)}
                >
                  <option value="free">Free</option>
                  <option value="original">Original</option>
                  <option value="1">1:1</option>
                  <option value="1.5">3:2</option>
                  <option value="1.333333333">4:3</option>
                  <option value="1.777777778">16:9</option>
                  <option value="0.8">4:5</option>
                </select>
              </label>
              <label className="crop-lock">
                <input
                  type="checkbox"
                  checked={locked}
                  onChange={(e) => onLocked(e.target.checked)}
                />
                Lock aspect ratio
              </label>
              <p className="panel-help muted">
                Drag crop edges or corners. Rotation keeps the frame inside your
                photo.
              </p>
              <Btn
                className="wide"
                disabled={!recipe?.crop}
                onClick={() => onCommit({ crop: null })}
              >
                Reset crop
              </Btn>
            </details>
          )}
          {/* A `<details>` is a `group` in the accessibility tree but takes no
              name from its summary, so each disclosure is labelled with the
              text its summary already shows. */}
          {(tab === "Composition"
            ? ["Lens correction"]
            : tab === "Adjustments"
              ? ["Light", "Color", "Detail"]
              : []
          ).map((group) => (
            <details
              open={group !== "Detail"}
              key={group}
              aria-label={group === "Detail" ? "Details" : group}
            >
              <summary>
                {group === "Detail" ? "Details" : group}
                {(group === "Light" || group === "Lens correction") && (
                  <button
                    className="section-auto"
                    aria-label={
                      group === "Light" ? "Auto light" : "Auto lens correction"
                    }
                    disabled={!photo || busy || photo.missing}
                    title={
                      group === "Light" ? "Auto light" : "Auto lens correction"
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onAction(
                        group === "Light"
                          ? "auto_adjust"
                          : "auto_lens_correction",
                      );
                    }}
                  >
                    Auto
                  </button>
                )}
              </summary>
              {group === "Lens correction" &&
                (recipe?.lensProfile ? (
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
                ))}
              {group === "Lens correction" && recipe?.lensProfile && (
                <Btn
                  className="lens-remove"
                  disabled={!photo || busy}
                  onClick={() => onCommit({ lensProfile: null })}
                >
                  Remove profile
                </Btn>
              )}
              {group === "Detail" && (
                <p className="muted panel-help">
                  Noise reduction preserves edges. Use 1:1 to judge fine detail.
                </p>
              )}
              {adjustmentControls
                .filter((c) => c[5] === group)
                .map(([key, label, min, max, step]) => (
                  <Slider.Root
                    key={key}
                    className="adjustment"
                    disabled={!photo || busy}
                    min={min}
                    max={max}
                    step={step}
                    value={recipe?.[key] ?? 0}
                    onValueChange={(value) => change(key, Number(value))}
                    onValueCommitted={(value) => commit(key, Number(value))}
                  >
                    <div className="slider-label">
                      <Slider.Label>{label}</Slider.Label>
                      <button
                        className="value-reset"
                        title={`Reset ${label}`}
                        onClick={() => onCommit({ [key]: 0 })}
                        disabled={!photo || busy}
                      >
                        {(recipe?.[key] ?? 0) > 0 ? "+" : ""}
                        {key === "exposure"
                          ? (recipe?.[key] ?? 0).toFixed(2)
                          : (recipe?.[key] ?? 0)}
                      </button>
                    </div>
                    <Slider.Control className="slider-control">
                      <Slider.Track className="slider-track">
                        <Slider.Indicator className="slider-indicator" />
                        <Slider.Thumb
                          className="slider-thumb"
                          aria-label={label}
                        />
                      </Slider.Track>
                    </Slider.Control>
                  </Slider.Root>
                ))}
            </details>
          ))}
        </fieldset>
        {photo && tab === "Info" && (
          <details open aria-label="File information">
            <summary>File information</summary>
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
            <Btn className="wide" onClick={() => onAction("relink")}>
              Relink original file
            </Btn>
          </details>
        )}
      </div>
      <div className="adjustments-footer">
        <Btn
          aria-label="Copy"
          title="Copy adjustments"
          disabled={!photo}
          onClick={() => onAction("copy")}
        >
          <Copy size={14} />
        </Btn>
        <Btn
          aria-label="Paste"
          title="Paste adjustments"
          disabled={!photo || !copied || busy}
          onClick={() => onAction("paste")}
        >
          <ClipboardPaste size={14} />
        </Btn>
        <Btn
          className="wide"
          disabled={!photo || busy}
          onClick={() => onAction("sync")}
        >
          <Layers size={14} />
          Apply to selected
        </Btn>
      </div>
    </aside>
  );
}
