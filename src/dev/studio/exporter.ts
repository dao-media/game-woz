import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';
import { applyAlphaOutline } from '../../render/outline';

export { applyAlphaOutline };

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
  const loops = Math.max(0.1, options.loops);
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
  const prevPixelRatio = renderer.getPixelRatio();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevBg = scene.background;
  const persp =
    camera instanceof THREE.PerspectiveCamera ? camera : null;
  const prevAspect = persp?.aspect;
  const prevEnv = scene.environment;
  const prevFog = scene.fog;
  const hidden = (opts.hideDuringExport ?? []).map((obj) => ({
    obj,
    visible: obj.visible,
  }));

  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  if (persp) {
    persp.aspect = 1;
    persp.updateProjectionMatrix();
  }
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
    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    if (persp && prevAspect !== undefined) {
      persp.aspect = prevAspect;
      persp.updateProjectionMatrix();
    }
  }
}
