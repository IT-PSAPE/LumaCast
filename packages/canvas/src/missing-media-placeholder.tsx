import { useEffect, useState } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import type { SceneSurface } from '@lumacast/composition';

// The one placeholder every authoring surface paints where media should be but
// its file cannot be read: a muted red field, a warning glyph, and a label.
// Red is the point — a missing source is a fault the operator must see before
// the slide goes live, not a neutral empty state.
//
// Live output surfaces deliberately do not paint it (see
// MISSING_MEDIA_SURFACES): the audience must never be shown our fault report.

// Where a missing source is reported: the editor the operator authors in, the
// monitor they watch, and list thumbnails. `show`, `stage` and the two `ndi-*`
// surfaces are what the audience and performers actually see, and stay empty
// rather than carrying our fault report onto a live output.
export const MISSING_MEDIA_SURFACES: ReadonlySet<SceneSurface> = new Set<SceneSurface>([
  'deck-editor', 'monitor', 'list',
]);

type AppearanceMode = 'light' | 'dark';

interface MissingMediaAppearance {
  field: string;
  hatch: string;
  border: string;
  glyph: string;
  label: string;
}

// Desaturated from the app's red ramp (app/renderer/theme.css): dark enough in
// dark mode and pale enough in light mode to sit under a scene without
// screaming, still unmistakably red at a glance.
const APPEARANCE: Record<AppearanceMode, MissingMediaAppearance> = {
  light: { field: '#F6E2E3', hatch: '#EBC9CB', border: '#DCA2A6', glyph: '#AF2731', label: '#8C2028' },
  dark: { field: '#241417', hatch: '#33191E', border: '#6D2027', glyph: '#EF7B84', label: '#E4939A' },
};

const LABEL_TEXT = 'MISSING MEDIA';
const LABEL_FONT_FAMILY = 'Inter, "Open Sans", -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function readAppearanceMode(): AppearanceMode {
  if (typeof document === 'undefined') return 'dark';
  const attribute = document.documentElement.getAttribute('data-theme');
  if (attribute === 'light' || attribute === 'dark') return attribute;
  // Only reachable before the app applies the resolved theme to the root.
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/**
 * Konva paints concrete colors, so the placeholder resolves the app's light or
 * dark mode itself from `data-theme` on the document root — the single place
 * the app records the resolved theme (`app/renderer/contexts/app-context.tsx`)
 * — rather than threading a palette through every scene surface.
 */
function useMissingMediaAppearance(): MissingMediaAppearance {
  const [mode, setMode] = useState<AppearanceMode>(readAppearanceMode);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setMode(readAppearanceMode()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    setMode(readAppearanceMode());
    return () => observer.disconnect();
  }, []);

  return APPEARANCE[mode];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function MissingMediaPlaceholder({
  width,
  height,
  listening = true,
}: {
  width: number;
  height: number;
  listening?: boolean;
}) {
  const appearance = useMissingMediaAppearance();
  if (!(width > 0) || !(height > 0)) return null;

  const box = Math.min(width, height);
  const borderWidth = clamp(box * 0.008, 1, 3);
  const hatchSpacing = clamp(box * 0.11, 14, 64);
  const hatchWidth = hatchSpacing * 0.17;
  const hatchCount = Math.ceil((width + height) / hatchSpacing);

  // Below roughly a slide-tile-sized box the glyph is noise, so the field and
  // its border carry the signal alone.
  const showGlyph = box >= 40;
  const showLabel = width >= 220 && height >= 132;
  const glyphSize = clamp(box * 0.26, 16, 84);
  const glyphHeight = glyphSize * 0.88;
  const labelSize = clamp(box * 0.075, 11, 24);
  const labelGap = labelSize * 0.75;
  const stackHeight = (showGlyph ? glyphHeight : 0)
    + (showLabel ? labelGap + labelSize * 1.2 : 0);
  const stackTop = (height - stackHeight) / 2;
  const glyphLeft = (width - glyphSize) / 2;
  const glyphStroke = Math.max(1, glyphSize * 0.085);
  const bangTop = stackTop + glyphHeight * 0.34;
  const bangBottom = stackTop + glyphHeight * 0.63;
  const bangDot = stackTop + glyphHeight * 0.78;

  return (
    <Group listening={listening}>
      <Rect x={0} y={0} width={width} height={height} fill={appearance.field} listening={listening} />
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height} listening={false}>
        {Array.from({ length: hatchCount }, (_value, index) => {
          const offset = index * hatchSpacing;
          return (
            <Line
              key={`hatch-${index}`}
              points={[offset, height, offset - height, 0]}
              stroke={appearance.hatch}
              strokeWidth={hatchWidth}
              listening={false}
            />
          );
        })}
      </Group>
      <Rect
        x={borderWidth / 2}
        y={borderWidth / 2}
        width={Math.max(0, width - borderWidth)}
        height={Math.max(0, height - borderWidth)}
        stroke={appearance.border}
        strokeWidth={borderWidth}
        listening={false}
      />
      {showGlyph ? (
        <Group listening={false}>
          <Line
            points={[
              glyphLeft + glyphSize / 2, stackTop,
              glyphLeft + glyphSize, stackTop + glyphHeight,
              glyphLeft, stackTop + glyphHeight,
            ]}
            closed
            stroke={appearance.glyph}
            strokeWidth={glyphStroke}
            lineJoin="round"
            lineCap="round"
            listening={false}
          />
          <Line
            points={[glyphLeft + glyphSize / 2, bangTop, glyphLeft + glyphSize / 2, bangBottom]}
            stroke={appearance.glyph}
            strokeWidth={glyphStroke}
            lineCap="round"
            listening={false}
          />
          {/* The bang's dot: a round-capped stub, because a zero-length
              segment is not reliably painted. */}
          <Line
            points={[glyphLeft + glyphSize / 2, bangDot, glyphLeft + glyphSize / 2, bangDot + glyphStroke * 0.02]}
            stroke={appearance.glyph}
            strokeWidth={glyphStroke * 1.05}
            lineCap="round"
            listening={false}
          />
        </Group>
      ) : null}
      {showLabel ? (
        <Text
          x={0}
          y={stackTop + (showGlyph ? glyphHeight + labelGap : 0)}
          width={width}
          align="center"
          text={LABEL_TEXT}
          fill={appearance.label}
          fontSize={labelSize}
          fontStyle="bold"
          fontFamily={LABEL_FONT_FAMILY}
          letterSpacing={labelSize * 0.12}
          listening={false}
        />
      ) : null}
    </Group>
  );
}
