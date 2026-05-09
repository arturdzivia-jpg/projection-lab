import type { Projection } from '../projections';
import { lambertParams } from '../projections/lambert';
import { twinParams } from '../projections/twinParams';
import { drawCoastlines, drawRegionOutline } from './coastlines';

/**
 * GPU-side projection conversion.
 *
 * Architecture:
 *  - One module-level WebGL2 context, shared by every convertImage call. Browsers cap the number of
 *    live WebGL contexts (~16); previously we created one per call and the cap was easily blown by
 *    drag/slider updates, which forced the browser to kill older contexts (including the globe's).
 *  - Programs are compiled once per (source, target) pair and cached.
 *  - The source texture is re-uploaded only when the input image reference changes.
 *  - Each call still returns a fresh 2D canvas (so callers can hold onto results independently),
 *    but the heavy GPU state is reused.
 *
 * Per pixel of the output (target):
 *   1. (lon, lat) = target.inverse(uv)
 *   2. srcLon = lonlat.x + lonShift, wrapped to [-π, π]
 *   3. src_uv = source.forward(srcLon, lonlat.y)
 *   4. sample source texture; out-of-domain pixels stay transparent
 *   5. optional grid overlay drawn from raw lonlat (independent of shift)
 */

const VERTEX_SHADER = `#version 300 es
  in vec2 a_pos;
  out vec2 v_uv;
  void main() {
    // a_pos is in clip space [-1,1]; map to [0,1] uv with y flipped so output image is upright.
    v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

export type GridHighlight = 'none' | 'axes' | 'axes+circles';

export interface GridOptions {
  enabled: boolean;
  spacingDeg: number; // typical: 5 / 10 / 15 / 30
  highlight: GridHighlight;
}

function highlightCode(h: GridHighlight): number {
  switch (h) {
    case 'axes':
      return 1;
    case 'axes+circles':
      return 2;
    default:
      return 0;
  }
}

function buildFragmentShader(source: Projection, target: Projection): string {
  return `#version 300 es
    precision highp float;

    in vec2 v_uv;
    out vec4 outColor;

    uniform sampler2D u_source;
    uniform float u_lonShiftRad;
    uniform float u_latShiftRad;
    uniform int u_grid;
    uniform float u_gridSpacingDeg;
    uniform int u_gridHighlight;
    // Twin-projection layout offset. Declared globally so multiple twin variants
    // (orthographicTwin + stereographicTwin) can share it without redeclaring.
    uniform float u_twinOffsetRad;

    const float PI = 3.14159265358979323846;
    const float HALF_PI = 1.57079632679489661923;
    const float MAX_LAT_MERCATOR = 1.4844222297453324; // atan(sinh(π))

    ${source.glsl}
    ${source.id === target.id ? '' : target.glsl}

    // fwidth(coordDeg) blows up at projection-domain boundaries (e.g. the disk rims of twin
    // projections, where the neighbouring fragment fell into the out-of-domain sentinel branch
    // of inverse()). Without a guard, d/w collapses and the smoothstep saturates to 1, painting
    // phantom lines along those rims — and those phantom pixels don't move when you change
    // spacing, so they look exactly like "the old grid persisted".
    float lineMask(float coordDeg, float spacingDeg, float halfWidthPx) {
      float w = fwidth(coordDeg);
      if (w <= 0.0 || w > spacingDeg * 0.5) return 0.0;
      float d = abs(mod(coordDeg + spacingDeg * 0.5, spacingDeg) - spacingDeg * 0.5);
      return 1.0 - smoothstep(halfWidthPx, halfWidthPx + 1.0, d / w);
    }

    float singleLineMask(float coordDeg, float lineDeg, float halfWidthPx) {
      float w = fwidth(coordDeg);
      // 10° is comfortably below the closest pair of highlights we draw (axis 0° vs tropic 23.4°),
      // so a legitimate near-line pixel never hits this cap.
      if (w <= 0.0 || w > 10.0) return 0.0;
      float d = abs(coordDeg - lineDeg);
      return 1.0 - smoothstep(halfWidthPx, halfWidthPx + 1.0, d / w);
    }

    void main() {
      vec2 lonlat = inverse_${target.id}(v_uv);

      // Source sampling: apply lat-shift (tilt around Y-axis in 3D), then lon-shift.
      // Order: target output point → R_y(-latShift) → R_z(lonShift) → source point.
      vec4 base = vec4(0.0);
      if (abs(lonlat.x) <= PI && abs(lonlat.y) <= HALF_PI + 1e-4) {
        float cLat = cos(lonlat.y);
        vec3 vT = vec3(cLat * cos(lonlat.x), cLat * sin(lonlat.x), sin(lonlat.y));
        float c = cos(u_latShiftRad);
        float s = sin(u_latShiftRad);
        vec3 v1 = vec3(c * vT.x - s * vT.z, vT.y, s * vT.x + c * vT.z);
        float lonTilted = atan(v1.y, v1.x);
        float latTilted = asin(clamp(v1.z, -1.0, 1.0));
        float srcLon = mod(lonTilted + u_lonShiftRad + PI, 2.0 * PI) - PI;
        vec2 src_uv = forward_${source.id}(vec2(srcLon, latTilted));
        if (src_uv.x >= 0.0 && src_uv.x <= 1.0 && src_uv.y >= 0.0 && src_uv.y <= 1.0) {
          base = texture(u_source, src_uv);
        }
      }

      // Out-of-domain pixels (e.g. the gap between twin disks) carry inverse()'s sentinel value,
      // which is far outside [-π, π] × [-π/2, π/2]. Skip the grid for those — both to keep them
      // transparent, and to avoid feeding garbage coords into lineMask via fwidth from neighbours.
      bool inDomain = abs(lonlat.x) <= PI + 1e-3 && abs(lonlat.y) <= HALF_PI + 1e-3;
      if (u_grid != 0 && inDomain) {
        vec2 lonlatDeg = degrees(lonlat);

        float gridLat = lineMask(lonlatDeg.y, u_gridSpacingDeg, 0.5);
        float gridLon = lineMask(lonlatDeg.x, u_gridSpacingDeg, 0.5);
        float gridM = max(gridLat, gridLon);
        vec3 gridColor = vec3(1.0);
        float gridAlpha = 0.55;
        base.rgb = mix(base.rgb, gridColor, gridM * gridAlpha);
        base.a = max(base.a, gridM * gridAlpha);

        if (u_gridHighlight >= 1) {
          float axisLat = singleLineMask(lonlatDeg.y, 0.0, 1.0);
          float axisLon = singleLineMask(lonlatDeg.x, 0.0, 1.0);
          float axisM = max(axisLat, axisLon);
          vec3 axisColor = vec3(1.0, 0.42, 0.24);
          float axisAlpha = 0.9;
          base.rgb = mix(base.rgb, axisColor, axisM * axisAlpha);
          base.a = max(base.a, axisM * axisAlpha);
        }

        if (u_gridHighlight >= 2) {
          float t1 = singleLineMask(lonlatDeg.y,  23.43681, 0.75);
          float t2 = singleLineMask(lonlatDeg.y, -23.43681, 0.75);
          float p1 = singleLineMask(lonlatDeg.y,  66.56319, 0.75);
          float p2 = singleLineMask(lonlatDeg.y, -66.56319, 0.75);
          float circM = max(max(t1, t2), max(p1, p2));
          vec3 circColor = vec3(0.36, 0.72, 1.0);
          float circAlpha = 0.85;
          base.rgb = mix(base.rgb, circColor, circM * circAlpha);
          base.a = max(base.a, circM * circAlpha);
        }
      }

      outColor = base;
    }
  `;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}\n${src}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}

interface ProgramRecord {
  program: WebGLProgram;
  posLoc: number;
  uniforms: {
    source: WebGLUniformLocation | null;
    lonShift: WebGLUniformLocation | null;
    latShift: WebGLUniformLocation | null;
    grid: WebGLUniformLocation | null;
    gridSpacing: WebGLUniformLocation | null;
    gridHighlight: WebGLUniformLocation | null;
    // Region-projection params (Lambert). null when the program doesn't reference them.
    lambertCenterLon: WebGLUniformLocation | null;
    lambertCenterLat: WebGLUniformLocation | null;
    lambertScale: WebGLUniformLocation | null;
    // Twin-projection layout offset. null when the program doesn't reference it.
    twinOffset: WebGLUniformLocation | null;
  };
}

interface Renderer {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  vs: WebGLShader;
  vertexBuffer: WebGLBuffer;
  texture: WebGLTexture;
  programs: Map<string, ProgramRecord>;
  lastUploadedImage: TexImageSource | null;
  maxTex: number;
  // Smallest of MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE, MAX_VIEWPORT_DIMS[xy].
  // The browser silently clamps the drawing buffer above this, producing blank renders.
  maxOutput: number;
}

let renderer: Renderer | null = null;

function getRenderer(): Renderer {
  if (renderer) return renderer;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // we read via drawImage(this canvas, ...) after each draw
    antialias: false,
  });
  if (!gl) throw new Error('WebGL2 is not supported in this browser.');

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);

  const vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) throw new Error('Failed to allocate vertex buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    // prettier-ignore
    new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ]),
    gl.STATIC_DRAW
  );

  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to allocate texture');
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // If the GPU resets and the context is lost, drop our cache so the next call rebuilds cleanly.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderer = null;
  });

  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const reportedMax = Math.min(maxTex, maxRb, viewport[0], viewport[1]);

  // Browsers (especially ANGLE on Windows) silently clamp the WebGL drawing buffer below the
  // GL-reported limits, often around 5–6k per side regardless of what MAX_TEXTURE_SIZE claims.
  // Probe N×N (worst-case for Mercator) until the canvas survives without clamping.
  let maxOutput = 1024;
  for (const n of [16384, 8192, 4096, 2048, 1024]) {
    if (n > reportedMax) continue;
    canvas.width = n;
    canvas.height = n;
    if (gl.drawingBufferWidth === n && gl.drawingBufferHeight === n) {
      maxOutput = n;
      break;
    }
  }
  canvas.width = 1;
  canvas.height = 1;

  renderer = {
    canvas,
    gl,
    vs,
    vertexBuffer,
    texture,
    programs: new Map(),
    lastUploadedImage: null,
    maxTex,
    maxOutput,
  };
  return renderer;
}

/** Largest output dimension this device's WebGL2 can safely render without silent clamping. */
export function getMaxOutputSize(): number {
  try {
    return getRenderer().maxOutput;
  } catch {
    return 4096;
  }
}

function getProgram(r: Renderer, source: Projection, target: Projection): ProgramRecord {
  const key = `${source.id}->${target.id}`;
  const existing = r.programs.get(key);
  if (existing) return existing;

  const fs = compileShader(r.gl, r.gl.FRAGMENT_SHADER, buildFragmentShader(source, target));
  const program = linkProgram(r.gl, r.vs, fs);
  r.gl.deleteShader(fs); // safe to delete: still attached and the program holds a reference

  const rec: ProgramRecord = {
    program,
    posLoc: r.gl.getAttribLocation(program, 'a_pos'),
    uniforms: {
      source: r.gl.getUniformLocation(program, 'u_source'),
      lonShift: r.gl.getUniformLocation(program, 'u_lonShiftRad'),
      latShift: r.gl.getUniformLocation(program, 'u_latShiftRad'),
      grid: r.gl.getUniformLocation(program, 'u_grid'),
      gridSpacing: r.gl.getUniformLocation(program, 'u_gridSpacingDeg'),
      gridHighlight: r.gl.getUniformLocation(program, 'u_gridHighlight'),
      lambertCenterLon: r.gl.getUniformLocation(program, 'u_lambertCenterLonRad'),
      lambertCenterLat: r.gl.getUniformLocation(program, 'u_lambertCenterLatRad'),
      lambertScale: r.gl.getUniformLocation(program, 'u_lambertScaleRad'),
      twinOffset: r.gl.getUniformLocation(program, 'u_twinOffsetRad'),
    },
  };
  r.programs.set(key, rec);
  return rec;
}

export interface ConvertOptions {
  source: Projection;
  target: Projection;
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  outputWidth: number;
  outputHeight: number;
  grid?: GridOptions;
  // Longitude offset in degrees. Source content at (lon=lonShiftDeg) appears at the centre of the output.
  // Positive = east, negative = west. Map is cyclic in longitude, so values wrap.
  lonShiftDeg?: number;
  // Latitude offset in degrees, [-90, 90]. Source content at (lat=latShiftDeg) appears at the centre.
  // Positive = bring north toward centre. Implemented as a 3D rotation around an equatorial axis,
  // not as an image shift — latitude is not cyclic and the poles are points, not edges.
  latShiftDeg?: number;
  // Region projection (Lambert) parameters. Used whenever source or target is 'lambert'.
  // centerLonDeg/centerLatDeg pick where on the globe the regional view is centred;
  // scaleDeg is the angular radius shown (e.g. 90 = full hemisphere, 30 = small region).
  regionalCenterLonDeg?: number;
  regionalCenterLatDeg?: number;
  regionalScaleDeg?: number;
  // Twin-projection layout offset (degrees). Rotates both disk centres in lockstep — used
  // whenever source or target is 'orthographicTwin' or 'stereographicTwin'.
  twinOffsetDeg?: number;
  // Overlay real Earth coastlines on top of the result. Drawn at true geographic coordinates and
  // therefore unaffected by lonShiftDeg — they sit in the same fixed frame as the grid.
  coastlines?: boolean;
  // Overlay the regional small-circle outline (centre + angular radius from the regional* params)
  // on top of the result, projected through `target`. Used on the source preview to show which
  // patch of the world a regional target is going to capture.
  regionOutline?: boolean;
}

/**
 * Returns a fresh 2D canvas containing the converted image. The caller can hold onto it
 * independently of further calls — internal GPU state is shared but the result is copied out.
 */
export function convertImage(opts: ConvertOptions): HTMLCanvasElement {
  const {
    source,
    target,
    image,
    outputWidth,
    outputHeight,
    grid,
    lonShiftDeg = 0,
    latShiftDeg = 0,
    regionalCenterLonDeg = 0,
    regionalCenterLatDeg = 0,
    regionalScaleDeg = 90,
    twinOffsetDeg = 0,
    coastlines = false,
    regionOutline = false,
  } = opts;

  // Sync the CPU-side mutable params used by the projection's forward()/inverse()
  // (which the coastline drawer reads) with whatever the caller passed in.
  lambertParams.centerLonDeg = regionalCenterLonDeg;
  lambertParams.centerLatDeg = regionalCenterLatDeg;
  lambertParams.scaleDeg = regionalScaleDeg;
  twinParams.centerOffsetDeg = twinOffsetDeg;

  const r = getRenderer();
  const { gl } = r;

  const imgW = 'width' in image ? image.width : 0;
  const imgH = 'height' in image ? image.height : 0;
  if (imgW > r.maxTex || imgH > r.maxTex) {
    throw new Error(
      `Image is ${imgW}×${imgH}, exceeds WebGL max texture size ${r.maxTex}. Resize the image first.`
    );
  }
  if (outputWidth > r.maxOutput || outputHeight > r.maxOutput) {
    throw new Error(
      `Output ${outputWidth}×${outputHeight} exceeds this GPU's safe limit of ${r.maxOutput}. Pick a smaller output size.`
    );
  }

  if (r.canvas.width !== outputWidth || r.canvas.height !== outputHeight) {
    r.canvas.width = outputWidth;
    r.canvas.height = outputHeight;
  }
  // Some browsers/GPUs clamp the drawing buffer below the canvas size without surfacing an error;
  // catching it here turns a silent blank render into a visible message.
  if (gl.drawingBufferWidth !== outputWidth || gl.drawingBufferHeight !== outputHeight) {
    throw new Error(
      `Browser clamped the drawing buffer to ${gl.drawingBufferWidth}×${gl.drawingBufferHeight}; ` +
        `requested ${outputWidth}×${outputHeight}. Pick a smaller output size.`
    );
  }

  const rec = getProgram(r, source, target);

  gl.useProgram(rec.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, r.vertexBuffer);
  gl.enableVertexAttribArray(rec.posLoc);
  gl.vertexAttribPointer(rec.posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, r.texture);
  // Skip re-upload when caller passes the same image reference as last time.
  if (r.lastUploadedImage !== image) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
    r.lastUploadedImage = image;
  }

  gl.uniform1i(rec.uniforms.source, 0);
  gl.uniform1f(rec.uniforms.lonShift, (lonShiftDeg * Math.PI) / 180);
  gl.uniform1f(rec.uniforms.latShift, (latShiftDeg * Math.PI) / 180);
  gl.uniform1i(rec.uniforms.grid, grid?.enabled ? 1 : 0);
  gl.uniform1f(rec.uniforms.gridSpacing, grid?.spacingDeg ?? 15);
  gl.uniform1i(rec.uniforms.gridHighlight, grid ? highlightCode(grid.highlight) : 0);
  // Lambert uniforms only exist in programs where source or target is 'lambert'.
  // Calling gl.uniform with a null location is an error, so guard.
  if (rec.uniforms.lambertCenterLon !== null) {
    gl.uniform1f(rec.uniforms.lambertCenterLon, (regionalCenterLonDeg * Math.PI) / 180);
  }
  if (rec.uniforms.lambertCenterLat !== null) {
    gl.uniform1f(rec.uniforms.lambertCenterLat, (regionalCenterLatDeg * Math.PI) / 180);
  }
  if (rec.uniforms.lambertScale !== null) {
    gl.uniform1f(rec.uniforms.lambertScale, (regionalScaleDeg * Math.PI) / 180);
  }
  if (rec.uniforms.twinOffset !== null) {
    gl.uniform1f(rec.uniforms.twinOffset, (twinOffsetDeg * Math.PI) / 180);
  }

  gl.viewport(0, 0, outputWidth, outputHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Copy out to a 2D canvas so the caller can keep the result while the next call reuses our GL canvas.
  const dst = document.createElement('canvas');
  dst.width = outputWidth;
  dst.height = outputHeight;
  const ctx = dst.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');
  ctx.drawImage(r.canvas, 0, 0);

  if (coastlines) {
    drawCoastlines(ctx, target, outputWidth, outputHeight);
  }

  if (regionOutline) {
    drawRegionOutline(
      ctx,
      target,
      outputWidth,
      outputHeight,
      regionalCenterLonDeg,
      regionalCenterLatDeg,
      regionalScaleDeg
    );
  }

  return dst;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type);
  });
}
