import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';
import { Health } from '../combat/Health';
import { clampFloorY, type Damageable } from '../combat/Attack';
import { flashFill, spawnDamageNumber } from '../combat/CombatFeel';
import type { EnemyDef } from '../data/enemies';
import type { DifficultyParams } from '../ai/DifficultyParams';
import { clampDifficultyMult } from '../ai/DifficultyParams';
import { buildPerception } from '../ai/Perception';
import { decideUtility, type ActionId, type ScoredAction, type UtilityBrain } from '../ai/UtilityAI';
import { Executor } from '../ai/Executor';
import type { Player } from './Player';

/**
 * Data-driven enemy with utility decide + executor motor layers.
 * createEnemy is the sprite seam — greybox rect for now.
 */
export class Enemy implements Damageable {
  readonly enemyId: string;
  readonly def: EnemyDef;
  readonly body: Phaser.GameObjects.Rectangle;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly health: Health;
  readonly executor = new Executor();

  floorX: number;
  floorY: number;
  z = 0;
  alive = true;

  /** Debug: last utility decision. */
  lastChosen: ActionId = 'circle';
  lastScores: ScoredAction[] = [];
  lastExecutorState = 'idle';

  private knockVelX = 0;
  private knockVelY = 0;
  private contactCooldownMs = 0;
  private decideTimerMs = 0;
  private recentDamageMs = 0;
  private readonly scene: Phaser.Scene;
  private readonly brain: UtilityBrain;
  private readonly difficulty: DifficultyParams;
  private readonly damage: number;
  private readonly baseFill: number;

  constructor(
    scene: Phaser.Scene,
    def: EnemyDef,
    spawn: { floorX: number; floorY: number },
    brain: UtilityBrain,
    difficulty: DifficultyParams,
  ) {
    this.scene = scene;
    this.def = def;
    this.enemyId = def.id;
    this.brain = brain;
    this.difficulty = difficulty;
    this.floorX = spawn.floorX;
    this.floorY = clampFloorY(spawn.floorY);
    this.z = def.hoverZ;
    this.baseFill = def.color;
    this.damage = def.contactDamage * clampDifficultyMult(difficulty.damageMult);

    const maxHP = Math.round(def.maxHP * clampDifficultyMult(difficulty.hpMult));
    this.health = new Health(maxHP, {
      onDamage: () => {
        this.recentDamageMs = tuning.enemyRecentDamageWindowMs;
        this.onHitFeel(0);
      },
      onDeath: () => this.die(),
    });

    this.shadow = scene.add.ellipse(0, 0, 36, 12, tuning.colors.shadow, 0.35);
    this.shadow.setScrollFactor(1).setOrigin(0.5, 0.5);

    this.body = scene.add.rectangle(0, 0, def.bodyWidth, def.bodyHeight, this.baseFill);
    this.body.setScrollFactor(1).setOrigin(0.5, 1);

    this.decideTimerMs = difficulty.reactionDelayMs * 0.25;
    this.syncVisual();
  }

  applyKnockback(dx: number, dy: number): void {
    this.knockVelX += dx;
    this.knockVelY += dy;
  }

  onHitFeel(_damage: number): void {
    flashFill(this.scene, this.body, this.baseFill);
  }

  update(dtMs: number, player: Player, allies: readonly Enemy[]): void {
    if (!this.alive) return;

    const dt = dtMs / 1000;
    if (this.contactCooldownMs > 0) this.contactCooldownMs -= dtMs;
    if (this.recentDamageMs > 0) this.recentDamageMs -= dtMs;

    if (Math.abs(this.knockVelX) > 0.5 || Math.abs(this.knockVelY) > 0.5) {
      this.floorX += this.knockVelX * dt;
      this.floorY = clampFloorY(this.floorY + this.knockVelY * dt);
      this.knockVelX *= Math.max(0, 1 - 8 * dt);
      this.knockVelY *= Math.max(0, 1 - 8 * dt);
    } else {
      this.knockVelX = 0;
      this.knockVelY = 0;
    }

    const perception = buildPerception(this, player, allies, this.difficulty, true);
    if (this.recentDamageMs > 0 && perception.ownHpRatio < 0.5) {
      // Soft nudge: recently hurt → prefer retreat on next decide.
    }

    this.decideTimerMs -= dtMs;
    if (this.decideTimerMs <= 0) {
      this.decideTimerMs = this.difficulty.reactionDelayMs;
      const decision = decideUtility(this.brain, perception);
      this.lastChosen = decision.chosen;
      this.lastScores = decision.scores.slice(0, 4);
      this.executor.setIntent(decision.chosen, this.difficulty);
    }

    const { striking } = this.executor.tick(
      dtMs,
      this.def,
      { floorX: this.floorX, floorY: this.floorY, z: this.z },
      perception,
      (next) => {
        this.floorX = next.floorX;
        this.floorY = clampFloorY(next.floorY);
        this.z = Math.max(0, next.z);
      },
    );
    this.lastExecutorState = this.executor.state;

    const canContact =
      striking ||
      this.executor.state === 'attack' ||
      (this.def.grounded && perception.dist <= tuning.enemyContactRadius);

    if (
      canContact &&
      !player.health.isDead &&
      this.contactCooldownMs <= 0 &&
      this.z < 22
    ) {
      const dist = Math.hypot(player.floorX - this.floorX, player.floorY - this.floorY);
      if (dist <= tuning.enemyContactRadius) {
        const dealt = player.health.applyDamage(this.damage, {
          kind: 'enemy-contact',
          id: this.enemyId,
        });
        if (dealt > 0) {
          spawnDamageNumber(this.scene, player.floorX, player.floorY, dealt);
          this.contactCooldownMs = tuning.enemyContactCooldownMs;
          const dx = player.floorX - this.floorX;
          const dy = player.floorY - this.floorY;
          const len = Math.hypot(dx, dy) || 1;
          player.applyKnockback(
            (dx / len) * tuning.knockbackStrength * 0.5,
            (dy / len) * tuning.knockbackStrength * 0.35,
          );
          this.executor.forceRecover(this.difficulty);
        }
      }
    }

    this.syncVisual();
  }

  syncVisual(): void {
    if (!this.alive) return;
    const screen = Projection.toScreen(this.floorX, this.floorY, this.z);
    const ground = Projection.toScreen(this.floorX, this.floorY, 0);
    const scale = Projection.depthScale(this.floorY);
    this.body.setPosition(screen.x, screen.y).setScale(scale);
    this.shadow.setPosition(ground.x, ground.y).setScale(scale * (this.z > 10 ? 0.7 : 1));
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
