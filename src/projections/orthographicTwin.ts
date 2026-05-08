import type { Projection } from './types';

const HALF_PI = Math.PI / 2;

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
 * Layout (aspect 2:1):
 *   - Left disk:  λ₀ = −90°  (Western hemisphere, λ ∈ [−180°, 0°])
 *   - Right disk: λ₀ = +90°  (Eastern hemisphere, λ ∈ [0°, +180°])
 *
 * Pixels outside either disk lie outside the projection's domain and are rendered transparent.
 */
export const orthographicTwin: Projection = {
  id: 'orthographicTwin',
  label: 'Orthographic (twin hemispheres)',
  defaultAspect: 2,

  glsl: `
    vec2 inverse_orthographicTwin(vec2 uv) {
      bool right = uv.x >= 0.5;
      float lon0 = right ? HALF_PI : -HALF_PI;
      // Local hemisphere coordinates: x ∈ [-1, 1] across the inscribed disk, y north-positive.
      float xLoc = right ? (uv.x * 4.0 - 3.0) : (uv.x * 4.0 - 1.0);
      float yLoc = 1.0 - uv.y * 2.0;
      float r2 = xLoc * xLoc + yLoc * yLoc;
      if (r2 > 1.0) return vec2(999.0, 999.0);
      float lat = asin(clamp(yLoc, -1.0, 1.0));
      float lon = lon0 + atan(xLoc, sqrt(max(1.0 - r2, 0.0)));
      return vec2(lon, lat);
    }

    vec2 forward_orthographicTwin(vec2 lonlat) {
      // Hemisphere chosen by sign of lon — the seam at lon = 0° lines up at the disk boundary.
      bool right = lonlat.x > 0.0;
      float lon0 = right ? HALF_PI : -HALF_PI;
      float dLon = lonlat.x - lon0;
      float x = cos(lonlat.y) * sin(dLon);
      float y = sin(lonlat.y);
      float u = right ? (x * 0.25 + 0.75) : (x * 0.25 + 0.25);
      float v = 0.5 - y * 0.5;
      return vec2(u, v);
    }
  `,

  forward(lon, lat) {
    const right = lon > 0;
    const lon0 = right ? HALF_PI : -HALF_PI;
    const dLon = lon - lon0;
    const x = Math.cos(lat) * Math.sin(dLon);
    const y = Math.sin(lat);
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
    const lat = Math.asin(Math.max(-1, Math.min(1, yLoc)));
    const lon = lon0 + Math.atan2(xLoc, Math.sqrt(Math.max(0, 1 - r2)));
    return { lon, lat };
  },
};
