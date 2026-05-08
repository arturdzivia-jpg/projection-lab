import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Uploader } from './components/Uploader';
import { GlobeView } from './components/GlobeView';
import { projectionList, getProjection, isRegional } from './projections/registry';
import { equirectangular } from './projections/equirectangular';
import type { Projection, ProjectionId } from './projections';
import {
  canvasToBlob,
  convertImage,
  getMaxOutputSize,
  type GridHighlight,
  type GridOptions,
} from './lib/convert';
import { aspectMismatch, normalizeAspect, type FitMode } from './lib/normalize';

// On-screen previews render at this fixed size (per side). Decoupled from download size — previews
// only need to look crisp in a ~480 px panel, while downloads go up to the GPU's true cap.
const PREVIEW_SIZE = 1024;

function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [sourceId, setSourceId] = useState<ProjectionId>('equirectangular');
  const [targetId, setTargetId] = useState<ProjectionId>('mercator');
  const [fit, setFit] = useState<FitMode>('stretch');
  const [gridEnabled, setGridEnabled] = useState<boolean>(true);
  const [gridSpacing, setGridSpacing] = useState<number>(15);
  const [gridHighlight, setGridHighlight] = useState<GridHighlight>('axes');
  const [lonShift, setLonShift] = useState<number>(0); // degrees, [-180, 180]
  const [latShift, setLatShift] = useState<number>(0); // degrees, clamped [-90, 90]
  // Region (Lambert) parameters — used whenever source or target is 'lambert'.
  const [regionLon, setRegionLon] = useState<number>(0); // degrees [-180, 180]
  const [regionLat, setRegionLat] = useState<number>(0); // degrees [-90, 90]
  const [regionScale, setRegionScale] = useState<number>(60); // angular radius in degrees, [5, 180]
  const [coastlines, setCoastlines] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  // Pan handler shared by source + target previews. `dx` and `dy` are mouse deltas as fractions of the
  // canvas display dimensions. Drag right decreases central longitude (content slides right under the
  // fixed grid). Drag down increases central latitude (north tilts toward centre). The grid stays put.
  const handlePan = useCallback((dx: number, dy: number) => {
    if (dx !== 0) setLonShift((s) => normalizeLon(s - dx * 360));
    if (dy !== 0) setLatShift((s) => clamp(s + dy * 180, -90, 90));
  }, []);

  const sourceProjection = getProjection(sourceId);
  const targetProjection = getProjection(targetId);
  const regionalActive = isRegional(sourceId) || isRegional(targetId);
  // When regional is active, the regional centre fully replaces lon/lat shift — pass 0 to the shader.
  const effLonShift = regionalActive ? 0 : lonShift;
  const effLatShift = regionalActive ? 0 : latShift;

  const maxOutputSize = useMemo(() => getMaxOutputSize(), []);

  const grid = useMemo<GridOptions>(
    () => ({ enabled: gridEnabled, spacingDeg: gridSpacing, highlight: gridHighlight }),
    [gridEnabled, gridSpacing, gridHighlight]
  );

  // Base canvas: input image normalized to source projection's expected aspect. Internal — never displayed directly.
  const baseCanvas = useMemo<HTMLCanvasElement | null>(() => {
    if (!image) return null;
    return normalizeAspect(image, sourceProjection.defaultAspect, fit);
  }, [image, sourceProjection, fit]);

  // Source preview: same projection round-trip through the shader so the grid can be overlaid.
  const sourcePreview = useMemo<HTMLCanvasElement | null>(() => {
    if (!baseCanvas) return null;
    try {
      const aspect = sourceProjection.defaultAspect;
      const outW = aspect >= 1 ? PREVIEW_SIZE : Math.round(PREVIEW_SIZE * aspect);
      const outH = aspect >= 1 ? Math.round(PREVIEW_SIZE / aspect) : PREVIEW_SIZE;
      return convertImage({
        source: sourceProjection,
        target: sourceProjection,
        image: baseCanvas,
        outputWidth: outW,
        outputHeight: outH,
        grid,
        lonShiftDeg: effLonShift,
        latShiftDeg: effLatShift,
        regionalCenterLonDeg: regionLon,
        regionalCenterLatDeg: regionLat,
        regionalScaleDeg: regionScale,
        coastlines,
      });
    } catch {
      return baseCanvas;
    }
  }, [baseCanvas, sourceProjection, grid, effLonShift, effLatShift, regionLon, regionLat, regionScale, coastlines]);

  // Target canvas: source converted to target projection. Capture error alongside the canvas.
  const targetResult = useMemo<{ canvas: HTMLCanvasElement | null; error: string | null }>(() => {
    if (!baseCanvas) return { canvas: null, error: null };
    try {
      const aspect = targetProjection.defaultAspect;
      const outW = aspect >= 1 ? PREVIEW_SIZE : Math.round(PREVIEW_SIZE * aspect);
      const outH = aspect >= 1 ? Math.round(PREVIEW_SIZE / aspect) : PREVIEW_SIZE;
      const canvas = convertImage({
        source: sourceProjection,
        target: targetProjection,
        image: baseCanvas,
        outputWidth: outW,
        outputHeight: outH,
        grid,
        lonShiftDeg: effLonShift,
        latShiftDeg: effLatShift,
        regionalCenterLonDeg: regionLon,
        regionalCenterLatDeg: regionLat,
        regionalScaleDeg: regionScale,
        coastlines,
      });
      return { canvas, error: null };
    } catch (e) {
      return { canvas: null, error: (e as Error).message };
    }
  }, [baseCanvas, sourceProjection, targetProjection, grid, effLonShift, effLatShift, regionLon, regionLat, regionScale, coastlines]);
  const targetCanvas = targetResult.canvas;

  useEffect(() => {
    setError(targetResult.error);
  }, [targetResult.error]);

  // Globe always reads an equirectangular texture. If target is already equirectangular, reuse the target canvas.
  const globeCanvas = useMemo<HTMLCanvasElement | null>(() => {
    if (!baseCanvas) return null;
    if (targetId === 'equirectangular' && targetCanvas) return targetCanvas;
    try {
      return convertImage({
        source: sourceProjection,
        target: equirectangular,
        image: baseCanvas,
        outputWidth: PREVIEW_SIZE,
        outputHeight: PREVIEW_SIZE / 2,
        grid,
        lonShiftDeg: effLonShift,
        latShiftDeg: effLatShift,
        regionalCenterLonDeg: regionLon,
        regionalCenterLatDeg: regionLat,
        regionalScaleDeg: regionScale,
        coastlines,
      });
    } catch {
      return null;
    }
  }, [baseCanvas, sourceProjection, targetId, targetCanvas, grid, effLonShift, effLatShift, regionLon, regionLat, regionScale, coastlines]);

  const sourceMismatch = image
    ? aspectMismatch(image.width / image.height, sourceProjection.defaultAspect)
    : false;

  if (!image) {
    return (
      <div className="upload-screen">
        <header className="upload-screen__header">
          <h1>Map Projector</h1>
          <p>Convert map images between projections.</p>
        </header>
        <Uploader
          onImage={(img, name) => {
            setImage(img);
            setFilename(name);
            setError(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? '' : 'sidebar--collapsed'}`}>
        <div className="sidebar__head">
          {sidebarOpen && <span className="sidebar__title">Map Projector</span>}
          <button
            className="sidebar__toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? '«' : '»'}
          </button>
        </div>
        {sidebarOpen && (
          <div className="sidebar__body">
            <Field label="Source projection">
              <ProjectionPicker value={sourceId} onChange={setSourceId} />
            </Field>
            <Field label="Target projection">
              <ProjectionPicker value={targetId} onChange={setTargetId} />
            </Field>
            <Field
              label={`Fit ${sourceMismatch ? '⚠' : ''}`}
              hint={
                sourceMismatch
                  ? `Image is ${image.width}×${image.height}, but ${sourceProjection.label} expects ${sourceProjection.defaultAspect}:1.`
                  : undefined
              }
            >
              <select value={fit} onChange={(e) => setFit(e.target.value as FitMode)}>
                <option value="stretch">Stretch</option>
                <option value="contain">Letterbox (contain)</option>
                <option value="cover">Crop (cover)</option>
              </select>
            </Field>
            <Field label="Grid">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={gridEnabled}
                  onChange={(e) => setGridEnabled(e.target.checked)}
                />
                <span>Show grid</span>
              </label>
            </Field>
            <Field label="Grid spacing">
              <select
                value={gridSpacing}
                disabled={!gridEnabled}
                onChange={(e) => setGridSpacing(Number(e.target.value))}
              >
                <option value={5}>5°</option>
                <option value={10}>10°</option>
                <option value={15}>15°</option>
                <option value={30}>30°</option>
              </select>
            </Field>
            <Field label="Highlight">
              <select
                value={gridHighlight}
                disabled={!gridEnabled}
                onChange={(e) => setGridHighlight(e.target.value as GridHighlight)}
              >
                <option value="none">None</option>
                <option value="axes">Equator + prime meridian</option>
                <option value="axes+circles">Plus tropics & polar circles</option>
              </select>
            </Field>
            <Field label="Coastlines">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={coastlines}
                  onChange={(e) => setCoastlines(e.target.checked)}
                />
                <span>Real Earth</span>
              </label>
            </Field>
            {regionalActive ? (
              <>
                <Field
                  label="Region center lon"
                  hint="Where on the globe the regional view is centred"
                >
                  <div className="slider-row">
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      step={1}
                      value={Number(regionLon.toFixed(2))}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '' || v === '-') return;
                        const n = Number(v);
                        if (!Number.isFinite(n)) return;
                        setRegionLon(normalizeLon(n));
                      }}
                      className="number-input"
                    />
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step="any"
                      value={regionLon}
                      onChange={(e) => setRegionLon(Number(e.target.value))}
                      className="slider"
                    />
                  </div>
                </Field>
                <Field label="Region center lat">
                  <div className="slider-row">
                    <input
                      type="number"
                      min={-90}
                      max={90}
                      step={1}
                      value={Number(regionLat.toFixed(2))}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '' || v === '-') return;
                        const n = Number(v);
                        if (!Number.isFinite(n)) return;
                        setRegionLat(clamp(n, -90, 90));
                      }}
                      className="number-input"
                    />
                    <input
                      type="range"
                      min={-90}
                      max={90}
                      step="any"
                      value={regionLat}
                      onChange={(e) => setRegionLat(Number(e.target.value))}
                      className="slider"
                    />
                  </div>
                </Field>
                <Field
                  label="Region scale"
                  hint={`${regionScale.toFixed(0)}° angular radius (90° = hemisphere)`}
                >
                  <div className="slider-row">
                    <input
                      type="number"
                      min={5}
                      max={180}
                      step={1}
                      value={Number(regionScale.toFixed(0))}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') return;
                        const n = Number(v);
                        if (!Number.isFinite(n)) return;
                        setRegionScale(clamp(n, 5, 180));
                      }}
                      className="number-input"
                    />
                    <input
                      type="range"
                      min={5}
                      max={180}
                      step={1}
                      value={regionScale}
                      onChange={(e) => setRegionScale(Number(e.target.value))}
                      className="slider"
                    />
                  </div>
                </Field>
              </>
            ) : (
              <>
                <Field label="Center longitude">
                  <div className="slider-row">
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      step={1}
                      value={Number(lonShift.toFixed(2))}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '' || v === '-') return;
                        const n = Number(v);
                        if (!Number.isFinite(n)) return;
                        setLonShift(normalizeLon(n));
                      }}
                      className="number-input"
                    />
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step="any"
                      value={lonShift}
                      onChange={(e) => setLonShift(Number(e.target.value))}
                      className="slider"
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--mini"
                      onClick={() => setLonShift(0)}
                      disabled={lonShift === 0}
                    >
                      Reset
                    </button>
                  </div>
                </Field>
                <Field label="Center latitude">
                  <div className="slider-row">
                    <input
                      type="number"
                      min={-90}
                      max={90}
                      step={1}
                      value={Number(latShift.toFixed(2))}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '' || v === '-') return;
                        const n = Number(v);
                        if (!Number.isFinite(n)) return;
                        setLatShift(clamp(n, -90, 90));
                      }}
                      className="number-input"
                    />
                    <input
                      type="range"
                      min={-90}
                      max={90}
                      step="any"
                      value={latShift}
                      onChange={(e) => setLatShift(Number(e.target.value))}
                      className="slider"
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--mini"
                      onClick={() => setLatShift(0)}
                      disabled={latShift === 0}
                    >
                      Reset
                    </button>
                  </div>
                </Field>
              </>
            )}
            <div className="sidebar__actions">
              <button
                className="btn"
                onClick={() => setDownloadOpen(true)}
                disabled={!baseCanvas}
              >
                Download…
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  setImage(null);
                  setFilename('');
                  setError(null);
                }}
              >
                New image
              </button>
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        {error && <div className="error">{error}</div>}

        <div className="panels">
          <Panel title={`Source · ${sourceProjection.label}`} subtitle={filename}>
            <CanvasView canvas={sourcePreview} onPan={regionalActive ? undefined : handlePan} />
          </Panel>
          <Panel title={`Target · ${targetProjection.label}`}>
            <CanvasView canvas={targetCanvas} onPan={regionalActive ? undefined : handlePan} />
          </Panel>
          <Panel title="Globe view" subtitle="Drag to rotate · scroll to zoom" wide>
            <GlobeView equirectangular={globeCanvas} />
          </Panel>
        </div>
      </main>

      <DownloadDialog
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        baseCanvas={baseCanvas}
        sourceProjection={sourceProjection}
        grid={grid}
        lonShift={effLonShift}
        latShift={effLatShift}
        regionLon={regionLon}
        regionLat={regionLat}
        regionScale={regionScale}
        coastlines={coastlines}
        filename={filename}
        maxOutputSize={maxOutputSize}
        defaultProjection={targetId}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function ProjectionPicker({
  value,
  onChange,
}: {
  value: ProjectionId;
  onChange: (id: ProjectionId) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ProjectionId)}>
      {projectionList.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

function Panel({
  title,
  subtitle,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`panel ${wide ? 'panel--wide' : ''}`}>
      <header className="panel__header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="panel__sub">{subtitle}</p>}
        </div>
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

function CanvasView({
  canvas,
  onPan,
}: {
  canvas: HTMLCanvasElement | null;
  // Reports each mousemove as (dx, dy) where each is the delta normalized by host display dimensions.
  onPan?: (dx: number, dy: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onPanRef = useRef(onPan);
  useEffect(() => {
    onPanRef.current = onPan;
  }, [onPan]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    if (canvas) {
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '100%';
      canvas.style.objectFit = 'contain';
      host.appendChild(canvas);
    }
  }, [canvas]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: MouseEvent) => {
      if (!onPanRef.current) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      host.classList.add('canvas-host--grabbing');
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging || !onPanRef.current) return;
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dx = (e.clientX - lastX) / rect.width;
      const dy = (e.clientY - lastY) / rect.height;
      lastX = e.clientX;
      lastY = e.clientY;
      onPanRef.current(dx, dy);
    };
    const onUp = () => {
      if (dragging) host.classList.remove('canvas-host--grabbing');
      dragging = false;
    };

    host.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      host.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div
      className={`canvas-host ${onPan ? 'canvas-host--pannable' : ''}`}
      ref={hostRef}
    />
  );
}

function DownloadDialog({
  open,
  onClose,
  baseCanvas,
  sourceProjection,
  grid,
  lonShift,
  latShift,
  regionLon,
  regionLat,
  regionScale,
  coastlines,
  filename,
  maxOutputSize,
  defaultProjection,
}: {
  open: boolean;
  onClose: () => void;
  baseCanvas: HTMLCanvasElement | null;
  sourceProjection: Projection;
  grid: GridOptions;
  lonShift: number;
  latShift: number;
  regionLon: number;
  regionLat: number;
  regionScale: number;
  coastlines: boolean;
  filename: string;
  maxOutputSize: number;
  defaultProjection: ProjectionId;
}) {
  const [proj, setProj] = useState<ProjectionId>(defaultProjection);
  const [size, setSize] = useState<number>(2048);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sizeOptions = useMemo(
    () => [1024, 2048, 4096, 8192].filter((s) => s <= maxOutputSize),
    [maxOutputSize]
  );

  // Keep size within the available options.
  useEffect(() => {
    if (!sizeOptions.includes(size)) {
      setSize(sizeOptions[sizeOptions.length - 1] ?? 1024);
    }
  }, [size, sizeOptions]);

  // Reset transient state on each open; sync default projection.
  useEffect(() => {
    if (open) {
      setProj(defaultProjection);
      setErr(null);
      setBusy(false);
    }
  }, [open, defaultProjection]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const targetProj = getProjection(proj);
  const aspect = targetProj.defaultAspect;
  const outW = aspect >= 1 ? size : Math.round(size * aspect);
  const outH = aspect >= 1 ? Math.round(size / aspect) : size;

  const handleDownload = async () => {
    if (!baseCanvas) return;
    setBusy(true);
    setErr(null);
    try {
      // For the dialog, the dialog-supplied lon/lat shift values already reflect the regionalActive
      // override (the parent passed effLonShift/effLatShift). The user may pick a target projection
      // different from the on-screen target, so re-evaluate whether regional is active for THIS download.
      const dialogRegionalActive = sourceProjection.id === 'lambert' || targetProj.id === 'lambert';
      const canvas = convertImage({
        source: sourceProjection,
        target: targetProj,
        image: baseCanvas,
        outputWidth: outW,
        outputHeight: outH,
        grid,
        lonShiftDeg: dialogRegionalActive ? 0 : lonShift,
        latShiftDeg: dialogRegionalActive ? 0 : latShift,
        regionalCenterLonDeg: regionLon,
        regionalCenterLatDeg: regionLat,
        regionalScaleDeg: regionScale,
        coastlines,
      });
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName(filename, proj);
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Download map"
      >
        <h2>Download map</h2>
        <Field label="Projection">
          <select value={proj} onChange={(e) => setProj(e.target.value as ProjectionId)}>
            {projectionList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Size"
          hint={`Output: ${outW} × ${outH} px`}
        >
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {sizeOptions.map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        </Field>
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={handleDownload} disabled={busy || !baseCanvas}>
            {busy ? 'Rendering…' : 'Download PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}

function downloadName(input: string, target: ProjectionId): string {
  const base = input.replace(/\.[^.]+$/, '') || 'map';
  return `${base}.${target}.png`;
}

function normalizeLon(deg: number): number {
  return (((deg + 180) % 360) + 360) % 360 - 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default App;
