import type { Projection } from './types';
import { twinParams } from './twinParams';

const PI = Math.PI;
const HALF_PI = Math.PI / 2;

function normalizeLon(lon: number): number {
  return (((lon + PI) % (2 * PI)) + 2 * PI) % (2 * PI) - PI;
}

/**
 * Twin equatorial orthographic projection — two side-by-side orthographic hemispheres,
 * each viewed as if from infinity (the limit case of vertical perspective). Classic
 * world-map layout used since the 16th century (e.g. Rumold Mercator 1587).
 *
 * Per-disk math (azimuthal orthographic, equatorial aspect, φ₀ = 0):
 *   x = cos(φ) · sin(λ − λ₀)
 *   y = sin(φ)
 * Inverse:
 *   φ = arcsin(y)
 *   λ = λ₀ + atan2(x, √(1 − x² − y²))
 *
 * Default layout (aspect 2:1):
 *   - Left disk:  λ₀ = −90°  (Western hemisphere, λ ∈ [−180°, 0°])
 *   - Right disk: λ₀ = +90°  (Eastern hemisphere, λ ∈ [0°, +180°])
 *
 * `twinParams.centerOffsetDeg` shifts both disk centres by the same amount, rotating the
 * whole layout — the seam between disks lies at lon = centerOffsetDeg.
 */
export const orthographicTwin: Projection = {
  id: 'orthographicTwin',
  label: 'Orthographic (twin hemispheres)',
  defaultAspect: 2,

  glsl: `
    vec2 inverse_orthographicTwin(vec2 uv) {
      bool right = uv.x >= 0.5;
      float lon0 = right ? HALF_PI : -HALF_PI;
      float xLoc = right ? (uv.x * 4.0 - 3.0) : (uv.x * 4.0 - 1.0);
      float yLoc = 1.0 - uv.y * 2.0;
      float r2 = xLoc * xLoc + yLoc * yLoc;
      if (r2 > 1.0) return vec2(999.0, 999.0);
      float lat = asin(clamp(yLoc, -1.0, 1.0));
      float lonShifted = lon0 + atan(xLoc, sqrt(max(1.0 - r2, 0.0)));
      // Apply the twin layout offset so the visible content matches real-world longitude.
      float lon = mod(lonShifted + u_twinOffsetRad + PI, 2.0 * PI) - PI;
      return vec2(lon, lat);
    }

    vec2 forward_orthographicTwin(vec2 lonlat) {
      // Move into the twin's intrinsic frame (seam at 0) before picking a hemisphere.
      float shiftedLon = mod(lonlat.x - u_twinOffsetRad + PI, 2.0 * PI) - PI;
      bool right = shiftedLon > 0.0;
      float lon0 = right ? HALF_PI : -HALF_PI;
      float dLon = shiftedLon - lon0;
      float x = cos(lonlat.y) * sin(dLon);
      float y = sin(lonlat.y);
      float u = right ? (x * 0.25 + 0.75) : (x * 0.25 + 0.25);
      float v = 0.5 - y * 0.5;
      return vec2(u, v);
    }
  `,

  forward(lon, lat) {
    const offset = (twinParams.centerOffsetDeg * PI) / 180;
    const shiftedLon = normalizeLon(lon - offset);
    const right = shiftedLon > 0;
    const lon0 = right ? HALF_PI : -HALF_PI;
    const dLon = shiftedLon - lon0;
    const x = Math.cos(lat) * Math.sin(dLon);
    const y = Math.sin(lat);
    const u = right ? x * 0.25 + 0.75 : x * 0.25 + 0.25;
    const v = 0.5 - y * 0.5;
    return { u, v };
  },

  inverse(u, v) {
    const offset = (twinParams.centerOffsetDeg * PI) / 180;
    const right = u >= 0.5;
    const lon0 = right ? HALF_PI : -HALF_PI;
    const xLoc = right ? u * 4 - 3 : u * 4 - 1;
    const yLoc = 1 - v * 2;
    const r2 = xLoc * xLoc + yLoc * yLoc;
    if (r2 > 1) return null;
    const lat = Math.asin(Math.max(-1, Math.min(1, yLoc)));
    const lonShifted = lon0 + Math.atan2(xLoc, Math.sqrt(Math.max(0, 1 - r2)));
    const lon = normalizeLon(lonShifted + offset);
    return { lon, lat };
  },
};
