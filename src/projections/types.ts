export type ProjectionId = 'equirectangular' | 'mercator' | 'lambert' | 'hemispheres';

export interface Projection {
  id: ProjectionId;
  label: string;

  // Default aspect ratio (width / height) for an output canvas in this projection.
  defaultAspect: number;

  // GLSL snippet defining:
  //   vec2 forward(vec2 lonlat)   — sphere (radians) → normalized [0,1]^2
  //   vec2 inverse(vec2 uv)       — normalized [0,1]^2 → sphere (radians, lon ∈ [-π,π], lat ∈ [-π/2,π/2])
  // Functions must be named forward_<id> and inverse_<id> to avoid collisions.
  glsl: string;

  // CPU-side helpers (used for the globe view, which uses equirectangular textures).
  forward(lon: number, lat: number): { u: number; v: number } | null;
  inverse(u: number, v: number): { lon: number; lat: number } | null;
}
