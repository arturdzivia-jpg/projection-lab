import type { Projection } from './types';

const HALF_PI = Math.PI / 2;

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
 * Layout (aspect 2:1):
 *   - Left disk:  λ₀ = −90°  (Western hemisphere)
 *   - Right disk: λ₀ = +90°  (Eastern hemisphere)
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
      float lon = lon0 + atan(2.0 * xLoc, 1.0 - r2);
      return vec2(lon, lat);
    }

    vec2 forward_stereographicTwin(vec2 lonlat) {
      // Within each hemisphere the antipode (where the projection blows up) is excluded by
      // construction: dLon ∈ [−π/2, π/2] keeps cos(dLon) ≥ 0 and the denominator > 0.
      bool right = lonlat.x > 0.0;
      float lon0 = right ? HALF_PI : -HALF_PI;
      float dLon = lonlat.x - lon0;
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
    const right = lon > 0;
    const lon0 = right ? HALF_PI : -HALF_PI;
    const dLon = lon - lon0;
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
    const right = u >= 0.5;
    const lon0 = right ? HALF_PI : -HALF_PI;
    const xLoc = right ? u * 4 - 3 : u * 4 - 1;
    const yLoc = 1 - v * 2;
    const r2 = xLoc * xLoc + yLoc * yLoc;
    if (r2 > 1) return null;
    const lat = Math.asin(Math.max(-1, Math.min(1, (2 * yLoc) / (1 + r2))));
    const lon = lon0 + Math.atan2(2 * xLoc, 1 - r2);
    return { lon, lat };
  },
};
