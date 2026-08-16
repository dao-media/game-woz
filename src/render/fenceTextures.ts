import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyAlphaOutline, hexFromRgbNumber } from './outline';

export const FENCE_POST_TEX = 'fence-post-wood';
export const FENCE_RAIL_TEX = 'fence-rail-wood';

export const FENCE_POST_SRC_W = 14;
export const FENCE_POST_SRC_H = 64;
export const FENCE_RAIL_SRC_W = 128;
export const FENCE_RAIL_SRC_H = 8;

type Rgb = readonly [number, number, number];

function rgb(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const u = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function setPx(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  c: Rgb,
  a = 255,
): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  data[i] = c[0];
  data[i + 1] = c[1];
  data[i + 2] = c[2];
  data[i + 3] = a;
}

function woodTone(x: number, y: number, vertical: boolean, side: boolean): Rgb {
  const dark = rgb(tuning.colors.fenceWoodDark);
  const mid = rgb(tuning.colors.fenceWoodMid);
  const light = rgb(tuning.colors.fenceWoodLight);
  const hi = rgb(tuning.colors.fenceWoodHi);
  const grain = rgb(tuning.colors.fenceWoodGrain);
  const sideC = rgb(tuning.colors.fenceWoodSide);

  const u = vertical ? x : y;
  const v = vertical ? y : x;
  const wave = Math.sin(u * 1.35 + Math.sin(v * 0.09) * 2.4);
  const n = hash(u * 2.1, Math.floor(v / 2));
  const streak = hash(u + 0.3, 0) < 0.18 ? -0.16 : 0;
  const dither = ((x + y) & 1) === 0 ? 0.03 : -0.02;
  const t = 0.5 + wave * 0.1 + (n - 0.5) * 0.22 + streak + dither;

  let c = mix(dark, mid, 0.45 + t * 0.5);
  c = mix(c, light, Math.max(0, t - 0.15) * 0.65);
  if (t > 0.62) c = mix(c, hi, (t - 0.62) * 1.4);
  if (n > 0.82) c = mix(c, grain, 0.35);
  if (side) c = mix(c, sideC, 0.55);
  return c;
}

/** Paint at 2×. Inset by 2px so the 1px outline fits after downscale. */
function paintPost(img: ImageData): void {
  const { width: w, height: h, data } = img;
  data.fill(0);
  const pad = 2;
  const sideW = Math.max(3, Math.round(w * 0.22));
  const left = pad;
  const right = w - 1 - pad;
  const top = pad;
  const bottom = h - 1 - pad;
  const sideX = right - sideW + 1;

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const onSide = x >= sideX;
      const cap = y <= top + pad + 1;
      let c = woodTone(x, y, true, onSide);
      if (!onSide && x <= left + 1) c = mix(c, rgb(tuning.colors.fenceWoodHi), 0.28);
      if (cap) c = mix(c, rgb(tuning.colors.fenceWoodLight), 0.2);
      if (y >= bottom - 1) c = mix(c, rgb(tuning.colors.fenceWoodDark), 0.25);
      setPx(data, w, h, x, y, c);
    }
  }
}

function paintRail(img: ImageData): void {
  const { width: w, height: h, data } = img;
  data.fill(0);
  const pad = 2;
  const top = pad;
  const bottom = h - 1 - pad;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      let c = woodTone(x, y, false, false);
      if (y === top) c = mix(c, rgb(tuning.colors.fenceWoodHi), 0.35);
      if (y === bottom) c = mix(c, rgb(tuning.colors.fenceWoodDark), 0.3);
      setPx(data, w, h, x, y, c);
    }
  }
}

function canvasTex(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  paint: (img: ImageData) => void,
): void {
  const scale = 2;
  const src = document.createElement('canvas');
  src.width = w * scale;
  src.height = h * scale;
  const sctx = src.getContext('2d');
  if (!sctx) return;
  const img = sctx.createImageData(src.width, src.height);
  paint(img);
  sctx.putImageData(img, 0, 0);

  const down = document.createElement('canvas');
  down.width = w;
  down.height = h;
  const dctx = down.getContext('2d');
  if (!dctx) return;
  dctx.imageSmoothingEnabled = true;
  dctx.clearRect(0, 0, w, h);
  dctx.drawImage(src, 0, 0, w, h);

  const outlined = applyAlphaOutline(down, {
    width: 1,
    color: hexFromRgbNumber(tuning.colors.fenceOutline),
  });

  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(outlined, 0, 0);
  tex.refresh();
}

/** Procedural 16-bit HD wood + 1px silhouette (same outline language as characters). */
export function ensureFenceTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FENCE_POST_TEX)) {
    canvasTex(scene, FENCE_POST_TEX, FENCE_POST_SRC_W, FENCE_POST_SRC_H, paintPost);
  }
  if (!scene.textures.exists(FENCE_RAIL_TEX)) {
    canvasTex(scene, FENCE_RAIL_TEX, FENCE_RAIL_SRC_W, FENCE_RAIL_SRC_H, paintRail);
  }
}
