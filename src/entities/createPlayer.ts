import type Phaser from 'phaser';
import { playerDef } from '../data/entities';
import { Player } from './Player';

/**
 * Single seam for character → Player. All ids are greybox travelers for now.
 */
export function createPlayer(
  scene: Phaser.Scene,
  characterId: string,
  spawn: { floorX: number; floorY: number },
  bounds: { xMin: number; xMax: number },
): Player {
  void characterId;
  return new Player(scene, playerDef, spawn, bounds, characterId);
}
