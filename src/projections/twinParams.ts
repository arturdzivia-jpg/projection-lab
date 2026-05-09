/**
 * Shared parameter for the twin-disk projections (orthographic / stereographic twin).
 *
 * `centerOffsetDeg` rotates the layout — it shifts both disk centres by the same amount.
 * At the default (0°) the seam between disks lies at lon = 0° (Atlantic);
 * at +90° the seam lies at lon = +90° (Indian Ocean), etc.
 *
 * Mutated by `convertImage` on each call so CPU forward/inverse (used for coastlines)
 * stay in sync with the GPU uniform `u_twinOffsetRad`.
 */
export const twinParams = {
  centerOffsetDeg: 0,
};
