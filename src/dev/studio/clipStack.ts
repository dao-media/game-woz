import * as THREE from 'three';

export type StackLayer = {
  id: string;
  label: string;
  clip: THREE.AnimationClip;
  action: THREE.AnimationAction;
  weight: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  enabled: boolean;
};

export class ClipStack {
  readonly mixer: THREE.AnimationMixer;
  layers: StackLayer[] = [];
  private seq = 0;

  constructor(root: THREE.Object3D) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  add(clip: THREE.AnimationClip, label: string): StackLayer {
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = true;
    const layer: StackLayer = {
      id: `layer-${++this.seq}`,
      label,
      clip,
      action,
      weight: 1,
      fadeIn: 0,
      fadeOut: 0,
      loop: true,
      enabled: true,
    };
    this.layers.push(layer);
    this.reapply();
    return layer;
  }

  remove(id: string): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const layer = this.layers[i];
    if (!layer) return;
    this.layers.splice(i, 1);
    layer.action.stop();
    this.mixer.uncacheAction(layer.clip);
    this.reapply();
  }

  move(id: string, dir: -1 | 1): void {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.layers.length) return;
    const tmp = this.layers[i]!;
    this.layers[i] = this.layers[j]!;
    this.layers[j] = tmp;
    this.reapply();
  }

  updateLayer(id: string, patch: Partial<Pick<StackLayer, 'weight' | 'fadeIn' | 'fadeOut' | 'loop' | 'enabled'>>): void {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    Object.assign(layer, patch);
    this.reapply();
  }

  playAll(): void {
    for (const layer of this.layers) {
      if (!layer.enabled) {
        layer.action.stop();
        continue;
      }
      layer.action.reset();
      layer.action.paused = false;
      layer.action.enabled = true;
      layer.action.setLoop(layer.loop ? THREE.LoopRepeat : THREE.LoopOnce, layer.loop ? Infinity : 1);
      layer.action.setEffectiveWeight(layer.weight);
      if (layer.fadeIn > 0) layer.action.fadeIn(layer.fadeIn);
      layer.action.play();
    }
  }

  /**
   * Scrub every enabled layer to an absolute clip time (wrapped).
   * Used for timeline pad sampling so pre/post roll can loop past clip bounds.
   */
  scrubTo(timeSec: number): void {
    for (const layer of this.layers) {
      if (!layer.enabled) {
        layer.action.stop();
        continue;
      }
      const d = Math.max(layer.clip.duration, 1e-6);
      const t = ((timeSec % d) + d) % d;
      layer.action.enabled = true;
      layer.action.paused = true;
      layer.action.setEffectiveWeight(layer.weight);
      layer.action.setLoop(THREE.LoopRepeat, Infinity);
      layer.action.time = t;
      layer.action.play();
    }
    this.mixer.update(0);
  }

  /** Currently playing action time / duration for status HUD. */
  playhead(): { label: string; time: number; duration: number } | null {
    for (const layer of this.layers) {
      if (!layer.enabled) continue;
      if (!layer.action.isRunning() && !layer.action.paused) continue;
      return {
        label: layer.label,
        time: layer.action.time,
        duration: layer.clip.duration,
      };
    }
    return null;
  }

  stopAll(): void {
    for (const layer of this.layers) {
      if (layer.fadeOut > 0) layer.action.fadeOut(layer.fadeOut);
      layer.action.stop();
    }
  }

  /** Longest enabled clip duration (for export timing). */
  duration(): number {
    let max = 0;
    for (const layer of this.layers) {
      if (layer.enabled) max = Math.max(max, layer.clip.duration);
    }
    return max || 1;
  }

  private reapply(): void {
    this.layers.forEach((layer, index) => {
      layer.action.blendMode = THREE.NormalAnimationBlendMode;
      // Later layers stack on top via weight; order is visual only for MVP.
      void index;
      layer.action.setEffectiveWeight(layer.enabled ? layer.weight : 0);
      layer.action.setLoop(layer.loop ? THREE.LoopRepeat : THREE.LoopOnce, layer.loop ? Infinity : 1);
    });
  }
}
