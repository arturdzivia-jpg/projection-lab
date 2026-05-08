import type { Projection } from './types';

const PI = Math.PI;
const HALF_PI = Math.PI / 2;

export const equirectangular: Projection = {
  id: 'equirectangular',
  label: 'Equirectangular',
  defaultAspect: 2,

  glsl: `
    // lonlat: (lon ∈ [-π,π], lat ∈ [-π/2,π/2]) → uv ∈ [0,1]^2
    vec2 forward_equirectangular(vec2 lonlat) {
      float u = lonlat.x / (2.0 * PI) + 0.5;
      float v = 0.5 - lonlat.y / PI;
      return vec2(u, v);
    }
    // uv ∈ [0,1]^2 → (lon, lat)
    vec2 inverse_equirectangular(vec2 uv) {
      float lon = (uv.x - 0.5) * 2.0 * PI;
      float lat = (0.5 - uv.y) * PI;
      return vec2(lon, lat);
    }
  `,

  forward(lon, lat) {
    return { u: lon / (2 * PI) + 0.5, v: 0.5 - lat / PI };
  },

  inverse(u, v) {
    const lon = (u - 0.5) * 2 * PI;
    const lat = (0.5 - v) * PI;
    if (lat < -HALF_PI || lat > HALF_PI) return null;
    return { lon, lat };
  },
};
