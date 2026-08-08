import { tuning } from '../../config/tuning';
import { allyTooClose, type Perception } from '../Perception';
import type { UtilityBrain } from '../UtilityAI';

/** Wheeler — ground rush / circle pressure. */
export const wheelerBrain: UtilityBrain = {
  candidates: [
    {
      id: 'charge',
      score: (p: Perception) => {
        if (!p.inPerception) return 0.1;
        if (!p.hasAttackToken) return 0.05;
        let s = 0.15;
        const clearLine = Math.abs(p.dy) < 70 && p.dist > tuning.wheelerLungeRange;
        if (clearLine && p.hasAttackToken) s += 0.55;
        if (p.playerPunishable) s += 0.35 * p.difficulty.punishAccuracy;
        if (p.playerUltimateWindup) s *= 0.2;
        if (p.ownHpRatio < 0.3) s *= 0.5;
        return s;
      },
    },
    {
      id: 'attack-lunge',
      score: (p: Perception) => {
        if (p.dist > tuning.wheelerLungeRange * 1.35) return 0;
        let s = 0.6;
        if (p.playerPunishable) s += 0.25 * p.difficulty.punishAccuracy;
        if (!p.hasAttackToken) s *= 0.35;
        return s;
      },
    },
    {
      id: 'recover',
      score: (p: Perception) => {
        let s = 0.05;
        if (p.playerUltimateWindup) s += 0.7;
        if (p.playerCommitted && p.dist < 60) s += 0.35;
        return s;
      },
    },
    {
      id: 'circle',
      score: (p: Perception) => {
        if (!p.inPerception) return 0.25;
        let s = 0.35;
        if (!p.hasAttackToken) s += 0.4;
        if (!p.playerPunishable) s += 0.2;
        if (p.dist > tuning.wheelerLungeRange && p.dist < 160) s += 0.15;
        return s;
      },
    },
    {
      id: 'reposition',
      score: (p: Perception) => {
        let s = 0.1;
        if (allyTooClose(p)) s += 0.6;
        if (Math.abs(p.dy) < 25) s += 0.3;
        return s;
      },
    },
  ],
};
