import { tuning } from '../../config/tuning';
import { allyTooClose, type Perception } from '../Perception';
import type { UtilityBrain } from '../UtilityAI';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Winged monkey — air harass / punish dive. */
export const monkeyBrain: UtilityBrain = {
  candidates: [
    {
      id: 'maintain-standoff',
      score: (p: Perception) => {
        if (!p.inPerception) return 0.2;
        let s = 0.35;
        if (p.playerHeavyReady) s += 0.55;
        if (p.ownHpRatio < 0.4) s += 0.25 * p.difficulty.retreatBias;
        const ideal = tuning.monkeyStandoffDist;
        s += 0.2 * (1 - clamp01(Math.abs(p.dist - ideal) / ideal));
        return s;
      },
    },
    {
      id: 'dive-attack',
      score: (p: Perception) => {
        if (!p.inPerception) return 0;
        if (!p.hasAttackToken) return 0.05;
        let s = 0.1;
        const window =
          p.playerPunishable && !p.playerHeavyReady && p.playerGrounded;
        if (window) s += 0.7 * p.difficulty.punishAccuracy;
        else if (!p.playerHeavyReady && p.dist < tuning.monkeyStandoffDist * 1.2) {
          s += 0.25 * p.difficulty.punishAccuracy;
        }
        if (p.ownHpRatio < 0.25) s *= 0.4;
        return s;
      },
    },
    {
      id: 'retreat',
      score: (p: Perception) => {
        let s = 0.05;
        if (p.ownHpRatio < 0.45) s += 0.5 * p.difficulty.retreatBias;
        if (p.playerUltimateWindup) s += 0.45;
        if (p.playerHeavyReady && p.dist < 100) s += 0.3;
        return s;
      },
    },
    {
      id: 'reposition',
      score: (p: Perception) => {
        let s = 0.15;
        if (allyTooClose(p)) s += 0.55;
        if (Math.abs(p.dy) < 20 && p.dist < 180) s += 0.25;
        return s;
      },
    },
    {
      id: 'bait',
      score: (p: Perception) => {
        if (!p.inPerception) return 0.1;
        let s = 0.2;
        if (p.playerHeavyReady && p.dist > tuning.monkeyStandoffDist * 0.85) s += 0.4;
        if (!p.playerCommitted) s += 0.15;
        return s;
      },
    },
  ],
};
