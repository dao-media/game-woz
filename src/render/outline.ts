/**
 * 1px alpha-edge silhouette outline — the same pass used on character sprites.
 * Dilate the opaque silhouette and paint outline pixels *behind* the source.
 * Never a vector stroke (those read as UI chrome).
 *
 * Apply this last, on the downscaled image.
 */

export type AlphaOutlineOpts = {
  /** Outline thickness in pixels (1–16). Default 1. */
  width?: number;
  /** CSS hex (#rrggbb / #rgb). Default #000000. */
  color?: string;
  /** Alpha > threshold counts as opaque silhouette. Default 8. */
  threshold?: number;
};

export function parseCssColor(color: string): [number, number, number] {
  const hex = color.trim();
  if (/^#([0-9a-f]{6})$/i.test(hex)) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (/^#([0-9a-f]{3})$/i.test(hex)) {
    const r = Number.parseInt(hex[1]! + hex[1]!, 16);
    const g = Number.parseInt(hex[2]! + hex[2]!, 16);
    const b = Number.parseInt(hex[3]! + hex[3]!, 16);
    return [r, g, b];
  }
  return [0, 0, 0];
}

export function hexFromRgbNumber(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Dilate alpha silhouette and paint outline pixels behind the original.
 * Returns a new canvas (does not mutate the source).
 */
export function applyAlphaOutline(
  source: HTMLCanvasElement,
  opts: AlphaOutlineOpts = {},
): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const radius = Math.max(1, Math.min(16, Math.round(opts.width ?? 1)));
  const threshold = opts.threshold ?? 8;
  const [or, og, ob] = parseCssColor(opts.color ?? '#000000');

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(source, 0, 0);
  const src = sctx.getImageData(0, 0, w, h);
  const srcData = src.data;

  const opaque = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < opaque.length; i++, p += 4) {
    opaque[i] = srcData[p + 3]! > threshold ? 1 : 0;
  }

  const r2 = radius * radius;
  const out = sctx.createImageData(w, h);
  const outData = out.data;
  outData.fill(0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (opaque[i]) continue;
      let hit = false;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      for (let yy = y0; yy <= y1 && !hit; yy++) {
        const dy = yy - y;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - x;
          if (dx * dx + dy * dy > r2) continue;
          if (opaque[yy * w + xx]) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) continue;
      const p = i * 4;
      outData[p] = or;
      outData[p + 1] = og;
      outData[p + 2] = ob;
      outData[p + 3] = 255;
    }
  }

  for (let p = 0; p < srcData.length; p += 4) {
    const a = srcData[p + 3]! / 255;
    if (a <= 0) continue;
    const inv = 1 - a;
    outData[p] = Math.round(srcData[p]! * a + outData[p]! * inv);
    outData[p + 1] = Math.round(srcData[p + 1]! * a + outData[p + 1]! * inv);
    outData[p + 2] = Math.round(srcData[p + 2]! * a + outData[p + 2]! * inv);
    outData[p + 3] = Math.max(outData[p + 3]!, srcData[p + 3]!);
  }

  const result = document.createElement('canvas');
  result.width = w;
  result.height = h;
  const rctx = result.getContext('2d')!;
  rctx.putImageData(out, 0, 0);
  return result;
}
