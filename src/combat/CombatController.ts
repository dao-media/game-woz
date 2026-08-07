import type { Input } from '../platform/Input';
import type { Player } from '../entities/Player';
import type { Damageable } from './Attack';
import { hitStop, spawnDamageNumber } from './CombatFeel';
import { dorothyKickCombo, placeholderKick } from './attacks';
import {
  RedEnergyBolt,
  RedEnergyPulse,
  acquireNearestTargets,
} from './RedEnergy';
import { tuning } from '../config/tuning';
import type Phaser from 'phaser';

/**
 * Per-character combat controller seam.
 * Dorothy: slippers + light combo + heavy bolt + ultimate pulse.
 * Others: placeholder kick only.
 */
export interface CombatController {
  readonly comboIndex: number;
  readonly lastHitDamage: number;
  /** Remaining heavy cooldown (ms). */
  readonly heavyCooldownRemainMs: number;
  /** Remaining ultimate cooldown (ms). */
  readonly ultimateCooldownRemainMs: number;
  /**
   * Earned ultimate charge 0–1.
   * Seam for later: fill from dealing/taking damage.
   * For now, snaps to 1 when ultimate cooldown ends.
   */
  readonly ultimateCharge: number;
  /** Last ultimate acquire count (for debug). */
  readonly ultimateTargetsAcquired: number;
  update(player: Player, input: Input, dtMs: number, targets: readonly Damageable[]): void;
  tickPassive?(player: Player, dtMs: number): void;
  /** Optional: later wire damage events into charge. */
  addUltimateCharge?(amount: number): void;
}

export function createCombatController(
  characterId: string,
  scene: Phaser.Scene,
): CombatController {
  if (characterId === 'dorothy') return new DorothyCombat(scene);
  return new PlaceholderCombat(scene);
}

class DorothyCombat implements CombatController {
  comboIndex = 0;
  lastHitDamage = 0;
  heavyCooldownRemainMs = 0;
  ultimateCooldownRemainMs = 0;
  ultimateCharge = 1;
  ultimateTargetsAcquired = 0;

  private comboTimerMs = 0;
  private slippersWired = false;
  private bufferedLight = false;
  private attackRemainMs = 0;
  private ultimateWindupRemainMs = 0;
  private readonly bolts: RedEnergyBolt[] = [];
  private readonly pulses: RedEnergyPulse[] = [];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  addUltimateCharge(amount: number): void {
    this.ultimateCharge = Math.min(1, Math.max(0, this.ultimateCharge + amount));
  }

  tickPassive(player: Player, dtMs: number): void {
    this.ensureSlippers(player);
    if (player.health.isDead) return;
    player.health.heal(tuning.slipperRegenPerSec * (dtMs / 1000));
  }

  update(player: Player, input: Input, dtMs: number, targets: readonly Damageable[]): void {
    this.ensureSlippers(player);
    this.tickCooldowns(dtMs);
    this.tickProjectiles(dtMs, targets);

    if (this.comboTimerMs > 0) {
      this.comboTimerMs -= dtMs;
      if (this.comboTimerMs <= 0) this.comboIndex = 0;
    }

    // —— Ultimate windup / detonate ——
    if (player.state === 'ultimate') {
      this.ultimateWindupRemainMs -= dtMs;
      if (this.ultimateWindupRemainMs <= 0) {
        this.detonateUltimate(player, targets);
        player.endCombatLock();
      }
      return;
    }

    // —— Heavy cast lock ——
    if (player.state === 'heavyAttack') {
      player.tickCombatLock(dtMs);
      return;
    }

    // —— Light combo ——
    if (player.state === 'lightAttack') {
      if (input.justDown('lightAttack') && this.attackRemainMs <= tuning.comboBufferLeadMs) {
        this.bufferedLight = true;
      }
      this.attackRemainMs = Math.max(0, this.attackRemainMs - dtMs);

      player.tickLightAttack(dtMs, targets, (dmg, tx, ty) => {
        this.lastHitDamage = dmg;
        spawnDamageNumber(this.scene, tx, ty, dmg);
        hitStop(this.scene);
        this.addUltimateCharge(0.04);
      });

      if (player.state !== 'lightAttack' && this.bufferedLight) {
        this.bufferedLight = false;
        this.beginKick(player);
      }
      return;
    }

    if ((input.justDown('lightAttack') || this.bufferedLight) && player.canStartAttack()) {
      this.bufferedLight = false;
      this.beginKick(player);
      return;
    }

    if (input.justDown('heavyAttack') && player.canStartAttack() && this.heavyCooldownRemainMs <= 0) {
      this.beginHeavy(player);
      return;
    }

    if (
      input.justDown('ultimate') &&
      player.canStartAttack() &&
      this.canFireUltimate()
    ) {
      this.beginUltimate(player);
    }
  }

  private canFireUltimate(): boolean {
    return this.ultimateCooldownRemainMs <= 0 && this.ultimateCharge >= 1;
  }

