/** Normalizes a source angle to the signed interval [-180, 180). */
export function normalizeSourceRotation(rotation: number | undefined): number {
  if (rotation === undefined || !Number.isFinite(rotation)) return 0;
  const normalized = ((rotation + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 0.0001 ? 0 : Number(normalized.toFixed(4));
}
