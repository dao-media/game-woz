import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { clampFloorY } from '../combat/Attack';
import type { ActionId } from './UtilityAI';
import type { Perception } from './Perception';
import type { DifficultyParams } from './DifficultyParams';
import type { EnemyDef } from '../data/enemies';

export type ExecutorState =
  | 'idle'
  | 'move'
  | 'dive'
  | 'charge'
  | 'attack'
  | 'recover';

type MotorTarget = {
  floorX: number;
  floorY: number;
  z: number;
};

/**
 * Thin motor FSM — carries out utility intent; does not decide strategy.
 */
export class Executor {
  state: ExecutorState = 'idle';
  private intent: ActionId = 'circle';
  private timerMs = 0;
  private flankSign: 1 | -1 = 1;
  private divePhase: 'telegraph' | 'descend' | 'strike' | 'climb' = 'telegraph';

  get currentIntent(): ActionId {
    return this.intent;
  }

  setIntent(intent: ActionId, difficulty: DifficultyParams): void {
    if (intent === this.intent && this.state !== 'idle' && this.state !== 'move') {
      // Don't interrupt dive/charge/attack/recover mid-motor.
      if (
        this.state === 'dive' ||
        this.state === 'charge' ||
        this.state === 'attack' ||
        this.state === 'recover'
      ) {
        return;
      }
    }
    this.intent = intent;
    this.beginIntent(intent, difficulty);
  }

  /** Force recover after a successful contact hit. */
  forceRecover(difficulty: DifficultyParams): void {
    this.intent = 'recover';
    this.state = 'recover';
    this.timerMs = tuning.enemyRecoverMs * difficulty.telegraphMult;
  }

  private beginIntent(intent: ActionId, difficulty: DifficultyParams): void {
    const tel = tuning.enemyAttackTelegraphMs * difficulty.telegraphMult;
    this.flankSign = Math.random() < 0.5 ? -1 : 1;

    switch (intent) {
      case 'dive-attack':
        this.state = 'dive';
        this.divePhase = 'telegraph';
        this.timerMs = tel;
        break;
      case 'charge':
        this.state = 'charge';
        this.timerMs = tel * 0.6;
        break;
      case 'attack-lunge':
        this.state = 'attack';
        this.timerMs = tel * 0.5;
        break;
      case 'recover':
      case 'retreat':
        this.state = 'recover';
        this.timerMs = tuning.enemyRecoverMs * difficulty.telegraphMult;
        break;
      case 'maintain-standoff':
      case 'bait':
      case 'circle':
      case 'reposition':
      default:
        this.state = 'move';
        this.timerMs = 0;
        break;
    }
  }

  /**
   * Advance motor; mutates enemy floor pose via callbacks.
   * Returns whether contact strike is active this frame.
   */
  tick(
    dtMs: number,
    def: EnemyDef,
    pose: { floorX: number; floorY: number; z: number },
    p: Perception,
    applyPose: (next: MotorTarget) => void,
  ): { striking: boolean } {
    const dt = dtMs / 1000;
    let striking = false;

    if (this.state === 'dive') {
      return this.tickDive(dtMs, dt, def, pose, p, applyPose);
    }

    if (this.state === 'charge') {
      if (this.timerMs > 0) {
        this.timerMs -= dtMs;
        return { striking: false };
      }
      const speed = tuning.wheelerChargeSpeed;
      const targetX = p.playerFloorX;
      const targetY = Phaser.Math.Linear(pose.floorY, p.playerFloorY, 0.08);
      const dx = targetX - pose.floorX;
      const dist = Math.abs(dx) || 1;
      const step = Math.min(speed * dt, dist);
      const nx = pose.floorX + Math.sign(dx) * step;
      applyPose({ floorX: nx, floorY: clampFloorY(targetY), z: 0 });
      if (Math.hypot(p.playerFloorX - nx, p.playerFloorY - targetY) <= tuning.wheelerLungeRange) {
        this.state = 'attack';
        this.timerMs = 180;
        striking = true;
      }
      return { striking };
    }

    if (this.state === 'attack') {
      this.timerMs -= dtMs;
      striking = this.timerMs > 0;
      if (this.timerMs <= 0) {
        this.forceRecover(p.difficulty);
      }
      return { striking };
    }

    if (this.state === 'recover') {
      this.timerMs -= dtMs;
      const away = pose.floorX < p.playerFloorX ? -1 : 1;
      const speed = def.moveSpeed * 0.7;
      applyPose({
        floorX: pose.floorX + away * speed * dt,
        floorY: clampFloorY(pose.floorY + this.flankSign * 20 * dt),
        z: def.grounded ? 0 : Math.min(def.hoverZ, pose.z + 40 * dt),
      });
      if (this.timerMs <= 0) {
        this.state = 'move';
        this.intent = def.grounded ? 'circle' : 'maintain-standoff';
      }
      return { striking: false };
    }

    // move / idle — follow intent steering
    const target = this.steerTarget(def, pose, p);
    const speed = def.moveSpeed;
    const dx = target.floorX - pose.floorX;
    const dy = target.floorY - pose.floorY;
    const dz = target.z - pose.z;
    const len = Math.hypot(dx, dy) || 1;
    const step = Math.min(speed * dt, len);
    applyPose({
      floorX: pose.floorX + (dx / len) * step,
      floorY: clampFloorY(pose.floorY + (dy / len) * step),
      z: Phaser.Math.Clamp(pose.z + Phaser.Math.Clamp(dz, -80 * dt, 80 * dt), 0, 90),
    });
    this.state = 'move';
    return { striking: false };
  }

