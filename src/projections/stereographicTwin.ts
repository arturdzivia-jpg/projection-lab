import type { Projection } from './types';
import { twinParams } from './twinParams';

const PI = Math.PI;
const HALF_PI = Math.PI / 2;

function normalizeLon(lon: number): number {
  return (((lon + PI) % (2 * PI)) + 2 * PI) % (2 * PI) - PI;
}

/**
 * Twin equatorial stereographic projection — two side-by-side stereographic hemispheres.
 * Conformal: angles (and therefore local shapes) are preserved everywhere, but areas
 * inflate dramatically toward the disk boundary. The classic atlas look of the 17th–19th
 * centuries (Mercator's 1587 world map, John Speed, Visscher, etc.).
 *
 * Per-disk math (azimuthal stereographic, equatorial aspect, φ₀ = 0), normalised so
 * the visible hemisphere fills a unit disk (boundary at ρ = 1):
 *   k = 1 / (1 + cos(φ) · cos(λ − λ₀))
 *   x = cos(φ) · sin(λ − λ₀) · k
 *   y = sin(φ) · k
 * Inverse (with ρ² = x² + y²):
 *   φ = arcsin(2y / (1 + ρ²))
 *   λ = λ₀ + atan2(2x, 1 − ρ²)
 *
 * `twinParams.centerOffsetDeg` shifts both disk centres in lockstep — see orthographicTwin.
 */
export const stereographicTwin: Projection = {
  id: 'stereographicTwin',
  label: 'Stereographic (twin hemispheres)',
  defaultAspect: 2,

  glsl: `
    vec2 inverse_stereographicTwin(vec2 uv) {
      bool right = uv.x >= 0.5;
      float lon0 = right ? HALF_PI : -HALF_PI;
      float xLoc = right ? (uv.x * 4.0 - 3.0) : (uv.x * 4.0 - 1.0);
      float yLoc = 1.0 - uv.y * 2.0;
      float r2 = xLoc * xLoc + yLoc * yLoc;
      if (r2 > 1.0) return vec2(999.0, 999.0);
      float lat = asin(clamp(2.0 * yLoc / (1.0 + r2), -1.0, 1.0));
      float lonShifted = lon0 + atan(2.0 * xLoc, 1.0 - r2);
      float lon = mod(lonShifted + u_twinOffsetRad + PI, 2.0 * PI) - PI;
      return vec2(lon, lat);
    }

    vec2 forward_stereographicTwin(vec2 lonlat) {
      float shiftedLon = mod(lonlat.x - u_twinOffsetRad + PI, 2.0 * PI) - PI;
      bool right = shiftedLon > 0.0;
      float lon0 = right ? HALF_PI : -HALF_PI;
      float dLon = shiftedLon - lon0;
      float cLat = cos(lonlat.y);
      float k = 1.0 / (1.0 + cLat * cos(dLon));
      float x = cLat * sin(dLon) * k;
      float y = sin(lonlat.y) * k;
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
    const cLat = Math.cos(lat);
    const denom = 1 + cLat * Math.cos(dLon);
    if (denom <= 1e-9) return null;
    const k = 1 / denom;
    const x = cLat * Math.sin(dLon) * k;
    const y = Math.sin(lat) * k;
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
    const lat = Math.asin(Math.max(-1, Math.min(1, (2 * yLoc) / (1 + r2))));
    const lonShifted = lon0 + Math.atan2(2 * xLoc, 1 - r2);
    const lon = normalizeLon(lonShifted + offset);
    return { lon, lat };
  },
};
