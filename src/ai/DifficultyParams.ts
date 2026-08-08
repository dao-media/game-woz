import { tuning } from '../config/tuning';

/** Slider-ready difficulty block — AI and (later) director read this only. */
export type DifficultyParams = {
  /** Decision cadence / reaction latency (ms). */
  reactionDelayMs: number;
  /** 0–1: how reliably punish windows are exploited. */
  punishAccuracy: number;
  /** Multiplier on attack windup length (>1 = longer warning). */
  telegraphMult: number;
  /** Floor-space awareness radius. */
  perceptionRange: number;
  /** How readily a hurt enemy disengages. */
  retreatBias: number;
  /** Phase B: max concurrent committing attackers. */
  maxSimultaneousAttackers: number;
  /** Phase B: ms between token grants. */
  commitCadenceMs: number;
  /** Minor HP scale (~±25%). */
  hpMult: number;
  /** Minor damage scale (~±25%). */
  damageMult: number;
};

export type DifficultyId = 'easy' | 'normal' | 'hard' | 'custom';

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

export function resolveDifficultyParams(
  id: DifficultyId,
  custom?: Partial<DifficultyParams>,
): DifficultyParams {
  if (id === 'custom') {
    return {
      ...tuning.difficultyPresets.normal,
      ...custom,
    };
  }
  return { ...tuning.difficultyPresets[id] };
}

export function clampDifficultyMult(n: number): number {
  return Math.max(0.75, Math.min(1.25, n));
}
