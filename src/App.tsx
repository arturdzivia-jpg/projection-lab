import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Uploader } from './components/Uploader';
import { GlobeView } from './components/GlobeView';
import { Field } from './components/Field';
import { InputRow } from './components/InputRow';
import {
  RegionParamsEditor,
  TwinOffsetEditor,
} from './components/RegionParamsEditor';
import { projectionList, getProjection, isRegional, isTwin } from './projections/registry';
import { equirectangular } from './projections/equirectangular';
import type { ProjectionId } from './projections';
import {
  canvasToBlob,
  convertImage,
  getMaxOutputSize,
  type GridHighlight,
  type GridOptions,
} from './lib/convert';
import {
  buildComposite,
  COMPOSITE_FULL,
  COMPOSITE_PREVIEW,
} from './lib/composite';
import {
  buildDownloadName,
  createInput,
  removeInput,
  reorderInput,
  updateInput,
  type RegionalInput,
} from './lib/regionalInputs';
import { clamp, normalizeLon } from './lib/numUtils';

// On-screen panels render at this fixed size (per long side). Independent of download size — the
// download path rebuilds the composite at COMPOSITE_FULL for higher fidelity.
const PREVIEW_SIZE = 1024;

function App() {
  // Regional inputs — the user assembles their world from these.
  const [inputs, setInputs] = useState<RegionalInput[]>([]);
  const [activeInputId, setActiveInputId] = useState<string | null>(null);

  const [targetId, setTargetId] = useState<ProjectionId>('mercator');
  const [gridEnabled, setGridEnabled] = useState<boolean>(true);
  const [gridSpacing, setGridSpacing] = useState<number>(15);
  const [gridHighlight, setGridHighlight] = useState<GridHighlight>('axes');
  // Composite-framing controls: rotate the assembled equirectangular world before target conversion.
  const [lonShift, setLonShift] = useState<number>(0); // degrees, [-180, 180]
  const [latShift, setLatShift] = useState<number>(0); // degrees, clamped [-90, 90]
  // TARGET regional (Lambert) params — only meaningful when targetId === 'lambert'.
  const [regionLon, setRegionLon] = useState<number>(0);
  const [regionLat, setRegionLat] = useState<number>(0);
  const [regionScale, setRegionScale] = useState<number>(60);
  // TARGET twin-projection layout offset — only meaningful when target is a twin projection.
  const [targetTwinOffset, setTargetTwinOffset] = useState<number>(0);
  const [coastlines, setCoastlines] = useState<boolean>(false);

  const [error, setError] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [fullscreen, setFullscreen] = useState<'composite' | 'target' | 'globe' | null>(null);

  // Esc exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const targetProjection = getProjection(targetId);
  const targetRegional = isRegional(targetId);
  const targetTwin = isTwin(targetId);
  // Composite framing only applies when the target is global. For Lambert / twin targets the
  // target's own params (centre, seam) determine the framing — passing a separate lon/lat shift
  // would double-rotate the world.
  const effLonShift = targetRegional ? 0 : lonShift;
  const effLatShift = targetRegional ? 0 : latShift;
  const effTargetTwinOffset = targetTwin ? targetTwinOffset : 0;

  const activeInput = useMemo(
    () => (activeInputId ? inputs.find((i) => i.id === activeInputId) ?? null : null),
    [activeInputId, inputs]
  );

  const maxOutputSize = useMemo(() => getMaxOutputSize(), []);

  const grid = useMemo<GridOptions>(
    () => ({ enabled: gridEnabled, spacingDeg: gridSpacing, highlight: gridHighlight }),
    [gridEnabled, gridSpacing, gridHighlight]
  );

  // Assembled equirectangular world from all inputs. Recomputes when inputs change. Render-only
  // settings (target, lon/lat shift, grid, coastlines) don't invalidate this — they apply later.
  const composite = useMemo<HTMLCanvasElement | null>(() => {
    if (inputs.length === 0) return null;
    try {
      return buildComposite(inputs, COMPOSITE_PREVIEW);
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [inputs]);

  // Composite preview panel: feed the composite back through the shader as equirectangular →
  // equirectangular so the grid overlay continues to work via the existing pipeline. Region
  // outline lights up only when an input row is "active" (clicked / expanded).
  const compositePreview = useMemo<HTMLCanvasElement | null>(() => {
    if (!composite) return null;
    const outW = PREVIEW_SIZE;
    const outH = PREVIEW_SIZE / 2;
    try {
      const showOutline = !!activeInput && activeInput.projectionId === 'lambert';
      return convertImage({
        source: equirectangular,
        target: equirectangular,
        image: composite,
        outputWidth: outW,
        outputHeight: outH,
        grid,
        // Composite preview shows the world in its raw frame — no shift applied.
        lonShiftDeg: 0,
        latShiftDeg: 0,
        regionalCenterLonDeg: activeInput?.lambert.lon ?? 0,
        regionalCenterLatDeg: activeInput?.lambert.lat ?? 0,
        regionalScaleDeg: activeInput?.lambert.scale ?? 90,
        twinOffsetDeg: 0,
        coastlines: false,
        regionOutline: showOutline,
      });
    } catch {
      return composite;
    }
  }, [composite, grid, activeInput]);

  // Target panel: composite → user-chosen target. Captures error alongside the canvas so we can
  // show "GPU clamp"-style messages without losing the rest of the UI.
  const targetResult = useMemo<{ canvas: HTMLCanvasElement | null; error: string | null }>(() => {
    if (!composite) return { canvas: null, error: null };
    try {
      const aspect = targetProjection.defaultAspect;
      const outW = aspect >= 1 ? PREVIEW_SIZE : Math.round(PREVIEW_SIZE * aspect);
      const outH = aspect >= 1 ? Math.round(PREVIEW_SIZE / aspect) : PREVIEW_SIZE;
      const canvas = convertImage({
        source: equirectangular,
        target: targetProjection,
        image: composite,
        outputWidth: outW,
        outputHeight: outH,
        grid,
        lonShiftDeg: effLonShift,
        latShiftDeg: effLatShift,
        regionalCenterLonDeg: regionLon,
        regionalCenterLatDeg: regionLat,
        regionalScaleDeg: regionScale,
        twinOffsetDeg: effTargetTwinOffset,
        coastlines,
      });
      return { canvas, error: null };
    } catch (e) {
      return { canvas: null, error: (e as Error).message };
    }
  }, [
    composite,
    targetProjection,
    grid,
    effLonShift,
    effLatShift,
    regionLon,
    regionLat,
    regionScale,
    effTargetTwinOffset,
    coastlines,
  ]);
  const targetCanvas = targetResult.canvas;

  useEffect(() => {
    setError(targetResult.error);
  }, [targetResult.error]);

  // Globe always reads an equirectangular texture. If target is already equirectangular and no
  // shift / coastlines are applied, reuse the target canvas directly.
  const globeCanvas = useMemo<HTMLCanvasElement | null>(() => {
    if (!composite) return null;
    if (targetId === 'equirectangular' && targetCanvas) return targetCanvas;
    try {
      return convertImage({
        source: equirectangular,
        target: equirectangular,
        image: composite,
        outputWidth: PREVIEW_SIZE,
        outputHeight: PREVIEW_SIZE / 2,
        grid,
        lonShiftDeg: effLonShift,
        latShiftDeg: effLatShift,
        regionalCenterLonDeg: regionLon,
        regionalCenterLatDeg: regionLat,
        regionalScaleDeg: regionScale,
        twinOffsetDeg: effTargetTwinOffset,
        coastlines,
      });
    } catch {
      return null;
    }
  }, [
    composite,
    targetId,
    targetCanvas,
    grid,
    effLonShift,
    effLatShift,
    regionLon,
    regionLat,
    regionScale,
    effTargetTwinOffset,
    coastlines,
  ]);

  const addImages = useCallback(
    (loaded: { image: HTMLImageElement; filename: string }[]) => {
      setError(null);
      setInputs((prev) => [...prev, ...loaded.map(({ image, filename }) => createInput(image, filename))]);
    },
    []
  );

  const handleUpdate = useCallback((id: string, patch: Partial<RegionalInput>) => {
    setInputs((prev) => updateInput(prev, id, patch));
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      setInputs((prev) => removeInput(prev, id));
      setActiveInputId((cur) => (cur === id ? null : cur));
    },
    []
  );

  const handleReorder = useCallback((id: string, direction: 'up' | 'down') => {
    setInputs((prev) => reorderInput(prev, id, direction));
  }, []);

  const handleActivate = useCallback((id: string) => {
    setActiveInputId((cur) => (cur === id ? null : id));
  }, []);

  const handleClearAll = useCallback(() => {
    setInputs([]);
    setActiveInputId(null);
    setError(null);
  }, []);

  // Empty state: no inputs yet — show the big drop-zone and skip the panels entirely.
  if (inputs.length === 0) {
    return (
      <div className="upload-screen">
        <header className="upload-screen__header">
          <h1>Projection Lab</h1>
          <p>
            Compose a world from regional drawings. Add one or more PNGs exported from this app —
            each in its own projection — and the world will be assembled and shown in any target
            projection you pick.
          </p>
        </header>
        <Uploader onImages={addImages} />
      </div>
    );
  }

  return (
    <div className={`app ${fullscreen ? 'app--fullscreen' : ''}`}>
      <aside className={`sidebar ${sidebarOpen ? '' : 'sidebar--collapsed'}`}>
        <div className="sidebar__head">
          {sidebarOpen && <span className="sidebar__title">Projection Lab</span>}
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
            <div className="input-list">
              <div className="input-list__title">Regions ({inputs.length})</div>
              {inputs.map((input, idx) => (
                <InputRow
                  key={input.id}
                  input={input}
                  index={idx}
                  total={inputs.length}
                  active={activeInputId === input.id}
                  onUpdate={(patch) => handleUpdate(input.id, patch)}
                  onRemove={() => handleRemove(input.id)}
                  onReorder={(dir) => handleReorder(input.id, dir)}
                  onActivate={() => handleActivate(input.id)}
                />
              ))}
              <Uploader onImages={addImages} variant="compact" />
            </div>

            <Field label="Target projection">
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value as ProjectionId)}
              >
                {projectionList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
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

            {targetRegional ? (
              <RegionParamsEditor
                lon={regionLon}
                lat={regionLat}
                scale={regionScale}
                onLon={setRegionLon}
                onLat={setRegionLat}
                onScale={setRegionScale}
              />
            ) : (
              <>
                <Field label="Composite center longitude">
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
                <Field label="Composite center latitude">
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
            {targetTwin && (
              <TwinOffsetEditor value={targetTwinOffset} onChange={setTargetTwinOffset} />
            )}

            <div className="sidebar__actions">
              <button
                className="btn"
                onClick={() => setDownloadOpen(true)}
                disabled={!composite}
              >
                Download…
              </button>
              <button
                className="btn btn--ghost"
                onClick={handleClearAll}
              >
                Clear all
              </button>
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        {error && <div className="error">{error}</div>}

        <div className="panels">
          <Panel
            id="composite"
            title="Composite · Equirectangular"
            subtitle={
              activeInput
                ? `Highlighting: ${activeInput.label}`
                : `${inputs.length} region${inputs.length === 1 ? '' : 's'}`
            }
            fullscreen={fullscreen === 'composite'}
            onFullscreenToggle={() =>
              setFullscreen(fullscreen === 'composite' ? null : 'composite')
            }
          >
            <CanvasView canvas={compositePreview} />
          </Panel>
          <Panel
            id="target"
            title={`Target · ${targetProjection.label}`}
            fullscreen={fullscreen === 'target'}
            onFullscreenToggle={() => setFullscreen(fullscreen === 'target' ? null : 'target')}
          >
            <CanvasView canvas={targetCanvas} />
          </Panel>
          <Panel
            id="globe"
            title="Globe view"
            subtitle="Drag to rotate · scroll to zoom"
            wide
            fullscreen={fullscreen === 'globe'}
            onFullscreenToggle={() => setFullscreen(fullscreen === 'globe' ? null : 'globe')}
          >
            <GlobeView equirectangular={globeCanvas} />
          </Panel>
        </div>
      </main>

      <DownloadDialog
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        inputs={inputs}
        grid={grid}
        coastlines={coastlines}
        defaultProjection={targetId}
        // Target params (used as defaults when the user picks a regional / twin target in the dialog)
        regionLon={regionLon}
        regionLat={regionLat}
        regionScale={regionScale}
        targetTwinOffset={targetTwinOffset}
        lonShift={lonShift}
        latShift={latShift}
        maxOutputSize={maxOutputSize}
      />
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  wide,
  fullscreen,
  onFullscreenToggle,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
  fullscreen: boolean;
  onFullscreenToggle: () => void;
}) {
  return (
    <section
      className={`panel ${wide ? 'panel--wide' : ''} ${fullscreen ? 'panel--fullscreen' : ''}`}
    >
      <header className="panel__header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="panel__sub">{subtitle}</p>}
        </div>
        <button
          className="panel__fs"
          onClick={onFullscreenToggle}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
        >
          {fullscreen ? '✕' : '⛶'}
        </button>
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

function CanvasView({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Visual zoom state. Pure CSS transform on the canvas — does not affect projection params.
  // tx/ty are screen-pixel translations from the canvas's natural (centred) position.
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);

  // Clamp tx/ty so the canvas always covers the host (you can't drag the content fully off-screen).
  const clampPan = useCallback(() => {
    const c = canvasRef.current;
    const host = hostRef.current;
    if (!c || !host) return;
    const s = scaleRef.current;
    const maxTx = Math.max(0, (c.offsetWidth * s - host.clientWidth) / 2);
    const maxTy = Math.max(0, (c.offsetHeight * s - host.clientHeight) / 2);
    txRef.current = Math.max(-maxTx, Math.min(maxTx, txRef.current));
    tyRef.current = Math.max(-maxTy, Math.min(maxTy, tyRef.current));
  }, []);

  const applyTransform = useCallback(() => {
    clampPan();
    const c = canvasRef.current;
    if (c) {
      c.style.transform = `translate(${txRef.current}px, ${tyRef.current}px) scale(${scaleRef.current})`;
    }
    const host = hostRef.current;
    if (host) {
      host.classList.toggle('canvas-host--zoomed', scaleRef.current > 1);
    }
  }, [clampPan]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    canvasRef.current = canvas;
    if (canvas) {
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '100%';
      canvas.style.objectFit = 'contain';
      canvas.style.transformOrigin = '50% 50%';
      canvas.style.transform = `translate(${txRef.current}px, ${tyRef.current}px) scale(${scaleRef.current})`;
      host.appendChild(canvas);
      host.classList.toggle('canvas-host--zoomed', scaleRef.current > 1);
    }
  }, [canvas]);

  // Drag = visual pan. Only active when zoomed in.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: MouseEvent) => {
      if (scaleRef.current <= 1) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      host.classList.add('canvas-host--grabbing');
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      txRef.current += e.clientX - lastX;
      tyRef.current += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      applyTransform();
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
  }, [applyTransform]);

  // Wheel zoom centred on the cursor.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const oldS = scaleRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newS = Math.max(1, Math.min(8, oldS * factor));
      if (newS === oldS) return;
      const r = newS / oldS;
      txRef.current = (e.clientX - cx) * (1 - r) + txRef.current * r;
      tyRef.current = (e.clientY - cy) * (1 - r) + tyRef.current * r;
      if (newS === 1) {
        txRef.current = 0;
        tyRef.current = 0;
      }
      scaleRef.current = newS;
      applyTransform();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [applyTransform]);

  // Double-click resets zoom and pan.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onDbl = (e: MouseEvent) => {
      if (scaleRef.current === 1 && txRef.current === 0 && tyRef.current === 0) return;
      e.preventDefault();
      scaleRef.current = 1;
      txRef.current = 0;
      tyRef.current = 0;
      applyTransform();
    };
    host.addEventListener('dblclick', onDbl);
    return () => host.removeEventListener('dblclick', onDbl);
  }, [applyTransform]);

  return <div className="canvas-host" ref={hostRef} />;
}

