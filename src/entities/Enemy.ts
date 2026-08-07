import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';
import { Health } from '../combat/Health';
import { clampFloorY, type Damageable } from '../combat/Attack';
import { flashFill, spawnDamageNumber } from '../combat/CombatFeel';
import type { Player } from './Player';

/**
 * Greybox combat dummy — stationary, contact damage, dies on HP empty.
 */
export class Enemy implements Damageable {
  readonly body: Phaser.GameObjects.Rectangle;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly health: Health;

  floorX: number;
  floorY: number;
  alive = true;

  private knockVelX = 0;
  private knockVelY = 0;
  private contactCooldownMs = 0;
  private readonly scene: Phaser.Scene;
  private readonly baseFill = tuning.colors.enemy;

  constructor(
    scene: Phaser.Scene,
    spawn: { floorX: number; floorY: number },
  ) {
    this.scene = scene;
    this.floorX = spawn.floorX;
    this.floorY = clampFloorY(spawn.floorY);

    this.health = new Health(tuning.dummyMaxHP, {
      onDeath: () => this.die(),
    });

    this.shadow = scene.add.ellipse(0, 0, 36, 12, tuning.colors.shadow, 0.35);
    this.shadow.setScrollFactor(1).setOrigin(0.5, 0.5);

    this.body = scene.add.rectangle(
      0,
      0,
      tuning.dummyBodyWidth,
      tuning.dummyBodyHeight,
      this.baseFill,
    );
    this.body.setScrollFactor(1).setOrigin(0.5, 1);

    this.syncVisual();
  }

  applyKnockback(dx: number, dy: number): void {
    this.knockVelX += dx;
    this.knockVelY += dy;
  }

  onHitFeel(damage: number): void {
    flashFill(this.scene, this.body, this.baseFill);
    void damage;
  }

  update(dtMs: number, player: Player): void {
    if (!this.alive) return;

    const dt = dtMs / 1000;
    if (this.contactCooldownMs > 0) this.contactCooldownMs -= dtMs;

    if (Math.abs(this.knockVelX) > 0.5 || Math.abs(this.knockVelY) > 0.5) {
      this.floorX += this.knockVelX * dt;
      this.floorY = clampFloorY(this.floorY + this.knockVelY * dt);
      this.knockVelX *= Math.max(0, 1 - 8 * dt);
      this.knockVelY *= Math.max(0, 1 - 8 * dt);
    } else {
      this.knockVelX = 0;
      this.knockVelY = 0;
    }

    // Contact damage when overlapping player in floor space.
    if (
      !player.health.isDead &&
      this.contactCooldownMs <= 0
    ) {
      const dist = Math.hypot(player.floorX - this.floorX, player.floorY - this.floorY);
      if (dist <= tuning.dummyContactRadius) {
        const dealt = player.health.applyDamage(tuning.dummyContactDamage, {
          kind: 'enemy-contact',
          id: 'dummy',
        });
        if (dealt > 0) {
          spawnDamageNumber(this.scene, player.floorX, player.floorY, dealt);
          this.contactCooldownMs = tuning.dummyContactCooldownMs;
          const dx = player.floorX - this.floorX;
          const dy = player.floorY - this.floorY;
          const len = Math.hypot(dx, dy) || 1;
          player.applyKnockback(
            (dx / len) * tuning.knockbackStrength * 0.5,
            (dy / len) * tuning.knockbackStrength * 0.35,
          );
        }
      }
    }

    this.syncVisual();
  }

  syncVisual(): void {
    if (!this.alive) return;
    const screen = Projection.toScreen(this.floorX, this.floorY, 0);
    const scale = Projection.depthScale(this.floorY);
    this.body.setPosition(screen.x, screen.y).setScale(scale);
    this.shadow.setPosition(screen.x, screen.y).setScale(scale);
    applyDepth(this.body, this.floorY, 1);
    applyDepth(this.shadow, this.floorY, 0);
  }

  private die(): void {
    if (!this.alive) return;
    this.alive = false;
    flashFill(this.scene, this.body, this.baseFill, tuning.hitFlashMs);
    this.scene.tweens.add({
      targets: [this.body, this.shadow],
      alpha: 0,
      duration: 220,
      onComplete: () => this.destroy(),
    });
  }

  destroy(): void {
    this.body.destroy();
    this.shadow.destroy();
  }
}
