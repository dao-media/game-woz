import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';

export type AlphaOutlineOptions = {
  enabled: boolean;
  /** Outline thickness in pixels (1–16). */
  width: number;
  /** CSS hex (#rrggbb) or rgb. */
  color: string;
  /** Alpha > threshold counts as opaque silhouette. */
  threshold?: number;
};

export type ExportOptions = {
  loops: number;
  fps: number;
  size: number;
  filePrefix: string;
  /** Extra looped seconds before the core (clip × loops). */
  padBeforeSec?: number;
  /** Extra looped seconds after the core. */
  padAfterSec?: number;
  outline?: AlphaOutlineOptions;
};

/** Wrap time into [0, duration). */
export function wrapAnimTime(timeSec: number, durationSec: number): number {
  const d = Math.max(durationSec, 1e-6);
  return ((timeSec % d) + d) % d;
}

/** Map package timeline time → clip-local time (pads loop through the clip). */
export function timelineToAnimTime(
  timelineSec: number,
  padBeforeSec: number,
  clipDurationSec: number,
): number {
  return wrapAnimTime(timelineSec - padBeforeSec, clipDurationSec);
}

function parseCssColor(color: string): [number, number, number] {
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

/**
 * Dilate alpha silhouette and paint outline pixels behind the original.
 * Returns a new canvas (does not mutate the WebGL canvas).
 */
export function applyAlphaOutline(
  source: HTMLCanvasElement,
  opts: { width: number; color: string; threshold?: number },
): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const radius = Math.max(1, Math.min(16, Math.round(opts.width)));
  const threshold = opts.threshold ?? 8;
  const [or, og, ob] = parseCssColor(opts.color);

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
  // Start fully transparent; paint outline, then composite source on top.
  outData.fill(0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (opaque[i]) continue;
      // Near an opaque pixel?
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

  // Composite original character over outline.
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

function canvasToPngBytes(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/png');
  const b64 = dataUrl.split(',')[1] ?? '';
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Step through the export package at locked fps and capture transparent PNGs.
 * Character-only: hides any objects tagged via `hideDuringExport` (grid, helpers, etc.).
 *
 * Package duration = padBefore + clip×loops + padAfter. Pads sample the clip via wrap.
 */
export async function exportPngSequence(opts: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  durationSec: number;
  options: ExportOptions;
  /** Absolute timeline sample (seconds from package start). Preferred over mixer stepping. */
  sampleAt: (timelineSec: number) => void;
  /** Studio helpers / environment — forced invisible for every export frame. */
  hideDuringExport?: THREE.Object3D[];
  onProgress?: (frac: number, label: string) => void;
}): Promise<void> {
  const { renderer, scene, camera, options, sampleAt, onProgress } = opts;
  const fps = options.fps;
  const loops = Math.max(1, options.loops);
  const size = options.size;
  const outline = options.outline;
  const padBefore = Math.max(0, options.padBeforeSec ?? 0);
  const padAfter = Math.max(0, options.padAfterSec ?? 0);
  const clipDur = Math.max(opts.durationSec, 1 / fps);
  const coreDur = clipDur * loops;
  const totalDur = padBefore + coreDur + padAfter;
  const totalFrames = Math.max(1, Math.round(totalDur * fps));
  const dt = 1 / fps;

  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevBg = scene.background;
  const prevEnv = scene.environment;
  const prevFog = scene.fog;
  const hidden = (opts.hideDuringExport ?? []).map((obj) => ({
    obj,
    visible: obj.visible,
  }));

  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  scene.background = null;
  scene.environment = null;
  scene.fog = null;
  for (const h of hidden) h.obj.visible = false;

  const files: Record<string, Uint8Array> = {};
  try {
    for (let i = 0; i < totalFrames; i++) {
      const t = i * dt;
      sampleAt(t);
      // Re-assert: animation loop / other code must not re-show helpers mid-export.
      for (const h of hidden) h.obj.visible = false;
      renderer.render(scene, camera);

      let png: Uint8Array;
      if (outline?.enabled) {
        const outlined = applyAlphaOutline(renderer.domElement, {
          width: outline.width,
          color: outline.color,
          ...(outline.threshold !== undefined ? { threshold: outline.threshold } : {}),
        });
        png = canvasToPngBytes(outlined);
      } else {
        png = canvasToPngBytes(renderer.domElement);
      }

      const name = `${options.filePrefix}_${String(i).padStart(4, '0')}.png`;
      files[name] = png;
      onProgress?.((i + 1) / totalFrames, name);
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    files['manifest.json'] = strToU8(
      JSON.stringify(
        {
          fps,
          loops,
          size,
          frames: totalFrames,
          clipDurationSec: clipDur,
          padBeforeSec: padBefore,
          padAfterSec: padAfter,
          coreDurationSec: coreDur,
          durationSec: totalDur,
          prefix: options.filePrefix,
          outline: outline?.enabled
            ? { width: outline.width, color: outline.color }
            : null,
        },
        null,
        2,
      ),
    );

    const zipped = zipSync(files, { level: 6 });
    const blob = new Blob([zipped], { type: 'application/zip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${options.filePrefix}_${size}px_${fps}fps.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  } finally {
    for (const h of hidden) h.obj.visible = h.visible;
    scene.background = prevBg;
    scene.environment = prevEnv;
    scene.fog = prevFog;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setSize(prevSize.x, prevSize.y, false);
  }
}
