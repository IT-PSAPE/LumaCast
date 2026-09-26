import { useRef, useState } from "react";
import type { Recipe, Photo } from "@lumacast/photo-model";
import type { HistogramData, PixelReadout } from "./histogram-data";
const zones = [
  ["blacks", "Blacks", -100, 100, 1],
  ["shadows", "Shadows", -100, 100, 1],
  ["exposure", "Exposure", -5, 5, 0.05],
  ["highlights", "Highlights", -100, 100, 1],
  ["whites", "Whites", -100, 100, 1],
] as const;
function color(mask: number) {
  return mask
    ? `rgb(${mask & 1 ? 210 : 0},${mask & 2 ? 210 : 0},${mask & 4 ? 210 : 0})`
    : "#505154";
}
export function Histogram({
  data,
  sample,
  photo,
  recipe,
  busy,
  onDraft,
  onCommit,
  clipping,
  onClipping,
  onHover,
}: {
  data: HistogramData | null;
  sample: PixelReadout;
  photo?: Photo;
  recipe?: Recipe;
  busy: boolean;
  onDraft: (r: Recipe | null) => void;
  onCommit: (patch: Partial<Recipe>, revision?: number) => void;
  clipping: { shadows: boolean; highlights: boolean };
  onClipping: (kind: "shadows" | "highlights") => void;
  onHover: (kind: "shadows" | "highlights" | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{
    x: number;
    width: number;
    index: number;
    recipe: Recipe;
    revision: number;
    value: number;
  } | null>(null);
  const peak = Math.max(1, ...(data?.channels.flat() ?? []));
  const path = (bins: number[]) =>
    `M0 80 ${bins.map((n, i) => `L${i} ${80 - (78 * n) / peak}`).join(" ")} L255 80 Z`;
  const active = hover === null ? null : zones[hover];
  return (
    <section
      className="histogram-panel"
      aria-label="Histogram"
      title="RGB distribution of the rendered sRGB preview. Left: shadows. Right: highlights."
    >
      <div className="histogram-heading">
        <button
          className="clipping-toggle"
          aria-label="Shadow clipping"
          aria-pressed={clipping.shadows}
          style={{ color: color(data?.shadowChannels ?? 0) }}
          onClick={() => onClipping("shadows")}
          onMouseEnter={() => onHover("shadows")}
          onMouseLeave={() => onHover(null)}
          onBlur={() => onHover(null)}
          title={`${data?.shadows ?? 0} sampled pixels have a channel at 0. Hover to preview; click to keep on.`}
        >
          ▲
        </button>
        <span>Histogram</span>
        <button
          className="clipping-toggle"
          aria-label="Highlight clipping"
          aria-pressed={clipping.highlights}
          style={{ color: color(data?.highlightChannels ?? 0) }}
          onClick={() => onClipping("highlights")}
          onMouseEnter={() => onHover("highlights")}
          onMouseLeave={() => onHover(null)}
          onBlur={() => onHover(null)}
          title={`${data?.highlights ?? 0} sampled pixels have a channel at 255. Hover to preview; click to keep on.`}
        >
          ▲
        </button>
      </div>
      <div
        className="histogram-plot"
        onPointerLeave={() => {
          if (!drag.current) setHover(null);
        }}
      >
        <svg
          viewBox="0 0 255 80"
          preserveAspectRatio="none"
          role="img"
          aria-label="Red, green, and blue tonal distribution"
        >
          {[51, 102, 153, 204].map((x) => (
            <line
              key={x}
              x1={x}
              x2={x}
              y1="0"
              y2="80"
              stroke="#333538"
              strokeWidth=".5"
            />
          ))}
          {data?.channels.map((bins, i) => (
            <path
              key={i}
              data-channel={["red", "green", "blue"][i]}
              d={path(bins)}
              fill={["#d04040", "#40c050", "#4075d8"][i]}
              style={{ mixBlendMode: "screen" }}
              fillOpacity=".72"
            />
          ))}
        </svg>
        {!data && (
          <span className="histogram-empty">
            {photo?.missing
              ? "Original missing"
              : photo
                ? "Waiting for preview…"
                : "No photo"}
          </span>
        )}
        {zones.map(([key, label, min, max, step], index) => (
          <button
            key={key}
            role="slider"
            aria-label={`Histogram ${label}`}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={recipe?.[key] ?? 0}
            disabled={!photo || !recipe || busy || !data}
            className={`histogram-zone ${hover === index ? "hovered" : ""}`}
            style={{ left: `${index * 20}%` }}
            title={`Drag to adjust ${label}; double-click to reset`}
            onPointerEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onBlur={() => {
              if (!drag.current) setHover(null);
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || !photo || !recipe) return;
              e.preventDefault();
              e.currentTarget.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = {
                x: e.clientX,
                width: e.currentTarget.parentElement!.clientWidth,
                index,
                recipe: { ...recipe },
                revision: photo.revision,
                value: recipe[key],
              };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.index !== index) return;
              const value = Math.max(
                min,
                Math.min(
                  max,
                  Math.round(
                    (d.recipe[key] +
                      ((e.clientX - d.x) / d.width) * (max - min)) /
                      step,
                  ) * step,
                ),
              );
              d.value = Number(value.toFixed(2));
              onDraft({ ...d.recipe, [key]: d.value });
            }}
            onPointerUp={() => {
              const d = drag.current;
              if (!d || d.index !== index) return;
              drag.current = null;
              if (d.value !== d.recipe[key])
                onCommit({ [key]: d.value }, d.revision);
              else onDraft(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              onDraft(null);
            }}
            onDoubleClick={() => onCommit({ [key]: 0 })}
            onKeyDown={(e) => {
              if (!recipe) return;
              const direction = ["ArrowRight", "ArrowUp"].includes(e.key)
                ? 1
                : ["ArrowLeft", "ArrowDown"].includes(e.key)
                  ? -1
                  : 0;
              if (direction) {
                e.preventDefault();
                onCommit({
                  [key]: Number(
                    Math.max(
                      min,
                      Math.min(
                        max,
                        recipe[key] + direction * step * (e.shiftKey ? 10 : 1),
                      ),
                    ).toFixed(2),
                  ),
                });
              }
            }}
          />
        ))}
      </div>
      <div className="histogram-readout" aria-live="off">
        {active ? (
          <>
            <span>{active[1]}</span>
            <span>
              {(recipe?.[active[0]] ?? 0).toFixed(
                active[0] === "exposure" ? 2 : 0,
              )}
            </span>
          </>
        ) : sample ? (
          <span className="rgb-readout">
            {["R", "G", "B"].map((c, i) => (
              <span key={c}>
                {c} {((sample[i] / 255) * 100).toFixed(1)}%
              </span>
            ))}
          </span>
        ) : (
          <>
            <span>Shadows</span>
            <span>Highlights</span>
          </>
        )}
      </div>
    </section>
  );
}
