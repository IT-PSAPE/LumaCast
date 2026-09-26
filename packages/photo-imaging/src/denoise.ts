const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
/** Two separable bilateral passes in luminance/chroma coordinates. Alpha is preserved. */
export function denoise(
  input: Buffer,
  width: number,
  height: number,
  luminance: number,
  color: number,
): Buffer {
  if (!luminance && !color) return input;
  const spatial = [0.1353, 0.6065, 1, 0.6065, 0.1353];
  const weights = (sigma: number) =>
    Float64Array.from({ length: 1021 }, (_, i) =>
      Math.exp(-((i / 2) ** 2) / (2 * sigma * sigma)),
    );
  const lumaRange = weights(4 + luminance * 0.4),
    colorRange = weights(10 + color * 0.6),
    edgeRange = weights(30);
  const index = (n: number) => Math.min(1020, Math.round(Math.abs(n) * 2));
  let source = input;
  for (const vertical of [false, true]) {
    const out = Buffer.allocUnsafe(input.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4,
          alpha = source[i + 3];
        if (!alpha) {
          source.copy(out, i, i, i + 4);
          continue;
        }
        const y0 =
            0.299 * source[i] + 0.587 * source[i + 1] + 0.114 * source[i + 2],
          cb0 = source[i + 2] - y0,
          cr0 = source[i] - y0;
        let sumY = 0,
          weightY = 0,
          sumCb = 0,
          sumCr = 0,
          weightC = 0;
        for (let d = -2; d <= 2; d++) {
          const nx = vertical ? x : Math.max(0, Math.min(width - 1, x + d)),
            ny = vertical ? Math.max(0, Math.min(height - 1, y + d)) : y,
            j = (ny * width + nx) * 4;
          if (!source[j + 3]) continue;
          const yn =
              0.299 * source[j] + 0.587 * source[j + 1] + 0.114 * source[j + 2],
            cb = source[j + 2] - yn,
            cr = source[j] - yn;
          const w = (spatial[d + 2] * source[j + 3]) / 255,
            deltaY = index(yn - y0);
          if (luminance) {
            const wy = w * lumaRange[deltaY];
            sumY += yn * wy;
            weightY += wy;
          }
          if (color) {
            const wc =
              w *
              edgeRange[deltaY] *
              colorRange[
                index(Math.max(Math.abs(cb - cb0), Math.abs(cr - cr0)))
              ];
            sumCb += cb * wc;
            sumCr += cr * wc;
            weightC += wc;
          }
        }
        const yy =
            y0 + (luminance ? (luminance / 100) * (sumY / weightY - y0) : 0),
          cb = cb0 + (color ? (color / 100) * (sumCb / weightC - cb0) : 0),
          cr = cr0 + (color ? (color / 100) * (sumCr / weightC - cr0) : 0);
        out[i] = byte(yy + cr);
        out[i + 1] = byte(yy - (0.299 * cr + 0.114 * cb) / 0.587);
        out[i + 2] = byte(yy + cb);
        out[i + 3] = alpha;
      }
    source = out;
  }
  return source;
}
