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
 * Dorothy: slippers + rhythm light combo + heavy bolt + ultimate pulse.
 * Others: placeholder kick only.
 */
export interface CombatController {
  readonly comboIndex: number;
  readonly lastHitDamage: number;
  /** Remaining heavy cooldown (ms). */
  readonly heavyCooldownRemainMs: number;
  /** Remaining ultimate cooldown (ms). */
  readonly ultimateCooldownRemainMs: number;
  /** Earned ultimate charge 0–1 (passive + landed hits). */
  readonly ultimateCharge: number;
  /** Last ultimate acquire count (for debug). */
  readonly ultimateTargetsAcquired: number;

  /** Rhythm combo: how many markers are lit (0–3). */
  readonly comboMarkersLit: number;
  /** True while marker 2 or 3 timing window is open. */
  readonly comboWindowActive: boolean;
  /** Which marker (2 or 3) has an open window, else null. */
  readonly comboWindowTarget: 2 | 3 | null;
  /** Charge added by the most recent landed kick or laser (debug). */
  readonly lastUltimateChargeAdded: number;

  update(player: Player, input: Input, dtMs: number, targets: readonly Damageable[]): void;
  tickPassive?(player: Player, dtMs: number): void;
  addUltimateCharge?(amount: number): void;
  /** Debug: set charge to full and clear ult cooldown (F3 + P). */
  forceDebugChargeFull(): void;
}

export function createCombatController(
  characterId: string,
  scene: Phaser.Scene,
): CombatController {
  if (characterId === 'dorothy') return new DorothyCombat(scene);
  return new PlaceholderCombat(scene);
}

const KICK_CHARGE_BY_INDEX = [
  tuning.ultimateChargeKick1,
  tuning.ultimateChargeKick2,
  tuning.ultimateChargeKick3,
] as const;

class DorothyCombat implements CombatController {
  comboIndex = 0;
  lastHitDamage = 0;
  heavyCooldownRemainMs = 0;
  ultimateCooldownRemainMs = 0;
  ultimateCharge = 0;
  ultimateTargetsAcquired = 0;

  comboMarkersLit = 0;
  comboWindowActive = false;
  comboWindowTarget: 2 | 3 | null = null;
  lastUltimateChargeAdded = 0;

  private waitingForComboInput = false;
  private timeSinceKickEndMs = 0;
  private windowOpenMs = 0;
  private windowCloseMs = 0;
  private currentKickIndex = 0;
  private pendingComboPress = false;
  private kickChargeApplied = false;
  private attackRemainMs = 0;
  private ultimateWindupRemainMs = 0;
  private readonly bolts: RedEnergyBolt[] = [];
  private readonly pulses: RedEnergyPulse[] = [];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  addUltimateCharge(amount: number): void {
    if (amount <= 0) return;
    this.ultimateCharge = Math.min(1, Math.max(0, this.ultimateCharge + amount));
  }

  forceDebugChargeFull(): void {
    if (!tuning.debugForceUltimate) return;
    this.ultimateCooldownRemainMs = 0;
    this.ultimateCharge = 1;
  }

  tickPassive(player: Player, dtMs: number): void {
    this.ensureSlippers(player);
    if (player.health.isDead) return;
    player.health.heal(tuning.slipperRegenPerSec * (dtMs / 1000));
    const passiveRate = 1 / tuning.ultimateBaseChargeSeconds;
    this.addUltimateCharge(passiveRate * (dtMs / 1000));
  }

  update(player: Player, input: Input, dtMs: number, targets: readonly Damageable[]): void {
    this.ensureSlippers(player);
    this.tickCooldowns(dtMs);
    this.tickProjectiles(dtMs, targets);
    this.tickComboWindow(dtMs);

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
      if (input.justDown('lightAttack')) {
        this.pendingComboPress = true;
      }
      this.attackRemainMs = Math.max(0, this.attackRemainMs - dtMs);

      player.tickLightAttack(dtMs, targets, (dmg, tx, ty) => {
        this.lastHitDamage = dmg;
        spawnDamageNumber(this.scene, tx, ty, dmg);
        hitStop(this.scene);
        if (dmg > 0 && !this.kickChargeApplied) {
          this.kickChargeApplied = true;
          const charge = KICK_CHARGE_BY_INDEX[this.currentKickIndex] ?? 0;
          this.lastUltimateChargeAdded = charge;
          this.addUltimateCharge(charge);
        }
      });

      if (player.state !== 'lightAttack') {
        this.onKickAnimComplete(player);
      }
      return;
    }

    if (this.pendingComboPress) {
      this.pendingComboPress = false;
      if (this.waitingForComboInput) {
        this.handleComboPress(player);
      } else if (player.canStartAttack()) {
        this.beginKick(player, 0);
      }
      return;
    }

