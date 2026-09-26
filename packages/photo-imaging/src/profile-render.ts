import type { LensProfile } from "@lumacast/photo-model";
const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const linear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gamma = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
/** Inverse radial mapping using Lensfun's documented Hugin/PA coordinates.
 * This is an independent renderer; it does not link or copy Lensfun library code.
 */
export function correctProfile(
  input: Buffer,
  width: number,
  height: number,
  p: LensProfile,
): Buffer {
  const cx = (width - 1) / 2,
    cy = (height - 1) / 2;
  const diagonal = Math.max(1, Math.hypot(width - 1, height - 1));
  const hugin =
    (2 * p.calibrationCrop * Math.hypot(p.aspect, 1)) /
    (p.cameraCrop * diagonal);
  const pa = (2 * p.calibrationCrop) / (p.cameraCrop * diagonal);
  function distortion(radius: number) {
    if (!p.distortion) return 1;
    const [a, b, c] = p.distortion.terms;
    if (p.distortion.model === "poly3") return 1 - a + a * radius * radius;
    if (p.distortion.model === "poly5")
      return 1 + a * radius * radius + b * radius ** 4;
    return a * radius ** 3 + b * radius * radius + c * radius + 1 - a - b - c;
  }
  function channel(radius: number, c: number) {
    if (!p.tca || c === 1 || c === 3) return 1;
    const offset = c === 0 ? 0 : 3;
    const [b, k, v] = p.tca.terms.slice(offset, offset + 3);
    return b * radius * radius + k * radius + v;
  }
  function map(dx: number, dy: number, c: number) {
    const f = distortion(Math.hypot(dx, dy) * hugin);
    const t = channel(Math.hypot(dx * f, dy * f) * hugin, c);
    return [cx + dx * f * t, cy + dy * f * t];
  }
  const inBounds = (scale: number) => {
    // Check the complete rectangular boundary for all channels, not just corners.
    for (let n = 0; n <= 128; n++) {
      const t = (n / 128) * 2 - 1;
      for (const [x, y] of [
        [cx * t, cy],
        [cx * t, -cy],
        [cx, cy * t],
        [-cx, cy * t],
      ])
        for (let c = 0; c < 3; c++) {
          const [sx, sy] = map(x * scale, y * scale, c);
          if (
            !Number.isFinite(sx) ||
            !Number.isFinite(sy) ||
            sx < 0 ||
            sy < 0 ||
            sx > width - 1 ||
            sy > height - 1
          )
            return false;
        }
    }
    return true;
  };
  let scale = 1;
  if (!inBounds(1)) {
    let lo = 0,
      hi = 1;
    for (let n = 0; n < 30; n++) {
      const mid = (lo + hi) / 2;
      if (inBounds(mid)) lo = mid;
      else hi = mid;
    }
    scale = lo * 0.999999;
  }
  let source = input;
  if (p.vignette) {
    source = Buffer.from(input);
    const [a, b, c] = p.vignette;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const r2 = ((x - cx) ** 2 + (y - cy) ** 2) * pa * pa;
        const gain = 1 / Math.max(0.25, 1 + a * r2 + b * r2 * r2 + c * r2 ** 3);
        const i = (y * width + x) * 4;
        for (let ch = 0; ch < 3; ch++)
          source[i + ch] = byte(
            gamma(linear(input[i + ch] / 255) * gain) * 255,
          );
      }
  }
  const out = Buffer.allocUnsafe(input.length);
  function sample(x: number, y: number, ch: number) {
    x = Math.max(0, Math.min(width - 1, x));
    y = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0;
    const x1 = Math.min(width - 1, x0 + 1),
      y1 = Math.min(height - 1, y0 + 1);
    const a = (y0 * width + x0) * 4,
      b = (y0 * width + x1) * 4,
      c = (y1 * width + x0) * 4,
      d = (y1 * width + x1) * 4;
    const wa = (1 - fx) * (1 - fy) * source[a + 3],
      wb = fx * (1 - fy) * source[b + 3],
      wc = (1 - fx) * fy * source[c + 3],
      wd = fx * fy * source[d + 3];
    const alpha = wa + wb + wc + wd;
    return ch === 3
      ? byte(alpha)
      : alpha
        ? byte(
            (wa * source[a + ch] +
              wb * source[b + ch] +
              wc * source[c + ch] +
              wd * source[d + ch]) /
              alpha,
          )
        : 0;
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) * scale,
        dy = (y - cy) * scale,
        i = (y * width + x) * 4;
      const radius = Math.hypot(dx, dy) * hugin,
        f = distortion(radius);
      const sx = dx * f,
        sy = dy * f,
        r = radius * Math.abs(f);
      let red = 1,
        blue = 1;
      if (p.tca) {
        const [br, cr, vr, bb, cb, vb] = p.tca.terms;
        red = br * r * r + cr * r + vr;
        blue = bb * r * r + cb * r + vb;
      }
      out[i] = sample(cx + sx * red, cy + sy * red, 0);
      out[i + 1] = sample(cx + sx, cy + sy, 1);
      out[i + 2] = sample(cx + sx * blue, cy + sy * blue, 2);
      out[i + 3] = sample(cx + sx, cy + sy, 3);
    }
  return out;
}
