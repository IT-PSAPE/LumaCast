export type CropBox = { x: number; y: number; width: number; height: number };
export const fullCrop: CropBox = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
export function resizeCrop(
  box: CropBox,
  handle: string,
  dx: number,
  dy: number,
  ratio = 0,
): CropBox {
  if (handle === "move")
    return {
      ...box,
      x: clamp(box.x + dx, 0, 1 - box.width),
      y: clamp(box.y + dy, 0, 1 - box.height),
    };
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  const ax =
    sx === 1 ? box.x : sx === -1 ? box.x + box.width : box.x + box.width / 2;
  const ay =
    sy === 1 ? box.y : sy === -1 ? box.y + box.height : box.y + box.height / 2;
  const maxW = sx === 1 ? 1 - ax : sx === -1 ? ax : 2 * Math.min(ax, 1 - ax);
  const maxH = sy === 1 ? 1 - ay : sy === -1 ? ay : 2 * Math.min(ay, 1 - ay);
  let width = clamp(box.width + dx * sx, 0.01, maxW),
    height = clamp(box.height + dy * sy, 0.01, maxH);
  if (ratio) {
    if (!sx) width = height * ratio;
    else height = width / ratio;
    const scale = Math.min(1, maxW / width, maxH / height);
    width *= scale;
    height *= scale;
  }
  return {
    x: sx === 1 ? ax : sx === -1 ? ax - width : ax - width / 2,
    y: sy === 1 ? ay : sy === -1 ? ay - height : ay - height / 2,
    width,
    height,
  };
}
