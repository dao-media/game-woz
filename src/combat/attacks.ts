import { tuning } from '../config/tuning';
import type { AttackDef } from './Attack';

export const dorothyKickCombo: readonly AttackDef[] = [
  {
    id: 'dorothy-kick1',
    shape: 'arc',
    floorRange: tuning.kick1Range,
    halfAngleDeg: tuning.kick1HalfAngleDeg,
    damage: tuning.kick1Damage,
    knockback: 0,
    durationMs: tuning.kick1DurationMs,
    activeStartMs: tuning.kick1ActiveStartMs,
    activeEndMs: tuning.kick1ActiveEndMs,
  },
  {
    id: 'dorothy-kick2',
    shape: 'arc',
    floorRange: tuning.kick2Range,
    halfAngleDeg: tuning.kick2HalfAngleDeg,
    damage: tuning.kick2Damage,
    knockback: tuning.knockbackStrength * 0.35,
    durationMs: tuning.kick2DurationMs,
    activeStartMs: tuning.kick2ActiveStartMs,
    activeEndMs: tuning.kick2ActiveEndMs,
  },
  {
    id: 'dorothy-kick3',
    shape: 'arc',
    floorRange: tuning.kick3Range,
    halfAngleDeg: tuning.kick3HalfAngleDeg,
    damage: tuning.kick3Damage,
    knockback: tuning.kick3Knockback,
    durationMs: tuning.kick3DurationMs,
    activeStartMs: tuning.kick3ActiveStartMs,
    activeEndMs: tuning.kick3ActiveEndMs,
  },
];

export const placeholderKick: AttackDef = {
  id: 'placeholder-kick',
  shape: 'arc',
  floorRange: tuning.placeholderKickRange,
  halfAngleDeg: tuning.placeholderKickHalfAngleDeg,
  damage: tuning.placeholderKickDamage,
  knockback: tuning.knockbackStrength * 0.4,
  durationMs: tuning.placeholderKickDurationMs,
  activeStartMs: tuning.placeholderKickActiveStartMs,
  activeEndMs: tuning.placeholderKickActiveEndMs,
};