    if (input.justDown('lightAttack')) {
      if (this.waitingForComboInput) {
        this.handleComboPress(player);
        return;
      }
      if (player.canStartAttack()) {
        this.beginKick(player, 0);
      }
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
    }
  }

  private tickComboWindow(dtMs: number): void {
    if (!this.waitingForComboInput) {
      this.comboWindowActive = false;
      this.comboWindowTarget = null;
      return;
    }

    this.timeSinceKickEndMs += dtMs;
    const open = this.timeSinceKickEndMs >= this.windowOpenMs;
    const closed = this.timeSinceKickEndMs > this.windowCloseMs;
    this.comboWindowActive = open && !closed;

    if (closed) {
      this.resetComboChain();
    }
  }

  private tickProjectiles(dtMs: number, targets: readonly Damageable[]): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]!;
      bolt.update(dtMs, targets);
      const hitDmg = bolt.consumeHitDamage();
      if (hitDmg > 0) {
        this.lastHitDamage = hitDmg;
        this.lastUltimateChargeAdded = tuning.ultimateChargePerLaserHit;
        this.addUltimateCharge(tuning.ultimateChargePerLaserHit);
      }
      if (!bolt.alive) this.bolts.splice(i, 1);
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i]!;
      pulse.update(dtMs);
      if (!pulse.alive) this.pulses.splice(i, 1);
    }
  }

  private handleComboPress(player: Player): void {
    if (!this.waitingForComboInput) return;

    const t = this.timeSinceKickEndMs;
    if (t < this.windowOpenMs) {
      // Mash / early — restart at kick 1.
      this.resetComboChain();
      this.beginKick(player, 0);
      return;
    }

    if (t <= this.windowCloseMs) {
      const nextKick = this.comboWindowTarget === 2 ? 1 : 2;
      this.waitingForComboInput = false;
      this.comboWindowActive = false;
      this.comboWindowTarget = null;
      this.beginKick(player, nextKick);
    }
  }

  private beginKick(player: Player, kickIndex: number): void {
    const kick = dorothyKickCombo[kickIndex] ?? dorothyKickCombo[0]!;
    this.currentKickIndex = kickIndex;
    this.comboIndex = kickIndex;
    this.waitingForComboInput = false;
    this.timeSinceKickEndMs = 0;
    this.comboWindowActive = false;
    this.comboWindowTarget = null;
    this.comboMarkersLit = kickIndex + 1;
    this.kickChargeApplied = false;
    this.attackRemainMs = kick.durationMs;

    player.startLightAttack(kick, kickIndex, () => {
      /* completion handled in onKickAnimComplete */
    });
  }

  private onKickAnimComplete(player: Player): void {
    const kickIndex = this.currentKickIndex;
    this.comboMarkersLit = kickIndex + 1;
    if (!this.kickChargeApplied) {
      this.lastUltimateChargeAdded = 0;
    }
    if (kickIndex >= dorothyKickCombo.length - 1) {
      this.resetComboChain();
      return;
    }

    this.waitingForComboInput = true;
    this.timeSinceKickEndMs = 0;
    if (kickIndex === 0) {
      this.windowOpenMs = tuning.comboWindow2OpenMs;
      this.windowCloseMs = tuning.comboWindow2CloseMs;
      this.comboWindowTarget = 2;
    } else {
      this.windowOpenMs = tuning.comboWindow3OpenMs;
      this.windowCloseMs = tuning.comboWindow3CloseMs;
      this.comboWindowTarget = 3;
    }
    this.comboWindowActive = this.timeSinceKickEndMs >= this.windowOpenMs;

    if (this.pendingComboPress) {
      this.pendingComboPress = false;
      this.handleComboPress(player);
    }
  }

  private resetComboChain(): void {
    this.waitingForComboInput = false;
    this.timeSinceKickEndMs = 0;
    this.comboWindowActive = false;
    this.comboWindowTarget = null;
    this.comboMarkersLit = 0;
    this.comboIndex = 0;
    this.currentKickIndex = 0;
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
    this.lastUltimateChargeAdded = 0;
    this.ultimateCooldownRemainMs = tuning.ultimateCooldownMs;
    this.ultimateWindupRemainMs = tuning.ultimateWindupMs;
    this.ultimateTargetsAcquired = 0;
    this.resetComboChain();
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

  private slippersWired = false;
}

class PlaceholderCombat implements CombatController {
  comboIndex = 0;
  lastHitDamage = 0;
  heavyCooldownRemainMs = 0;
  ultimateCooldownRemainMs = 0;
  ultimateCharge = 0;
  ultimateTargetsAcquired = 0;
  comboMarkersLit = 0;
  comboWindowActive = false;
  comboWindowTarget: 2 | 3 | null = null;
  lastUltimateChargeAdded = 0;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  forceDebugChargeFull(): void {
    if (!tuning.debugForceUltimate) return;
    this.ultimateCooldownRemainMs = 0;
    this.ultimateCharge = 1;
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
