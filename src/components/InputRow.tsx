import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectionId } from '../projections';
import { projectionList, getProjection } from '../projections/registry';
import { aspectMismatch, type FitMode } from '../lib/normalize';
import type { RegionalInput } from '../lib/regionalInputs';
import { Field } from './Field';
import { RegionParamsEditor, TwinOffsetEditor } from './RegionParamsEditor';

const THUMB_SIZE = 48;

/** Single regional-input card in the sidebar list — collapsed by default, expandable to edit. */
export function InputRow({
  input,
  index,
  total,
  active,
  onUpdate,
  onRemove,
  onReorder,
  onActivate,
}: {
  input: RegionalInput;
  index: number;
  total: number;
  active: boolean;
  onUpdate: (patch: Partial<RegionalInput>) => void;
  onRemove: () => void;
  onReorder: (direction: 'up' | 'down') => void;
  onActivate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const projection = getProjection(input.projectionId);
  const mismatch = aspectMismatch(
    input.image.width / input.image.height,
    projection.defaultAspect
  );

  return (
    <div
      className={`input-row ${active ? 'input-row--active' : ''} ${input.enabled ? '' : 'input-row--disabled'}`}
      onClick={onActivate}
    >
      <div className="input-row__head">
        <Thumbnail image={input.image} />
        <div className="input-row__meta">
          <input
            className="input-row__label"
            value={input.label}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder="Label"
          />
          <div className="input-row__summary">
            {mismatch && (
              <span
                className="input-row__warn"
                title={`Image is ${input.image.width}×${input.image.height}, but ${projection.label} expects ${projection.defaultAspect}:1. Open the row to pick a Fit mode.`}
              >
                ⚠
              </span>
            )}
            {summarise(input)}
          </div>
        </div>
        <div className="input-row__controls" onClick={(e) => e.stopPropagation()}>
          <label
            className="input-row__enable"
            title={input.enabled ? 'Disable layer' : 'Enable layer'}
          >
            <input
              type="checkbox"
              checked={input.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
            />
          </label>
          <button
            type="button"
            className="btn btn--ghost btn--mini"
            onClick={() => onReorder('up')}
            disabled={index === 0}
            title="Move up (covers others)"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--mini"
            onClick={() => onReorder('down')}
            disabled={index === total - 1}
            title="Move down (gets covered)"
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--mini"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▴' : '▾'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--mini input-row__remove"
            onClick={onRemove}
            title="Remove"
          >
            ✕
          </button>
        </div>
      </div>
      {expanded && (
        <div className="input-row__body" onClick={(e) => e.stopPropagation()}>
          <Field label="Source projection">
            <select
              value={input.projectionId}
              onChange={(e) => onUpdate({ projectionId: e.target.value as ProjectionId })}
            >
              {projectionList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`Fit ${mismatch ? '⚠' : ''}`}
            hint={
              mismatch
                ? `Image is ${input.image.width}×${input.image.height}, but ${projection.label} expects ${projection.defaultAspect}:1.`
                : undefined
            }
          >
            <select
              value={input.fit}
              onChange={(e) => onUpdate({ fit: e.target.value as FitMode })}
            >
              <option value="stretch">Stretch</option>
              <option value="contain">Letterbox (contain)</option>
              <option value="cover">Crop (cover)</option>
            </select>
          </Field>
          {input.projectionId === 'lambert' && (
            <RegionParamsEditor
              lon={input.lambert.lon}
              lat={input.lambert.lat}
              scale={input.lambert.scale}
              onLon={(v) => onUpdate({ lambert: { ...input.lambert, lon: v } })}
              onLat={(v) => onUpdate({ lambert: { ...input.lambert, lat: v } })}
              onScale={(v) => onUpdate({ lambert: { ...input.lambert, scale: v } })}
            />
          )}
          {(input.projectionId === 'orthographicTwin' ||
            input.projectionId === 'stereographicTwin') && (
            <TwinOffsetEditor
              value={input.twinOffset}
              onChange={(v) => onUpdate({ twinOffset: v })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function summarise(input: RegionalInput): string {
  const projLabel = getProjection(input.projectionId).label;
  if (input.projectionId === 'lambert') {
    const { lon, lat, scale } = input.lambert;
    return `${projLabel} · ${fmt(lon)}°, ${fmt(lat)}°, r${fmt(scale)}°`;
  }
  if (
    input.projectionId === 'orthographicTwin' ||
    input.projectionId === 'stereographicTwin'
  ) {
    return `${projLabel} · seam ${fmt(input.twinOffset)}°`;
  }
  return projLabel;
}

function fmt(n: number): string {
  const r = Number(n.toFixed(1));
  return Number.isInteger(r) ? r.toString() : r.toString();
}

/** Tiny canvas thumbnail of the input image, drawn once per image reference. */
function Thumbnail({ image }: { image: HTMLImageElement }) {
  const canvas = useMemo<HTMLCanvasElement>(() => {
    const c = document.createElement('canvas');
    c.width = THUMB_SIZE;
    c.height = THUMB_SIZE;
    const ctx = c.getContext('2d');
    if (ctx) {
      const aspect = image.width / image.height;
      let dw = THUMB_SIZE;
      let dh = THUMB_SIZE;
      let dx = 0;
      let dy = 0;
      if (aspect > 1) {
        dh = THUMB_SIZE / aspect;
        dy = (THUMB_SIZE - dh) / 2;
      } else if (aspect < 1) {
        dw = THUMB_SIZE * aspect;
        dx = (THUMB_SIZE - dw) / 2;
      }
      ctx.drawImage(image, dx, dy, dw, dh);
    }
    return c;
  }, [image]);

  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren(canvas);
  }, [canvas]);

  return <div className="input-row__thumb" ref={hostRef} />;
}
