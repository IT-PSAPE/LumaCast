import type { Recipe } from "@lumacast/photo-model";
const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
/** Manual radial correction, not a calibrated camera/lens profile. Never mutates source pixels. */
export function correctLens(
  input: Buffer,
  width: number,
  height: number,
  r: Recipe,
): Buffer {
  if (!r.lensDistortion && !r.lensVignette && !r.lensRed && !r.lensBlue)
    return input;
  const cx = (width - 1) / 2,
    cy = (height - 1) / 2,
    radius2 = Math.max(1, cx * cx + cy * cy);
  let source = input;
  // Lens shading belongs to source coordinates, before warping or cropping.
  if (r.lensVignette) {
    source = Buffer.from(input);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4,
          r2 = ((x - cx) ** 2 + (y - cy) ** 2) / radius2,
          gain = 1 + ((1.5 * r.lensVignette) / 100) * r2 * r2;
        for (let c = 0; c < 3; c++)
          source[i + c] = clampByte(input[i + c] * gain);
      }
  }
  if (!r.lensDistortion && !r.lensRed && !r.lensBlue) return source;
  const k = r.lensDistortion / 400,
    redScale = 1 + r.lensRed / 20000,
    blueScale = 1 + r.lensBlue / 20000;
  const maxChannel = Math.max(1, redScale, blueScale);
  // Polynomial is monotonic over the image for k in [-.25,.25]. Its maximum
  // boundary extent is at a corner (positive k) or side midpoint (negative k).
  // Conservatively constrain every channel inside the original rectangle.
  let low = 0,
    high = 1;
  for (let i = 0; i < 32; i++) {
    const t = (low + high) / 2;
    const bound = t * (1 + Math.max(0, k) * t * t) * maxChannel;
    if (bound <= 1) low = t;
    else high = t;
  }
  const scale = low,
    out = Buffer.allocUnsafe(input.length);
  function sample(x: number, y: number, channel: number) {
    x = Math.max(0, Math.min(width - 1, x));
    y = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      x1 = Math.min(width - 1, x0 + 1),
      y1 = Math.min(height - 1, y0 + 1),
      fx = x - x0,
      fy = y - y0;
    const a = (y0 * width + x0) * 4,
      b = (y0 * width + x1) * 4,
      c = (y1 * width + x0) * 4,
      d = (y1 * width + x1) * 4;
    const wa = (1 - fx) * (1 - fy) * source[a + 3],
      wb = fx * (1 - fy) * source[b + 3],
      wc = (1 - fx) * fy * source[c + 3],
      wd = fx * fy * source[d + 3];
    const alpha = wa + wb + wc + wd;
    return channel === 3
      ? clampByte(alpha)
      : alpha
        ? clampByte(
            (source[a + channel] * wa +
              source[b + channel] * wb +
              source[c + channel] * wc +
              source[d + channel] * wd) /
              alpha,
          )
        : 0;
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) * scale,
        dy = (y - cy) * scale,
        factor = 1 + (k * (dx * dx + dy * dy)) / radius2,
        i = (y * width + x) * 4;
      const sx = dx * factor,
        sy = dy * factor;
      out[i] = sample(cx + sx * redScale, cy + sy * redScale, 0);
      out[i + 1] = sample(cx + sx, cy + sy, 1);
      out[i + 2] = sample(cx + sx * blueScale, cy + sy * blueScale, 2);
      out[i + 3] = sample(cx + sx, cy + sy, 3);
    }
  return out;
}
