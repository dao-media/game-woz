import { tuning } from '../config/tuning';

export type EntityStats = {
  moveSpeedX: number;
  moveSpeedY: number;
  runSpeedMul: number;
  jumpVelocityZ: number;
  gravityZ: number;
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
    moveSpeedX: tuning.moveSpeedX,
    moveSpeedY: tuning.moveSpeedY,
    runSpeedMul: tuning.runSpeedMul,
    jumpVelocityZ: tuning.jumpVelocityZ,
    gravityZ: tuning.gravityZ,
  },
};

export const entityCatalog: Record<string, EntityDef> = {
  [playerDef.id]: playerDef,
};
