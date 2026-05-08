import type { Projection } from './types';

// Web Mercator clip latitude: ±arctan(sinh(π)) ≈ ±85.05113°
const MAX_LAT = Math.atan(Math.sinh(Math.PI));

export const mercator: Projection = {
  id: 'mercator',
  label: 'Mercator',
  defaultAspect: 1,

  glsl: `
    // Web Mercator. Latitudes outside ±atan(sinh(π)) map outside [0,1] and are clipped by the caller.
    vec2 forward_mercator(vec2 lonlat) {
      float lon = lonlat.x;
      float lat = clamp(lonlat.y, -MAX_LAT_MERCATOR, MAX_LAT_MERCATOR);
      float u = lon / (2.0 * PI) + 0.5;
      float y = log(tan(PI * 0.25 + lat * 0.5));
      float v = 0.5 - y / (2.0 * PI);
      return vec2(u, v);
    }
    vec2 inverse_mercator(vec2 uv) {
      float lon = (uv.x - 0.5) * 2.0 * PI;
      float y = (0.5 - uv.y) * 2.0 * PI;
      float lat = 2.0 * atan(exp(y)) - PI * 0.5;
      return vec2(lon, lat);
    }
  `,

  forward(lon, lat) {
    if (lat <= -MAX_LAT || lat >= MAX_LAT) return null;
    const u = lon / (2 * Math.PI) + 0.5;
    const y = Math.log(Math.tan(Math.PI / 4 + lat / 2));
    const v = 0.5 - y / (2 * Math.PI);
    return { u, v };
  },

  inverse(u, v) {
    const lon = (u - 0.5) * 2 * Math.PI;
    const y = (0.5 - v) * 2 * Math.PI;
    const lat = 2 * Math.atan(Math.exp(y)) - Math.PI / 2;
    return { lon, lat };
  },
};

export const MERCATOR_MAX_LAT = MAX_LAT;
