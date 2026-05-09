/**
 * Regional view presets — conventional (centre lon, centre lat, angular radius) for the
 * common continental views used in atlases. Picking a preset writes all three Lambert
 * Azimuthal params at once; manually moving any slider drops the UI back to "Custom".
 *
 * Centres pulled from standard regional cartographic conventions (e.g. those used in the
 * D3-geo / Observable five-projections-for-Europe notebook). Scale (angular radius) is
 * tuned so the named landmass roughly fits inside the projected disk without too much
 * surrounding ocean.
 */
export interface RegionPreset {
  id: string;
  label: string;
  lon: number;
  lat: number;
  scale: number;
}

export const regionPresets: RegionPreset[] = [
  { id: 'world', label: 'World (hemisphere)', lon: 0, lat: 0, scale: 90 },
  { id: 'europe', label: 'Europe', lon: 15, lat: 52, scale: 25 },
  { id: 'north-america', label: 'North America', lon: -100, lat: 45, scale: 35 },
  { id: 'south-america', label: 'South America', lon: -60, lat: -15, scale: 30 },
  { id: 'africa', label: 'Africa', lon: 20, lat: 0, scale: 40 },
  { id: 'asia', label: 'Asia', lon: 100, lat: 35, scale: 45 },
  { id: 'oceania', label: 'Australia & Oceania', lon: 140, lat: -25, scale: 35 },
  { id: 'arctic', label: 'Arctic', lon: 0, lat: 90, scale: 40 },
  { id: 'antarctic', label: 'Antarctic', lon: 0, lat: -90, scale: 40 },
];

/**
 * Find which preset the current params correspond to (within a 0.5° tolerance, so floating-point
 * drift from a slider doesn't drop us out of the preset). Returns null if nothing matches —
 * i.e. the user has dialled in a custom view.
 */
export function matchRegionPreset(
  lon: number,
  lat: number,
  scale: number
): RegionPreset | null {
  const tol = 0.5;
  return (
    regionPresets.find(
      (p) =>
        Math.abs(p.lon - lon) < tol &&
        Math.abs(p.lat - lat) < tol &&
        Math.abs(p.scale - scale) < tol
    ) ?? null
  );
}
