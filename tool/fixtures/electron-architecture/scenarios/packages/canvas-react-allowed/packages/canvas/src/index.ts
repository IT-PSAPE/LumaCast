// Permitted: @lumacast/canvas is the one package allowed to import
// react/react-dom/konva/react-konva (issue #219, W9 purity exemption).
import { useState } from 'react';

export function useCanvasThing(): unknown {
  return useState;
}