  private tickDive(
    dtMs: number,
    dt: number,
    def: EnemyDef,
    pose: { floorX: number; floorY: number; z: number },
    p: Perception,
    applyPose: (next: MotorTarget) => void,
  ): { striking: boolean } {
    if (this.divePhase === 'telegraph') {
      this.timerMs -= dtMs;
      // Hover in place as windup.
      applyPose({
        floorX: pose.floorX,
        floorY: pose.floorY,
        z: def.hoverZ,
      });
      if (this.timerMs <= 0) this.divePhase = 'descend';
      return { striking: false };
    }

    if (this.divePhase === 'descend' || this.divePhase === 'strike') {
      const speed = tuning.monkeyDiveSpeed;
      const tx = p.playerFloorX;
      const ty = p.playerFloorY;
      const tz = tuning.monkeyDiveZ;
      const dx = tx - pose.floorX;
      const dy = ty - pose.floorY;
      const dz = tz - pose.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const step = Math.min(speed * dt, len);
      const nx = pose.floorX + (dx / len) * step;
      const ny = clampFloorY(pose.floorY + (dy / len) * step);
      const nz = Math.max(0, pose.z + (dz / len) * step);
      applyPose({ floorX: nx, floorY: ny, z: nz });

      const close =
        Math.hypot(tx - nx, ty - ny) < tuning.enemyContactRadius * 1.2 && nz < 20;
      if (close) {
        this.divePhase = 'climb';
        this.timerMs = 280;
        return { striking: true };
      }
      return { striking: false };
    }

    // climb
    this.timerMs -= dtMs;
    const away = pose.floorX < p.playerFloorX ? -1 : 1;
    applyPose({
      floorX: pose.floorX + away * def.moveSpeed * 0.8 * dt,
      floorY: clampFloorY(pose.floorY + this.flankSign * 30 * dt),
      z: Math.min(def.hoverZ, pose.z + 90 * dt),
    });
    if (this.timerMs <= 0 && pose.z >= def.hoverZ * 0.85) {
      this.forceRecover(p.difficulty);
    }
    return { striking: false };
  }

  private steerTarget(
    def: EnemyDef,
    pose: { floorX: number; floorY: number; z: number },
    p: Perception,
  ): MotorTarget {
    const hoverZ = def.grounded ? 0 : def.hoverZ;

    switch (this.intent) {
      case 'maintain-standoff':
      case 'bait': {
        const ideal = tuning.monkeyStandoffDist;
        const ang = Math.atan2(pose.floorY - p.playerFloorY, pose.floorX - p.playerFloorX);
        return {
          floorX: p.playerFloorX + Math.cos(ang) * ideal,
          floorY: clampFloorY(p.playerFloorY + Math.sin(ang) * ideal * 0.35),
          z: hoverZ,
        };
      }
      case 'circle': {
        const side = this.flankSign;
        return {
          floorX: p.playerFloorX - Math.sign(p.dx || 1) * 90,
          floorY: clampFloorY(p.playerFloorY + side * 50),
          z: 0,
        };
      }
      case 'reposition': {
        return {
          floorX: pose.floorX + this.flankSign * 40,
          floorY: clampFloorY(p.playerFloorY + this.flankSign * 70),
          z: hoverZ,
        };
      }
      case 'retreat': {
        const away = pose.floorX < p.playerFloorX ? -1 : 1;
        return {
          floorX: pose.floorX + away * 120,
          floorY: clampFloorY(pose.floorY + this.flankSign * 40),
          z: hoverZ,
        };
      }
      default:
        return { floorX: pose.floorX, floorY: pose.floorY, z: hoverZ };
    }
  }
}
