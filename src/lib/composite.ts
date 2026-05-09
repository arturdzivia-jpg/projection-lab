import type { RegionalInput } from './regionalInputs';
import { getProjection } from '../projections/registry';
import { equirectangular } from '../projections/equirectangular';
import { convertImage } from './convert';
import { normalizeAspect } from './normalize';

/**
 * Composite preview/full sizes. Preview kicks in for the on-screen panels (live drags stay snappy);
 * full size is reserved for the download dialog so the user gets a high-fidelity export.
 */
export const COMPOSITE_PREVIEW = { w: 2048, h: 1024 };
export const COMPOSITE_FULL = { w: 4096, h: 2048 };

/**
 * Stitch N regional inputs back into a single equirectangular world.
 *
 * Each input is reverse-projected via convertImage(input.projection → equirectangular) using the
 * input's own params (Lambert centre+scale, twin offset, fit), then alpha-composited with the
 * default `source-over` operator. We render in REVERSE list order so the FIRST input lands on top
 * — that matches the "top-of-list wins" UX the user picked.
 *
 * The result is a transparent canvas wherever no enabled input covered that lon/lat. Downstream
 * the existing convertImage(equirectangular → user-target) chain treats the composite as the
 * effective source, so target/grid/coastlines/globe rendering stay on the existing code path.
 */
export function buildComposite(
  inputs: RegionalInput[],
  size: { w: number; h: number } = COMPOSITE_PREVIEW
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get composite 2D context');

  // Iterate last → first so list-top wins on overlap.
  for (let i = inputs.length - 1; i >= 0; i--) {
    const input = inputs[i];
    if (!input.enabled) continue;

    const projection = getProjection(input.projectionId);
    let perInput: HTMLCanvasElement;
    try {
      const base = normalizeAspect(input.image, projection.defaultAspect, input.fit);
      perInput = convertImage({
        source: projection,
        target: equirectangular,
        image: base,
        outputWidth: size.w,
        outputHeight: size.h,
        regionalCenterLonDeg: input.lambert.lon,
        regionalCenterLatDeg: input.lambert.lat,
        regionalScaleDeg: input.lambert.scale,
        twinOffsetDeg: input.twinOffset,
        lonShiftDeg: 0,
        latShiftDeg: 0,
        // No grid / coastlines / outline at the composite stage — those are presentation overlays
        // that belong on the final target panel, not baked into the world data.
        grid: { enabled: false, spacingDeg: 15, highlight: 'none' },
        coastlines: false,
        regionOutline: false,
      });
    } catch {
      // A single broken input (e.g. an exceedingly large image hitting the GPU max) shouldn't
      // collapse the whole composite — skip it and keep stacking the rest.
      continue;
    }

    ctx.drawImage(perInput, 0, 0);
  }

  return canvas;
}
