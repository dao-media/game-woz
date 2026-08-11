import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';

export type ExportOptions = {
  loops: number;
  fps: number;
  size: number;
  filePrefix: string;
};

/**
 * Step the mixer at locked fps and capture transparent PNGs into a zip download.
 * Character-only: hides any objects tagged via `hideDuringExport` (grid, helpers, etc.).
 */
export async function exportPngSequence(opts: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  mixer: THREE.AnimationMixer;
  durationSec: number;
  options: ExportOptions;
  /** Studio helpers / environment — forced invisible for every export frame. */
  hideDuringExport?: THREE.Object3D[];
  /** Optional post-mixer pose fix (e.g. smoothening) before each capture. */
  afterMixerUpdate?: (dt: number) => void;
  onProgress?: (frac: number, label: string) => void;
}): Promise<void> {
  const { renderer, scene, camera, mixer, options, afterMixerUpdate, onProgress } = opts;
  const fps = options.fps;
  const loops = Math.max(1, options.loops);
  const size = options.size;
  const clipDur = Math.max(opts.durationSec, 1 / fps);
  const totalFrames = Math.max(1, Math.round(clipDur * fps * loops));
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

  mixer.setTime(0);
  afterMixerUpdate?.(0);

  const files: Record<string, Uint8Array> = {};
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (i > 0) {
        mixer.update(dt);
        afterMixerUpdate?.(dt);
      }
      // Re-assert: animation loop / other code must not re-show helpers mid-export.
      for (const h of hidden) h.obj.visible = false;
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');
      const b64 = dataUrl.split(',')[1] ?? '';
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const name = `${options.filePrefix}_${String(i).padStart(4, '0')}.png`;
      files[name] = bin;
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
          durationSec: clipDur * loops,
          prefix: options.filePrefix,
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
