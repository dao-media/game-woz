import type Phaser from 'phaser';
import { getEnemyDef, type EnemyId } from '../data/enemies';
import { Enemy } from './Enemy';
import { monkeyBrain } from '../ai/brains/monkeyBrain';
import { wheelerBrain } from '../ai/brains/wheelerBrain';
import type { DifficultyParams } from '../ai/DifficultyParams';
import type { UtilityBrain } from '../ai/UtilityAI';

/**
 * Single seam for enemyId → Enemy. Atlas/sprites drop in here later.
 */
export function createEnemy(
  scene: Phaser.Scene,
  enemyId: EnemyId | string,
  spawn: { floorX: number; floorY: number },
  difficulty: DifficultyParams,
): Enemy {
  const def = getEnemyDef(enemyId);
  if (!def) throw new Error(`createEnemy: unknown enemyId "${enemyId}"`);

  const brain: UtilityBrain =
    def.id === 'winged-monkey' ? monkeyBrain : wheelerBrain;

  const enemy = new Enemy(scene, def, spawn, brain, difficulty);
  enemy.beginSpawn();
  return enemy;
}