function DownloadDialog({
  open,
  onClose,
  inputs,
  grid,
  coastlines,
  defaultProjection,
  regionLon,
  regionLat,
  regionScale,
  targetTwinOffset,
  lonShift,
  latShift,
  maxOutputSize,
}: {
  open: boolean;
  onClose: () => void;
  inputs: RegionalInput[];
  grid: GridOptions;
  coastlines: boolean;
  defaultProjection: ProjectionId;
  regionLon: number;
  regionLat: number;
  regionScale: number;
  targetTwinOffset: number;
  lonShift: number;
  latShift: number;
  maxOutputSize: number;
}) {
  const [proj, setProj] = useState<ProjectionId>(defaultProjection);
  const [size, setSize] = useState<number>(2048);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sizeOptions = useMemo(
    () => [1024, 2048, 4096, 8192].filter((s) => s <= maxOutputSize),
    [maxOutputSize]
  );

  useEffect(() => {
    if (!sizeOptions.includes(size)) {
      setSize(sizeOptions[sizeOptions.length - 1] ?? 1024);
    }
  }, [size, sizeOptions]);

  useEffect(() => {
    if (open) {
      setProj(defaultProjection);
      setErr(null);
      setBusy(false);
    }
  }, [open, defaultProjection]);

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
    setBusy(true);
    setErr(null);
    try {
      // Re-build the composite at full size for the download — the on-screen one is at preview
      // resolution to keep slider drags responsive, but the download deserves the high-fidelity pass.
      const fullComposite = buildComposite(inputs, COMPOSITE_FULL);
      const dialogRegional = proj === 'lambert';
      const dialogTwin = proj === 'orthographicTwin' || proj === 'stereographicTwin';
      const canvas = convertImage({
        source: equirectangular,
        target: targetProj,
        image: fullComposite,
        outputWidth: outW,
        outputHeight: outH,
        grid,
        lonShiftDeg: dialogRegional ? 0 : lonShift,
        latShiftDeg: dialogRegional ? 0 : latShift,
        regionalCenterLonDeg: regionLon,
        regionalCenterLatDeg: regionLat,
        regionalScaleDeg: regionScale,
        twinOffsetDeg: dialogTwin ? targetTwinOffset : 0,
        coastlines,
      });
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Derive a base name from the first enabled input's label, fall back to "world".
      const baseName = inputs.find((i) => i.enabled)?.label || inputs[0]?.label || 'world';
      a.download = buildDownloadName(baseName, proj, {
        lambert: dialogRegional
          ? { lon: regionLon, lat: regionLat, scale: regionScale }
          : undefined,
        twinOffset: dialogTwin ? targetTwinOffset : undefined,
      });
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
        <Field label="Size" hint={`Output: ${outW} × ${outH} px`}>
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
          <button className="btn" onClick={handleDownload} disabled={busy || inputs.length === 0}>
            {busy ? 'Rendering…' : 'Download PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
