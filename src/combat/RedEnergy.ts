import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { Projection } from '../core/Projection';
import { applyDepth } from '../core/DepthSort';
import { clampFloorY, type Damageable } from './Attack';
import { hitStop, spawnDamageNumber } from './CombatFeel';

/**
 * Forward-traveling red energy bolt in floor space.
 * Hits living targets within heavyHitRadius + floorY tolerance, up to heavyMaxTargets.
 */
export class RedEnergyBolt {
  floorX: number;
  floorY: number;
  readonly facing: 1 | -1;
  alive = true;

  private traveled = 0;
  private readonly hit = new Set<Damageable>();
  private readonly gfx: Phaser.GameObjects.Rectangle;
  private readonly scene: Phaser.Scene;
  private onHitDamage = 0;

  constructor(
    scene: Phaser.Scene,
    origin: { floorX: number; floorY: number; facing: 1 | -1 },
  ) {
    this.scene = scene;
    this.floorX = origin.floorX;
    this.floorY = origin.floorY;
    this.facing = origin.facing;

    this.gfx = scene.add.rectangle(
      0,
      0,
      tuning.heavyBoltWidth,
      tuning.heavyBoltHeight,
      tuning.colors.redEnergy,
      0.95,
    );
    this.gfx.setScrollFactor(1).setOrigin(0.5, 0.5);
    this.syncVisual();
  }

  consumeHitDamage(): number {
    const d = this.onHitDamage;
    this.onHitDamage = 0;
    return d;
  }

  update(dtMs: number, targets: readonly Damageable[]): void {
    if (!this.alive) return;
    const dt = dtMs / 1000;
    const step = tuning.heavyProjectileSpeed * dt;
    this.floorX += this.facing * step;
    this.traveled += step;

    for (const t of targets) {
      if (!this.alive || this.hit.size >= tuning.heavyMaxTargets) break;
      if (this.hit.has(t) || t.health.isDead) continue;
      if (Math.abs(t.floorY - this.floorY) > tuning.heavyFloorYTolerance) continue;
      const dx = t.floorX - this.floorX;
      const dy = t.floorY - this.floorY;
      if (Math.hypot(dx, dy) > tuning.heavyHitRadius) continue;

      const dealt = t.health.applyDamage(tuning.heavyDamage, {
        kind: 'player-heavy',
        id: 'heel-click-bolt',
      });
      if (dealt <= 0) continue;

      this.hit.add(t);
      this.onHitDamage = dealt;
      t.applyKnockback?.(this.facing * tuning.heavyKnockback, dy * 0.15);
      t.onHitFeel?.(dealt);
      spawnDamageNumber(this.scene, t.floorX, t.floorY, dealt);
      hitStop(this.scene, 35);
    }

    if (this.traveled >= tuning.heavyFloorRange || this.hit.size >= tuning.heavyMaxTargets) {
      this.destroy();
      return;
    }

    this.syncVisual();
  }

  private syncVisual(): void {
    const screen = Projection.toScreen(this.floorX, this.floorY, 4);
    const scale = Projection.depthScale(this.floorY);
    this.gfx.setPosition(screen.x, screen.y);
    this.gfx.setScale(this.facing * scale, scale * 0.85);
    this.gfx.setFillStyle(tuning.colors.redEnergy, 0.95);
    applyDepth(this.gfx, this.floorY, 3);
  }

  destroy(): void {
    this.alive = false;
    this.gfx.destroy();
  }
}

/**
 * Expanding red pulse ring around a floor-space point (ultimate detonation).
 */
export class RedEnergyPulse {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly floorX: number;
  private readonly floorY: number;
  private elapsed = 0;
  alive = true;

  constructor(scene: Phaser.Scene, floorX: number, floorY: number) {
    this.floorX = floorX;
    this.floorY = clampFloorY(floorY);
    this.gfx = scene.add.graphics();
    this.gfx.setScrollFactor(1);
    this.redraw(0.15);
  }

  update(dtMs: number): void {
    if (!this.alive) return;
    this.elapsed += dtMs;
    const t = Phaser.Math.Clamp(this.elapsed / tuning.ultimatePulseDurationMs, 0, 1);
    this.redraw(t);
    if (t >= 1) this.destroy();
  }

  private redraw(t: number): void {
    const screen = Projection.toScreen(this.floorX, this.floorY, 0);
    const scale = Projection.depthScale(this.floorY);
    const radius = tuning.ultimatePulseRadius * scale * t;
    const alpha = 0.85 * (1 - t);

    this.gfx.clear();
    this.gfx.lineStyle(3, tuning.colors.redEnergy, alpha);
    this.gfx.strokeCircle(screen.x, screen.y, Math.max(4, radius));
    this.gfx.fillStyle(tuning.colors.redEnergySoft, alpha * 0.25);
    this.gfx.fillCircle(screen.x, screen.y, Math.max(2, radius * 0.85));
    applyDepth(this.gfx, this.floorY, 4);
  }

  destroy(): void {
    this.alive = false;
    this.gfx.destroy();
  }
}

/** Nearest living targets within acquire range, capped. */
export function acquireNearestTargets(
  origin: { floorX: number; floorY: number },
  targets: readonly Damageable[],
  range: number,
  max: number,
): Damageable[] {
  return targets
    .filter((t) => !t.health.isDead)
    .map((t) => ({
      t,
      d: Math.hypot(t.floorX - origin.floorX, t.floorY - origin.floorY),
    }))
    .filter((e) => e.d <= range)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((e) => e.t);
}
