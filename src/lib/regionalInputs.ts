import type { ProjectionId } from '../projections';
import { regionPresets } from '../projections/regionPresets';
import type { FitMode } from './normalize';

/**
 * One regional drawing the user has fed into the app. The composite stage stitches N of these
 * back into a single equirectangular world via convertImage(input.projection → equirectangular)
 * and source-over compositing in list order (top wins overlap).
 */
export interface RegionalInput {
  id: string;
  label: string;
  filename: string;
  image: HTMLImageElement;
  enabled: boolean;
  projectionId: ProjectionId;
  fit: FitMode;
  // Per-projection params. Only the relevant set is used at render time.
  lambert: { lon: number; lat: number; scale: number };
  twinOffset: number;
}

const EUROPE_PRESET =
  regionPresets.find((p) => p.id === 'europe') ?? regionPresets[0];

export function defaultLambertParams() {
  return { lon: EUROPE_PRESET.lon, lat: EUROPE_PRESET.lat, scale: EUROPE_PRESET.scale };
}

function genId(): string {
  // crypto.randomUUID is available in modern browsers; fall back to a timestamp+random combo
  // for the sliver of older targets that hit this code path.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create a fresh input from an uploaded image, auto-detecting projection + params from filename. */
export function createInput(image: HTMLImageElement, filename: string): RegionalInput {
  const decoded = decodeFilename(filename);
  return {
    id: genId(),
    label: decoded.base,
    filename,
    image,
    enabled: true,
    projectionId: decoded.projectionId ?? 'lambert',
    fit: 'stretch',
    lambert: decoded.lambert ?? defaultLambertParams(),
    twinOffset: decoded.twinOffset ?? 0,
  };
}

export function updateInput(
  list: RegionalInput[],
  id: string,
  patch: Partial<RegionalInput>
): RegionalInput[] {
  return list.map((i) => (i.id === id ? { ...i, ...patch } : i));
}

export function removeInput(list: RegionalInput[], id: string): RegionalInput[] {
  return list.filter((i) => i.id !== id);
}

export function reorderInput(
  list: RegionalInput[],
  id: string,
  direction: 'up' | 'down'
): RegionalInput[] {
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return list;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(idx, 1);
  next.splice(target, 0, moved);
  return next;
}

// ---------------------------------------------------------------------------
// Filename codec
// ---------------------------------------------------------------------------
//
// Format: {base}.{projId}.{params}.png — params is a single dot-free segment so the outer regex
// stays simple. Params are projection-specific; mercator and equirectangular omit them.
//
//   Lambert:           c<lon>_<lat>_s<scale>     e.g. myworld.lambert.c15_52_s25.png
//   Twin orthographic: o<offset>                 e.g. myworld.orthographicTwin.o30.png
//   Twin stereographic same                      e.g. myworld.stereographicTwin.o-30.png
//   Mercator / Equirectangular: (no params)      e.g. myworld.mercator.png
//
// Decoder fails silently to {base} only — caller fills the rest from defaults so a renamed PNG
// still loads; the user can fix projection + params manually in the input row.

const FILENAME_RE =
  /^(?<base>.+?)\.(?<proj>lambert|mercator|equirectangular|orthographicTwin|stereographicTwin)(?:\.(?<params>[^.]+))?\.png$/i;

const LAMBERT_PARAMS_RE =
  /^c(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_s(-?\d+(?:\.\d+)?)$/;

const TWIN_PARAMS_RE = /^o(-?\d+(?:\.\d+)?)$/;

function fmtNum(n: number): string {
  // Two decimals max, trailing zeros stripped — keeps filenames terse and round-trips visually
  // identical to what the user sees in the sliders.
  const r = Number(n.toFixed(2));
  return Number.isInteger(r) ? r.toString() : r.toString();
}

export interface DecodedFilename {
  base: string;
  projectionId?: ProjectionId;
  lambert?: { lon: number; lat: number; scale: number };
  twinOffset?: number;
}

export function decodeFilename(filename: string): DecodedFilename {
  const m = FILENAME_RE.exec(filename);
  if (!m || !m.groups) {
    // Unparseable — strip the extension to give a usable label.
    return { base: filename.replace(/\.[^.]+$/, '') || 'untitled' };
  }
  const base = m.groups.base;
  const projectionId = m.groups.proj as ProjectionId;
  const params = m.groups.params;

  if (projectionId === 'lambert' && params) {
    const pm = LAMBERT_PARAMS_RE.exec(params);
    if (pm) {
      return {
        base,
        projectionId,
        lambert: { lon: Number(pm[1]), lat: Number(pm[2]), scale: Number(pm[3]) },
      };
    }
  }
  if ((projectionId === 'orthographicTwin' || projectionId === 'stereographicTwin') && params) {
    const pm = TWIN_PARAMS_RE.exec(params);
    if (pm) return { base, projectionId, twinOffset: Number(pm[1]) };
  }
  return { base, projectionId };
}

/**
 * Build a download filename encoding the projection + its render-relevant params, so that
 * re-importing the result auto-restores those params on the matching input row.
 */
export function buildDownloadName(
  base: string,
  projectionId: ProjectionId,
  params: { lambert?: { lon: number; lat: number; scale: number }; twinOffset?: number }
): string {
  const safeBase = base.replace(/\.[^.]+$/, '') || 'map';
  if (projectionId === 'lambert' && params.lambert) {
    const { lon, lat, scale } = params.lambert;
    return `${safeBase}.lambert.c${fmtNum(lon)}_${fmtNum(lat)}_s${fmtNum(scale)}.png`;
  }
  if (projectionId === 'orthographicTwin' || projectionId === 'stereographicTwin') {
    const offset = params.twinOffset ?? 0;
    return `${safeBase}.${projectionId}.o${fmtNum(offset)}.png`;
  }
  // mercator / equirectangular: no params segment
  return `${safeBase}.${projectionId}.png`;
}
