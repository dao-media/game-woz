import type Phaser from 'phaser';
import { tuning } from '../config/tuning';

export type IntroCameraMoveCallbacks = {
  onComplete: () => void;
};

/**
 * Scripted POV orbit: approach (facing west, gate head-on) → side-scroll framing.
 * The gate is a fixed structure — what moves is the camera/POV (greybox placeholder).
 *
 * Seam for later art: replace the body of `playIntroOrbit()` with a pre-rendered
 * gate-orbit sprite sequence; keep the same start/complete contract.
 */
export class IntroCameraMove {
  private readonly scene: Phaser.Scene;
  private readonly approach: Phaser.GameObjects.Container;
  private readonly sideScrollTargets: Phaser.GameObjects.GameObject[];
  private readonly callbacks: IntroCameraMoveCallbacks;
  private playing = false;

  constructor(
    scene: Phaser.Scene,
    approach: Phaser.GameObjects.Container,
    sideScrollTargets: Phaser.GameObjects.GameObject[],
    callbacks: IntroCameraMoveCallbacks,
  ) {
    this.scene = scene;
    this.approach = approach;
    this.sideScrollTargets = sideScrollTargets;
    this.callbacks = callbacks;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Public seam — later: swap placeholder tweens for a pre-rendered orbit. */
  playIntroOrbit(): void {
    this.play();
  }

  play(): void {
    this.playing = true;

    this.approach.setVisible(true);
    this.approach.setAlpha(1);
    this.approach.setX(0);

    for (const t of this.sideScrollTargets) {
      setAlphaSafe(t, 0);
    }

    const duration = tuning.introCameraMoveMs;
    const ease = tuning.introCameraMoveEase;
    const gate = this.approach.getData('gate') as Phaser.GameObjects.Container | undefined;

    // Approach drifts west / fades — reads as ~90° orbit past the gate.
    this.scene.tweens.add({
      targets: this.approach,
      x: -tuning.gameWidth * 0.28,
      alpha: 0,
      duration,
      ease,
    });

    if (gate) {
      this.scene.tweens.add({
        targets: gate,
        scaleX: 0.5,
        scaleY: 0.72,
        x: gate.x - 140,
        duration,
        ease,
      });
    }

    // Side-scroll framing fades in as the road is revealed east/right.
    this.scene.tweens.add({
      targets: this.sideScrollTargets,
      alpha: 1,
      duration,
      ease,
      delay: duration * 0.12,
    });

    this.scene.time.delayedCall(duration, () => {
      this.playing = false;
      this.approach.setVisible(false);
      this.approach.setAlpha(0);
      for (const t of this.sideScrollTargets) {
        setAlphaSafe(t, 1);
      }
      this.callbacks.onComplete();
    });
  }
}

function setAlphaSafe(t: Phaser.GameObjects.GameObject, alpha: number): void {
  if ('setAlpha' in t && typeof (t as { setAlpha: (a: number) => void }).setAlpha === 'function') {
    (t as { setAlpha: (a: number) => void }).setAlpha(alpha);
  }
}
