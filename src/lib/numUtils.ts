export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Wrap a longitude in degrees into the canonical [-180, 180] range. */
export function normalizeLon(deg: number): number {
  return (((deg + 180) % 360) + 360) % 360 - 180;
}