  private tickCooldowns(dtMs: number): void {
    if (this.heavyCooldownRemainMs > 0) {
      this.heavyCooldownRemainMs = Math.max(0, this.heavyCooldownRemainMs - dtMs);
    }
    if (this.ultimateCooldownRemainMs > 0) {
      this.ultimateCooldownRemainMs = Math.max(0, this.ultimateCooldownRemainMs - dtMs);
      if (this.ultimateCooldownRemainMs <= 0 && this.ultimateCharge < 1) {
        // Cooldown gate refill — later replaced by damage-earned charge.
        this.ultimateCharge = 1;
      }
    }
  }

  private tickProjectiles(dtMs: number, targets: readonly Damageable[]): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]!;
      bolt.update(dtMs, targets);
      const hitDmg = bolt.consumeHitDamage();
      if (hitDmg > 0) {
        this.lastHitDamage = hitDmg;
        this.addUltimateCharge(0.06);
      }
      if (!bolt.alive) this.bolts.splice(i, 1);
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i]!;
      pulse.update(dtMs);
      if (!pulse.alive) this.pulses.splice(i, 1);
    }
  }

  private beginKick(player: Player): void {
    const kick = dorothyKickCombo[this.comboIndex] ?? dorothyKickCombo[0]!;
    this.attackRemainMs = kick.durationMs;
    player.startLightAttack(kick, this.comboIndex, () => {
      this.comboIndex = (this.comboIndex + 1) % dorothyKickCombo.length;
      this.comboTimerMs = tuning.comboWindowMs;
    });
  }

  private beginHeavy(player: Player): void {
    this.heavyCooldownRemainMs = tuning.heavyCooldownMs;
    player.startCombatLock('heavyAttack', tuning.heavyAttackDurationMs);
    this.bolts.push(
      new RedEnergyBolt(this.scene, {
        floorX: player.floorX + player.facing * 12,
        floorY: player.floorY,
        facing: player.facing,
      }),
    );
  }

  private beginUltimate(player: Player): void {
    this.ultimateCharge = 0;
    this.ultimateCooldownRemainMs = tuning.ultimateCooldownMs;
    this.ultimateWindupRemainMs = tuning.ultimateWindupMs;
    this.ultimateTargetsAcquired = 0;
    player.startCombatLock('ultimate', tuning.ultimateWindupMs + 10_000);
  }

  private detonateUltimate(player: Player, targets: readonly Damageable[]): void {
    const acquired = acquireNearestTargets(
      { floorX: player.floorX, floorY: player.floorY },
      targets,
      tuning.ultimateAcquireRange,
      tuning.ultimateMaxTargets,
    );
    this.ultimateTargetsAcquired = acquired.length;

    for (const t of acquired) {
      const dealt = t.health.applyDamage(tuning.ultimateDamage, {
        kind: 'player-ultimate',
        id: 'triple-heel-pulse',
      });
      if (dealt > 0) {
        this.lastHitDamage = dealt;
        const dx = t.floorX - player.floorX;
        const dy = t.floorY - player.floorY;
        const len = Math.hypot(dx, dy) || 1;
        t.applyKnockback?.(
          (dx / len) * tuning.ultimateKnockback,
          (dy / len) * tuning.ultimateKnockback * 0.5,
        );
        t.onHitFeel?.(dealt);
        spawnDamageNumber(this.scene, t.floorX, t.floorY, dealt);
      }

      // AoE around each acquired target — splash nearby living enemies in pulse radius.
      for (const other of targets) {
        if (other === t || other.health.isDead) continue;
        const d = Math.hypot(other.floorX - t.floorX, other.floorY - t.floorY);
        if (d > tuning.ultimatePulseRadius) continue;
        const splash = other.health.applyDamage(tuning.ultimateDamage * 0.6, {
          kind: 'player-ultimate',
          id: 'triple-heel-pulse-aoe',
        });
        if (splash > 0) {
          other.onHitFeel?.(splash);
          spawnDamageNumber(this.scene, other.floorX, other.floorY, splash);
        }
      }

      this.pulses.push(new RedEnergyPulse(this.scene, t.floorX, t.floorY));
    }

    if (acquired.length > 0) hitStop(this.scene);
  }

  private ensureSlippers(player: Player): void {
    if (this.slippersWired) return;
    this.slippersWired = true;
    player.health.addModifier((amount) => amount * (1 - tuning.slipperDamageReduction));
  }
}

class PlaceholderCombat implements CombatController {
  comboIndex = 0;
  lastHitDamage = 0;
  heavyCooldownRemainMs = 0;
  ultimateCooldownRemainMs = 0;
  ultimateCharge = 0;
  ultimateTargetsAcquired = 0;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(player: Player, input: Input, dtMs: number, targets: readonly Damageable[]): void {
    if (player.state === 'lightAttack') {
      player.tickLightAttack(dtMs, targets, (dmg, tx, ty) => {
        this.lastHitDamage = dmg;
        spawnDamageNumber(this.scene, tx, ty, dmg);
        hitStop(this.scene);
      });
      return;
    }

    if (input.justDown('lightAttack') && player.canStartAttack()) {
      player.startLightAttack(placeholderKick, 0, () => {
        this.comboIndex = 0;
      });
    }
  }
}
