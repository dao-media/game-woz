import { tuning } from '../config/tuning';

/**
 * Data-driven entity defs. Systems consume plain data + a behavior key.
 * Only the player exists today; enemies/bosses will share this shape.
 */
export type EntityStats = {
  moveSpeed: number;
  runSpeed: number;
  hopImpulse: number;
  zGravity: number;
};

export type EntityDef = {
  id: string;
  behavior: 'player';
  displayName: string;
  stats: EntityStats;
};

export const playerDef: EntityDef = {
  id: 'player',
  behavior: 'player',
  displayName: 'Traveler',
  stats: {
    moveSpeed: tuning.moveSpeed,
    runSpeed: tuning.runSpeed,
    hopImpulse: tuning.hopImpulse,
    zGravity: tuning.zGravity,
  },
};

export const entityCatalog: Record<string, EntityDef> = {
  [playerDef.id]: playerDef,
};
