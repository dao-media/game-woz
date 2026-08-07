import { tuning } from '../config/tuning';
import type { Health, DamageSource } from './Health';

export type AttackShape = 'arc' | 'rect' | 'circle';

/** Data-driven attack definition — resolved in floor space. */
export type AttackDef = {
  id: string;
  shape: AttackShape;
  /** Reach along facing in floor units (arc/rect) or radius (circle). */
  floorRange: number;
  /** Half-angle of frontal arc in degrees (arc only). */
  halfAngleDeg?: number;
  /** Depth (floorY) half-width for rect; unused for arc/circle. */
  floorYHalfWidth?: number;
  damage: number;
  knockback: number;
  /** Duration of the whole attack anim / lock (ms). */
  durationMs: number;
  /** Hit box active window within the attack (ms from start). */
  activeStartMs: number;
  activeEndMs: number;
};

export type FloorPose = {
  floorX: number;
  floorY: number;
  /** +1 = facing east (right), −1 = west (left). */
  facing: 1 | -1;
};

export type Damageable = {
  floorX: number;
  floorY: number;
  health: Health;
  /** Apply knockback impulse in floor space. */
  applyKnockback?: (dx: number, dy: number) => void;
  /** Invoked for hit-feel (flash, etc.). */
  onHitFeel?: (damage: number) => void;
};

export type AttackHit = {
  target: Damageable;
  damage: number;
};

/**
 * Resolve an attack against damageables in floor space.
 * Hits each target at most once per activation (caller tracks hit set).
 */
export function resolveAttack(
  attack: AttackDef,
  origin: FloorPose,
  targets: readonly Damageable[],
  alreadyHit: Set<Damageable>,
  source: DamageSource,
): AttackHit[] {
  const hits: AttackHit[] = [];

  for (const target of targets) {
    if (alreadyHit.has(target) || target.health.isDead) continue;
    if (!isInAttackArea(attack, origin, target.floorX, target.floorY)) continue;

    const dealt = target.health.applyDamage(attack.damage, source);
    if (dealt <= 0) continue;

    alreadyHit.add(target);

    if (attack.knockback > 0 && target.applyKnockback) {
      const dx = target.floorX - origin.floorX;
      const dy = target.floorY - origin.floorY;
      const len = Math.hypot(dx, dy) || 1;
      const strength = attack.knockback || tuning.knockbackStrength;
      target.applyKnockback((dx / len) * strength, (dy / len) * strength);
    }

    target.onHitFeel?.(dealt);
    hits.push({ target, damage: dealt });
  }

  return hits;
}

export function isInAttackArea(
  attack: AttackDef,
  origin: FloorPose,
  tx: number,
  ty: number,
): boolean {
  const dx = tx - origin.floorX;
  const dy = ty - origin.floorY;
  const dist = Math.hypot(dx, dy);

  if (attack.shape === 'circle') {
    return dist <= attack.floorRange;
  }

  // Must be roughly in facing hemisphere and within range.
  if (dist > attack.floorRange || dist < 0.001) return false;
  const facingDot = dx * origin.facing;
  if (facingDot < 0) return false;

  if (attack.shape === 'rect') {
    const halfY = attack.floorYHalfWidth ?? attack.floorRange * 0.45;
    return Math.abs(dy) <= halfY && Math.abs(dx) <= attack.floorRange;
  }

  // arc — angle from facing axis (+X when facing east).
  const angle = Math.atan2(dy, dx * origin.facing);
  const half = ((attack.halfAngleDeg ?? 50) * Math.PI) / 180;
  return Math.abs(angle) <= half;
}

export function clampFloorY(y: number): number {
  return Math.max(tuning.depthFar, Math.min(tuning.depthNear, y));
}
