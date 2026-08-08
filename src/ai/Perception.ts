import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import type { DifficultyParams } from './DifficultyParams';
import { tuning } from '../config/tuning';

/** Snapshot an enemy reads when scoring actions. */
export type Perception = {
  dist: number;
  dx: number;
  dy: number;
  playerFloorX: number;
  playerFloorY: number;
  playerZ: number;
  playerFacing: 1 | -1;
  playerState: string;
  playerHeavyReady: boolean;
  playerUltimateWindup: boolean;
  playerCommitted: boolean;
  playerPunishable: boolean;
  playerGrounded: boolean;
  ownHpRatio: number;
  ownZ: number;
  allyMinDist: number;
  inPerception: boolean;
  /** Phase B: always true until director lands. */
  hasAttackToken: boolean;
  difficulty: DifficultyParams;
};

export function buildPerception(
  self: Enemy,
  player: Player,
  allies: readonly Enemy[],
  difficulty: DifficultyParams,
  hasAttackToken = true,
): Perception {
  const dx = player.floorX - self.floorX;
  const dy = player.floorY - self.floorY;
  const dist = Math.hypot(dx, dy);

  const playerCommitted =
    player.state === 'lightAttack' ||
    player.state === 'heavyAttack' ||
    player.state === 'ultimate';

  const playerPunishable =
    playerCommitted || player.isInAttackRecovery;

  let allyMinDist = Infinity;
  for (const a of allies) {
    if (a === self || !a.alive) continue;
    const d = Math.hypot(a.floorX - self.floorX, a.floorY - self.floorY);
    if (d < allyMinDist) allyMinDist = d;
  }
  if (!Number.isFinite(allyMinDist)) allyMinDist = 9999;

  return {
    dist,
    dx,
    dy,
    playerFloorX: player.floorX,
    playerFloorY: player.floorY,
    playerZ: player.z,
    playerFacing: player.facing,
    playerState: player.state,
    playerHeavyReady: player.heavyCooldownRemainMs <= 0,
    playerUltimateWindup: player.state === 'ultimate',
    playerCommitted,
    playerPunishable,
    playerGrounded: player.z <= 0,
    ownHpRatio: self.health.ratio,
    ownZ: self.z,
    allyMinDist,
    inPerception: dist <= difficulty.perceptionRange,
    hasAttackToken,
    difficulty,
  };
}

export function allyTooClose(p: Perception): boolean {
  return p.allyMinDist < tuning.enemyAllySpacing;
}
