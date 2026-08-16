import { applyAlphaOutline } from '../../render/outline';
import type { EnvElementSpec, EnvPrimitive } from './spec';

const imageCache = new Map<string, HTMLImageElement>();

export function loadBaseImage(dataUrl: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(dataUrl);
  if (hit?.complete && hit.naturalWidth > 0) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(dataUrl, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Failed to load base PNG'));
    img.src = dataUrl;
  });
}

/**
 * Rasterize the spec at native size, then apply the shared 1px alpha-edge outline last.
 */
export async function composeElement(spec: EnvElementSpec): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, spec.width);
  canvas.height = Math.max(1, spec.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (spec.baseImage) {
    const img = await loadBaseImage(spec.baseImage.dataUrl);
    ctx.drawImage(img, spec.baseImage.x, spec.baseImage.y, spec.baseImage.w, spec.baseImage.h);
  }

  for (const p of spec.primitives) {
    drawPrimitive(ctx, p);
  }

  if (!spec.outline.enabled) return canvas;
  return applyAlphaOutline(canvas, {
    width: spec.outline.width,
    color: spec.outline.color,
  });
}

function drawPrimitive(ctx: CanvasRenderingContext2D, p: EnvPrimitive): void {
  ctx.fillStyle = p.fill;
  if (p.kind === 'rect') {
    ctx.fillRect(p.x, p.y, p.w, p.h);
    return;
  }
  if (p.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, Math.max(0.5, p.w / 2), Math.max(0.5, p.h / 2), 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (p.kind === 'polygon') {
    const pts = p.points ?? [];
    if (pts.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.closePath();
    ctx.fill();
    return;
  }
  drawBlob(ctx, p);
}

function drawBlob(ctx: CanvasRenderingContext2D, p: EnvPrimitive): void {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const rx = Math.max(0.5, p.w / 2);
  const ry = Math.max(0.5, p.h / 2);
  const seed = p.blobSeed ?? 1;
  const n = 10;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble = 0.82 + 0.18 * hash2(seed, i);
    const x = cx + Math.cos(a) * rx * wobble;
    const y = cy + Math.sin(a) * ry * wobble;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function hash2(seed: number, i: number): number {
  const n = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function hitTestPrimitive(spec: EnvElementSpec, x: number, y: number): string | null {
  for (let i = spec.primitives.length - 1; i >= 0; i--) {
    const p = spec.primitives[i]!;
    if (x >= p.x && y >= p.y && x < p.x + p.w && y < p.y + p.h) return p.id;
  }
  return null;
}
