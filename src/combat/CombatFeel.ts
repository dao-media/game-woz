import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { Projection } from '../core/Projection';
import { applyDepth } from '../core/DepthSort';

type FillTarget = Phaser.GameObjects.Rectangle;

/** Brief white flash via fillColor (Shapes have no Tint in Phaser 3). */
export function flashFill(
  scene: Phaser.Scene,
  target: FillTarget,
  restoreColor: number,
  durationMs = tuning.hitFlashMs,
): void {
  target.setFillStyle(tuning.colors.enemyFlash, target.fillAlpha);
  scene.time.delayedCall(durationMs, () => {
    if (target.active) target.setFillStyle(restoreColor, target.fillAlpha);
  });
}

/** Floating damage number rising from a floor position. */
export function spawnDamageNumber(
  scene: Phaser.Scene,
  floorX: number,
  floorY: number,
  amount: number,
): void {
  const screen = Projection.toScreen(floorX, floorY, 0);
  const text = scene.add
    .text(screen.x, screen.y - 40, String(Math.round(amount)), {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffe8a0',
      stroke: '#1a1a1e',
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(1)
    .setDepth(50_000);

  scene.tweens.add({
    targets: text,
    y: text.y - tuning.damageNumberRisePx,
    alpha: 0,
    duration: tuning.damageNumberDurationMs,
    ease: 'Cubic.easeOut',
    onComplete: () => text.destroy(),
  });
  applyDepth(text, floorY, 5);
}

/**
 * Short world time freeze for hit impact.
 * Uses wall-clock restore so DelayedCall isn't stalled by timeScale.
 */
export function hitStop(scene: Phaser.Scene, ms: number = tuning.hitStopMs): void {
  if (ms <= 0) return;
  const prev = scene.time.timeScale;
  scene.time.timeScale = 0.05;
  window.setTimeout(() => {
    if (scene.sys.isActive()) scene.time.timeScale = prev;
  }, ms);
}
