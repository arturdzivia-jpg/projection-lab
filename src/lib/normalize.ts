export type FitMode = 'stretch' | 'contain' | 'cover';

/**
 * Draws an image onto a canvas with a target aspect ratio.
 * Used to reconcile uploaded images whose aspect doesn't match the chosen
 * source projection's expected layout (e.g. a 1:1 PNG declared as equirectangular, which expects 2:1).
 *
 * - stretch: scale to fill, distorting if needed
 * - contain: fit entirely inside, transparent bars on the short axis (letterbox)
 * - cover: fill entirely, cropping the overflow on the long axis
 */
export function normalizeAspect(
  source: HTMLImageElement | ImageBitmap,
  targetAspect: number,
  fit: FitMode,
  maxDim = 4096
): HTMLCanvasElement {
  const srcW = source.width;
  const srcH = source.height;

  // Pick output size: long axis = min(longest source dimension scaled, maxDim).
  let outW: number;
  let outH: number;
  if (targetAspect >= 1) {
    outW = Math.min(Math.max(srcW, Math.round(srcH * targetAspect)), maxDim);
    outH = Math.round(outW / targetAspect);
  } else {
    outH = Math.min(Math.max(srcH, Math.round(srcW / targetAspect)), maxDim);
    outW = Math.round(outH * targetAspect);
  }

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');

  if (fit === 'stretch') {
    ctx.drawImage(source as CanvasImageSource, 0, 0, outW, outH);
    return canvas;
  }

  const srcAspect = srcW / srcH;
  let dx = 0;
  let dy = 0;
  let dw = outW;
  let dh = outH;

  if (fit === 'contain') {
    if (srcAspect > targetAspect) {
      dh = Math.round(outW / srcAspect);
      dy = Math.round((outH - dh) / 2);
    } else {
      dw = Math.round(outH * srcAspect);
      dx = Math.round((outW - dw) / 2);
    }
    ctx.drawImage(source as CanvasImageSource, dx, dy, dw, dh);
  } else {
    // cover
    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;
    if (srcAspect > targetAspect) {
      sw = Math.round(srcH * targetAspect);
      sx = Math.round((srcW - sw) / 2);
    } else {
      sh = Math.round(srcW / targetAspect);
      sy = Math.round((srcH - sh) / 2);
    }
    ctx.drawImage(source as CanvasImageSource, sx, sy, sw, sh, 0, 0, outW, outH);
  }

  return canvas;
}

export function aspectMismatch(actual: number, expected: number, tol = 0.01): boolean {
  return Math.abs(actual - expected) / expected > tol;
}
