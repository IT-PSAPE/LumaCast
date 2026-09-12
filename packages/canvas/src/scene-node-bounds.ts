import type Konva from 'konva';

type ClientRectConfig = Parameters<Konva.Group['getClientRect']>[0];

const FIXED_CLIENT_RECT_BOUND = Symbol('fixed-client-rect-bound');

interface FixedClientRectGroup extends Konva.Group {
  [FIXED_CLIENT_RECT_BOUND]?: true;
}

function fixedClientRect(this: Konva.Group, config: ClientRectConfig = {}) {
  const rect = { x: 0, y: 0, width: this.width(), height: this.height() };
  if (config.skipTransform) return rect;
  return this._transformedRect(rect, config.relativeTo ?? null);
}

export function bindFixedClientRect(node: Konva.Group): void {
  const fixedNode = node as FixedClientRectGroup;
  if (fixedNode[FIXED_CLIENT_RECT_BOUND]) return;
  fixedNode.getClientRect = fixedClientRect;
  fixedNode[FIXED_CLIENT_RECT_BOUND] = true;
}
