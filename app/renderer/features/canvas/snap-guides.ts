import type { GuideLine } from '@lumacast/composition';

export interface SnapBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformSnapResult {
  guides: GuideLine[];
  height: number;
  width: number;
  x: number;
  y: number;
}

interface AxisSnap {
  delta: number;
  line: GuideLine | null;
}

const SNAP_THRESHOLD = 8;

function edgePoints(box: SnapBox) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return {
    x: [box.x, centerX, box.x + box.width],
    y: [box.y, centerY, box.y + box.height],
  };
}

function bestAxisDelta(current: number[], targets: number[], makeLine: (value: number) => GuideLine): AxisSnap {
  let bestDelta = 0;
  let bestAbsDelta = SNAP_THRESHOLD + 1;
  let bestLine: GuideLine | null = null;

  for (const source of current) {
    for (const target of targets) {
      const delta = target - source;
      const absDelta = Math.abs(delta);
      if (absDelta < bestAbsDelta && absDelta <= SNAP_THRESHOLD) {
        bestDelta = delta;
        bestAbsDelta = absDelta;
        bestLine = makeLine(target);
      }
    }
  }

  return { delta: bestDelta, line: bestLine };
}

function axisTargets(others: SnapBox[], axis: 'x' | 'y', stageSize: number): number[] {
  const targets = [0, stageSize / 2, stageSize];

  for (const candidate of others) {
    const points = edgePoints(candidate);
    targets.push(...points[axis]);
  }

  return targets;
}

function anchorTouchesEdge(anchor: string, edge: 'left' | 'right' | 'top' | 'bottom'): boolean {
  if (edge === 'left') return anchor.includes('left');
  if (edge === 'right') return anchor.includes('right');
  if (edge === 'top') return anchor.includes('top');
  return anchor.includes('bottom');
}

export function resolveSnap(box: SnapBox, others: SnapBox[], stageWidth: number, stageHeight: number): { x: number; y: number; guides: GuideLine[] } {
  const current = edgePoints(box);
  const targetX = axisTargets(others, 'x', stageWidth);
  const targetY = axisTargets(others, 'y', stageHeight);

  const xSnap = bestAxisDelta(current.x, targetX, (value) => ({ points: [value, 0, value, stageHeight], orientation: 'vertical' }));
  const ySnap = bestAxisDelta(current.y, targetY, (value) => ({ points: [0, value, stageWidth, value], orientation: 'horizontal' }));

  const guides: GuideLine[] = [];
  if (xSnap.line) guides.push(xSnap.line);
  if (ySnap.line) guides.push(ySnap.line);

  return { x: box.x + xSnap.delta, y: box.y + ySnap.delta, guides };
}

export function resolveTransformSnap(box: SnapBox, others: SnapBox[], stageWidth: number, stageHeight: number, anchor: string | null): TransformSnapResult {
  if (!anchor || anchor === 'rotater') {
    return { x: box.x, y: box.y, width: box.width, height: box.height, guides: [] };
  }

  let x = box.x;
  let y = box.y;
  let width = box.width;
  let height = box.height;
  const guides: GuideLine[] = [];
  const targetX = axisTargets(others, 'x', stageWidth);
  const targetY = axisTargets(others, 'y', stageHeight);

  if (anchorTouchesEdge(anchor, 'left')) {
    const right = box.x + box.width;
    const leftSnap = bestAxisDelta([box.x], targetX, (value) => ({ points: [value, 0, value, stageHeight], orientation: 'vertical' }));
    x = box.x + leftSnap.delta;
    width = Math.max(1, right - x);
    if (leftSnap.line) guides.push(leftSnap.line);
  } else if (anchorTouchesEdge(anchor, 'right')) {
    const rightSnap = bestAxisDelta([box.x + box.width], targetX, (value) => ({ points: [value, 0, value, stageHeight], orientation: 'vertical' }));
    width = Math.max(1, box.width + rightSnap.delta);
    if (rightSnap.line) guides.push(rightSnap.line);
  }

  if (anchorTouchesEdge(anchor, 'top')) {
    const bottom = box.y + box.height;
    const topSnap = bestAxisDelta([box.y], targetY, (value) => ({ points: [0, value, stageWidth, value], orientation: 'horizontal' }));
    y = box.y + topSnap.delta;
    height = Math.max(1, bottom - y);
    if (topSnap.line) guides.push(topSnap.line);
  } else if (anchorTouchesEdge(anchor, 'bottom')) {
    const bottomSnap = bestAxisDelta([box.y + box.height], targetY, (value) => ({ points: [0, value, stageWidth, value], orientation: 'horizontal' }));
    height = Math.max(1, box.height + bottomSnap.delta);
    if (bottomSnap.line) guides.push(bottomSnap.line);
  }

  return { x, y, width, height, guides };
}
