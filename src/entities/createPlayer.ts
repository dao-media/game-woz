import type Phaser from 'phaser';
import { playerDef } from '../data/entities';
import { Player } from './Player';
import { createCombatController } from '../combat/CombatController';

/**
 * Single seam for character → Player + combat kit.
 * Dorothy gets slippers + 3-kick; others get placeholder kick.
 */
export function createPlayer(
  scene: Phaser.Scene,
  characterId: string,
  spawn: { floorX: number; floorY: number },
  bounds: { xMin: number; xMax: number },
): Player {
  const player = new Player(scene, playerDef, spawn, bounds, characterId);
  player.combat = createCombatController(characterId, scene);
  return player;
}
