import type { Projection } from './types';

/**
 * Lambert Azimuthal Equal-Area projection — a regional view centred on (centerLon, centerLat),
 * with `scaleDeg` controlling the angular radius shown (e.g. 90° = full hemisphere, 30° = small region).
 *
 * Equal-area: regions on the sphere preserve their relative areas in the plane image. Shape distortion
 * grows with distance from the centre, but stays moderate up to ~hemispheric extents — making it the
 * standard choice for working on a continent or country.
 *
 * Aspect: 1:1. Output is a square; content lies inside a disk of plane-radius R = 2·sin(scale/2).
 * Pixels outside that disk (and the disk itself outside the inscribed square if scale > 180°) are
 * outside the projection's domain and rendered transparent.
 *
 * The CPU forward/inverse helpers and the GLSL helpers all read the SAME parameters from the mutable
 * `lambertParams` singleton below — convertImage updates these on each call so the projection's
 * forward()/inverse() (used by coastline drawing) stay in sync with the GPU uniforms.
 */
export const lambertParams = {
  centerLonDeg: 0,
  centerLatDeg: 0,
  scaleDeg: 90,
};

export const lambert: Projection = {
  id: 'lambert',
  label: 'Lambert Azimuthal (Equal-Area)',
  defaultAspect: 1,

  glsl: `
    uniform float u_lambertCenterLonRad;
    uniform float u_lambertCenterLatRad;
    uniform float u_lambertScaleRad;

    // (lon, lat) → uv in [0,1]². Returns (-1,-1) if the point is the antipode of the centre
    // (forward is undefined there) — the caller's [0,1] domain check then drops the pixel.
    vec2 forward_lambert(vec2 lonlat) {
      float dLon = lonlat.x - u_lambertCenterLonRad;
      float sinLat0 = sin(u_lambertCenterLatRad);
      float cosLat0 = cos(u_lambertCenterLatRad);
      float sinLat = sin(lonlat.y);
      float cosLat = cos(lonlat.y);
      float cosDLon = cos(dLon);
      float denom = 1.0 + sinLat0 * sinLat + cosLat0 * cosLat * cosDLon;
      if (denom <= 1e-6) return vec2(-1.0, -1.0);
      float k = sqrt(2.0 / denom);
      float x = k * cosLat * sin(dLon);
      float y = k * (cosLat0 * sinLat - sinLat0 * cosLat * cosDLon);
      float R = 2.0 * sin(u_lambertScaleRad * 0.5);
      float u = (x + R) / (2.0 * R);
      // Image y grows downward; projection y grows upward (north).
      float v = 1.0 - (y + R) / (2.0 * R);
      return vec2(u, v);
    }

    // uv → (lon, lat). Returns (999, 999) for pixels outside the sphere disk (rho > 2),
    // letting the domain check in main() reject them.
    vec2 inverse_lambert(vec2 uv) {
      float R = 2.0 * sin(u_lambertScaleRad * 0.5);
      float x = (uv.x * 2.0 - 1.0) * R;
      float y = ((1.0 - uv.y) * 2.0 - 1.0) * R;
      float rho = sqrt(x * x + y * y);
      if (rho > 2.0) return vec2(999.0, 999.0);
      if (rho < 1e-9) return vec2(u_lambertCenterLonRad, u_lambertCenterLatRad);
      float c = 2.0 * asin(clamp(rho * 0.5, -1.0, 1.0));
      float sinC = sin(c);
      float cosC = cos(c);
      float sinLat0 = sin(u_lambertCenterLatRad);
      float cosLat0 = cos(u_lambertCenterLatRad);
      float lat = asin(clamp(cosC * sinLat0 + (y * sinC * cosLat0) / rho, -1.0, 1.0));
      float lon = u_lambertCenterLonRad + atan(x * sinC, rho * cosLat0 * cosC - y * sinLat0 * sinC);
      return vec2(lon, lat);
    }
  `,

  forward(lon, lat) {
    const lon0 = (lambertParams.centerLonDeg * Math.PI) / 180;
    const lat0 = (lambertParams.centerLatDeg * Math.PI) / 180;
    const scale = (lambertParams.scaleDeg * Math.PI) / 180;
    const dLon = lon - lon0;
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const cosDLon = Math.cos(dLon);
    const denom = 1 + sinLat0 * sinLat + cosLat0 * cosLat * cosDLon;
    if (denom <= 1e-6) return null; // antipode
    const k = Math.sqrt(2 / denom);
    const x = k * cosLat * Math.sin(dLon);
    const y = k * (cosLat0 * sinLat - sinLat0 * cosLat * cosDLon);
    const R = 2 * Math.sin(scale / 2);
    const u = (x + R) / (2 * R);
    const v = 1 - (y + R) / (2 * R);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null; // outside the visible square
    return { u, v };
  },

  inverse(u, v) {
    const lon0 = (lambertParams.centerLonDeg * Math.PI) / 180;
    const lat0 = (lambertParams.centerLatDeg * Math.PI) / 180;
    const scale = (lambertParams.scaleDeg * Math.PI) / 180;
    const R = 2 * Math.sin(scale / 2);
    const x = (u * 2 - 1) * R;
    const y = ((1 - v) * 2 - 1) * R;
    const rho = Math.sqrt(x * x + y * y);
    if (rho > 2) return null;
    if (rho < 1e-9) return { lon: lon0, lat: lat0 };
    const c = 2 * Math.asin(Math.min(1, Math.max(-1, rho / 2)));
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const lat = Math.asin(
      Math.min(1, Math.max(-1, cosC * sinLat0 + (y * sinC * cosLat0) / rho))
    );
    const lon =
      lon0 + Math.atan2(x * sinC, rho * cosLat0 * cosC - y * sinLat0 * sinC);
    return { lon, lat };
  },
};
