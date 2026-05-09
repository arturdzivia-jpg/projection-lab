import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import landTopoJson from 'world-atlas/land-110m.json';
import type { Projection } from '../projections';
import { lambertParams } from '../projections/lambert';
import { twinParams } from '../projections/twinParams';

// One polyline = an ordered list of [lon°, lat°] vertices forming a continuous coastline path.
type Polyline = Array<[number, number]>;

// A point on the canvas is "off the seam" — used to detect dateline-crossing segments below.
const SEAM_FRACTION = 0.5;

let cachedPolylines: Polyline[] | null = null;

/** Decode the bundled TopoJSON once and flatten land/MultiPolygon rings into individual polylines. */
function getPolylines(): Polyline[] {
  if (cachedPolylines) return cachedPolylines;

  const topology = landTopoJson as unknown as Topology;
  const land = feature(topology, topology.objects.land) as
    | Feature<Geometry>
    | FeatureCollection<Geometry>;

  const features: Array<Feature<Geometry>> =
    land.type === 'FeatureCollection' ? land.features : [land];

  const polylines: Polyline[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type === 'Polygon') {
      for (const ring of g.coordinates) polylines.push(ring as Polyline);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        for (const ring of poly) polylines.push(ring as Polyline);
      }
    }
  }

  cachedPolylines = polylines;
  return polylines;
}

const pathCache = new Map<string, Path2D>();

/**
 * Build (or look up) a Path2D of all coastlines projected into a canvas of size width×height
 * under `projection`. The path is independent of grid/lonShift, so callers can stroke it cheaply
 * on every render — drag and slider changes do not invalidate the cache.
 */
function getCoastlinePath(projection: Projection, width: number, height: number): Path2D {
  // For parameterised projections, include the params so the cache invalidates when the user moves
  // them. For others, the projection id alone uniquely keys the path.
  const key =
    projection.id === 'lambert'
      ? `lambert/${lambertParams.centerLonDeg}/${lambertParams.centerLatDeg}/${lambertParams.scaleDeg}/${width}x${height}`
      : projection.id === 'orthographicTwin' || projection.id === 'stereographicTwin'
      ? `${projection.id}/${twinParams.centerOffsetDeg}/${width}x${height}`
      : `${projection.id}/${width}x${height}`;
  const cached = pathCache.get(key);
  if (cached) return cached;

  const path = new Path2D();
  const polylines = getPolylines();
  const seamPx = width * SEAM_FRACTION;

  for (const ring of polylines) {
    if (ring.length < 2) continue;
    let prevX = 0;
    let started = false;

    for (const [lonDeg, latDeg] of ring) {
      const lon = (lonDeg * Math.PI) / 180;
      const lat = (latDeg * Math.PI) / 180;
      const proj = projection.forward(lon, lat);
      if (!proj) {
        // Outside the projection's domain (e.g. polar caps in Mercator). Break the path.
        started = false;
        continue;
      }
      const x = proj.u * width;
      const y = proj.v * height;
      // Detect dateline wrap-around: a coastline shouldn't draw a segment spanning >half the canvas.
      if (!started || Math.abs(x - prevX) > seamPx) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
      prevX = x;
      started = true;
    }
  }

  pathCache.set(key, path);
  return path;
}

export function drawCoastlines(
  ctx: CanvasRenderingContext2D,
  projection: Projection,
  width: number,
  height: number,
  lineWidthPx = 1.5
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = lineWidthPx;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(getCoastlinePath(projection, width, height));
  ctx.restore();
}

const outlineCache = new Map<string, Path2D>();

function normalizeLonRad(lon: number): number {
  return (((lon + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

/**
 * Build a Path2D outlining the regional small-circle (centre + angular radius) projected through
 * `projection` into a width×height canvas. Uses the same seam-break heuristic as coastlines so
 * regions that wrap the dateline render as two arcs instead of a horizontal smear.
 */
function getRegionOutlinePath(
  projection: Projection,
  width: number,
  height: number,
  centerLonDeg: number,
  centerLatDeg: number,
  scaleDeg: number
): Path2D {
  // Cache key includes any params that change projection.forward(), so e.g. moving the twin
  // seam invalidates a stale path.
  let projParams = '';
  if (projection.id === 'lambert') {
    projParams = `/${lambertParams.centerLonDeg}/${lambertParams.centerLatDeg}/${lambertParams.scaleDeg}`;
  } else if (projection.id === 'orthographicTwin' || projection.id === 'stereographicTwin') {
    projParams = `/${twinParams.centerOffsetDeg}`;
  }
  const key = `${projection.id}${projParams}/${centerLonDeg}/${centerLatDeg}/${scaleDeg}/${width}x${height}`;
  const cached = outlineCache.get(key);
  if (cached) return cached;

  const path = new Path2D();
  const lon0 = (centerLonDeg * Math.PI) / 180;
  const lat0 = (centerLatDeg * Math.PI) / 180;
  const r = (scaleDeg * Math.PI) / 180;
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const sinR = Math.sin(r);
  const cosR = Math.cos(r);

  const N = 720;
  const seamPx = width * SEAM_FRACTION;
  let prevX = 0;
  let started = false;

  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * 2 * Math.PI;
    const sinLat = sinLat0 * cosR + cosLat0 * sinR * Math.cos(theta);
    const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    // atan2 + lon0 can push lon outside [-π, π]; normalise so equirectangular-style projections
    // don't map the boundary to u outside [0,1].
    const lon = normalizeLonRad(
      lon0 + Math.atan2(Math.sin(theta) * sinR * cosLat0, cosR - sinLat0 * sinLat)
    );
    const proj = projection.forward(lon, lat);
    if (!proj) {
      started = false;
      continue;
    }
    const x = proj.u * width;
    const y = proj.v * height;
    if (!started || Math.abs(x - prevX) > seamPx) {
      path.moveTo(x, y);
    } else {
      path.lineTo(x, y);
    }
    prevX = x;
    started = true;
  }

  outlineCache.set(key, path);
  return path;
}

export function drawRegionOutline(
  ctx: CanvasRenderingContext2D,
  projection: Projection,
  width: number,
  height: number,
  centerLonDeg: number,
  centerLatDeg: number,
  scaleDeg: number,
  lineWidthPx = 2
): void {
  // At full-sphere extent the boundary collapses to the antipode point — nothing useful to draw.
  if (scaleDeg >= 180) return;
  const path = getRegionOutlinePath(
    projection,
    width,
    height,
    centerLonDeg,
    centerLatDeg,
    scaleDeg
  );
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Dark halo first, then a saturated fill on top — keeps the outline legible over both bright
  // (e.g. equator over snow) and dark (e.g. ocean) source pixels.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = lineWidthPx + 2;
  ctx.stroke(path);
  ctx.strokeStyle = 'rgba(255, 196, 64, 0.95)';
  ctx.lineWidth = lineWidthPx;
  ctx.stroke(path);
  ctx.restore();
}
