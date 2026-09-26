import type { ReactNode } from 'react';
import { SceneFrame } from '../../components/display/scene-frame';
import { NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT } from '@lumacast/protocol';

// Single 16:9 frame used by every surface so grid rows auto-size to identical
// heights and the optional panel label can float on top instead of stealing a
// row above. The label is an explicit slot decision: the caller supplies it
// only when the mode needs one (all-mode grid); in single mode the header
// dropdown already names the surface, so no label is composed and the badge is
// absent.
export function SurfaceFrame({ label, checkerboard = false, children }: { label?: ReactNode; checkerboard?: boolean; children: ReactNode }) {
  return (
    <div className="relative max-h-full max-w-full w-full">
      <SceneFrame
        width={NDI_OUTPUT_WIDTH}
        height={NDI_OUTPUT_HEIGHT}
        className="max-h-full max-w-full bg-black"
        checkerboard={checkerboard}
      >
        {children}
      </SceneFrame>
      {label ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
          {label}
        </span>
      ) : null}
    </div>
  );
}
