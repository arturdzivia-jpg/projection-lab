import { regionPresets, matchRegionPreset } from '../projections/regionPresets';
import { clamp, normalizeLon } from '../lib/numUtils';
import { Field } from './Field';

/**
 * Lambert Azimuthal regional editor: preset dropdown + lon / lat / scale sliders.
 * Used both per-input (for Lambert input rows) and globally (when the user picks Lambert as the
 * target). The preset dropdown displays "Custom" automatically when the current values don't
 * match any preset; selecting a preset writes all three params at once.
 */
export function RegionParamsEditor({
  lon,
  lat,
  scale,
  onLon,
  onLat,
  onScale,
}: {
  lon: number;
  lat: number;
  scale: number;
  onLon: (v: number) => void;
  onLat: (v: number) => void;
  onScale: (v: number) => void;
}) {
  const presetId = matchRegionPreset(lon, lat, scale)?.id ?? 'custom';
  return (
    <>
      <Field label="Region preset">
        <select
          value={presetId}
          onChange={(e) => {
            const preset = regionPresets.find((p) => p.id === e.target.value);
            // "Custom" is a derived state — selecting it does nothing because it just reflects
            // "the current trio doesn't match any preset".
            if (!preset) return;
            onLon(preset.lon);
            onLat(preset.lat);
            onScale(preset.scale);
          }}
        >
          <option value="custom">Custom</option>
          {regionPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
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
            value={Number(lon.toFixed(2))}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || v === '-') return;
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              onLon(normalizeLon(n));
            }}
            className="number-input"
          />
          <input
            type="range"
            min={-180}
            max={180}
            step="any"
            value={lon}
            onChange={(e) => onLon(Number(e.target.value))}
            className="slider"
          />
          <button
            type="button"
            className="btn btn--ghost btn--mini"
            onClick={() => onLon(0)}
            disabled={lon === 0}
          >
            Reset
          </button>
        </div>
      </Field>
      <Field label="Region center lat">
        <div className="slider-row">
          <input
            type="number"
            min={-90}
            max={90}
            step={1}
            value={Number(lat.toFixed(2))}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || v === '-') return;
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              onLat(clamp(n, -90, 90));
            }}
            className="number-input"
          />
          <input
            type="range"
            min={-90}
            max={90}
            step="any"
            value={lat}
            onChange={(e) => onLat(Number(e.target.value))}
            className="slider"
          />
          <button
            type="button"
            className="btn btn--ghost btn--mini"
            onClick={() => onLat(0)}
            disabled={lat === 0}
          >
            Reset
          </button>
        </div>
      </Field>
      <Field
        label="Region scale"
        hint={`${scale.toFixed(0)}° angular radius (90° = hemisphere)`}
      >
        <div className="slider-row">
          <input
            type="number"
            min={5}
            max={180}
            step={1}
            value={Number(scale.toFixed(0))}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return;
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              onScale(clamp(n, 5, 180));
            }}
            className="number-input"
          />
          <input
            type="range"
            min={5}
            max={180}
            step={1}
            value={scale}
            onChange={(e) => onScale(Number(e.target.value))}
            className="slider"
          />
          <button
            type="button"
            className="btn btn--ghost btn--mini"
            onClick={() => onScale(60)}
            disabled={scale === 60}
          >
            Reset
          </button>
        </div>
      </Field>
    </>
  );
}

/** Twin-projection layout offset: single longitude slider with a reset-to-zero button. */
export function TwinOffsetEditor({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field
      label="Layout center longitude"
      hint="Longitude at the seam between the two hemispheres"
    >
      <div className="slider-row">
        <input
          type="number"
          min={-180}
          max={180}
          step={1}
          value={Number(value.toFixed(2))}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '' || v === '-') return;
            const n = Number(v);
            if (!Number.isFinite(n)) return;
            onChange(normalizeLon(n));
          }}
          className="number-input"
        />
        <input
          type="range"
          min={-180}
          max={180}
          step="any"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="slider"
        />
        <button
          type="button"
          className="btn btn--ghost btn--mini"
          onClick={() => onChange(0)}
          disabled={value === 0}
        >
          Reset
        </button>
      </div>
    </Field>
  );
}
