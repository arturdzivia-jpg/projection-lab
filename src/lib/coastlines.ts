import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import landTopoJson from 'world-atlas/land-110m.json';
import type { Projection } from '../projections';
import { lambertParams } from '../projections/lambert';

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
  // For parameterised projections (Lambert), include the params so the cache invalidates when the
  // user moves the regional centre or zoom. For others, the projection id alone uniquely keys the path.
  const key =
    projection.id === 'lambert'
      ? `lambert/${lambertParams.centerLonDeg}/${lambertParams.centerLatDeg}/${lambertParams.scaleDeg}/${width}x${height}`
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
