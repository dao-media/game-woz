import type { EnemyId } from './enemies';

export type EncounterSpawn = {
  enemyId: EnemyId;
  floorXOffset: number;
  floorY: number;
  delayMs: number;
};

export type EncounterWave = {
  enemies: EncounterSpawn[];
};

export type EncounterDef = {
  id: string;
  triggerFloorX: number;
  lockArena: boolean;
  /** Absolute west/east bounds when lockArena (optional; derived if omitted). */
  arenaWestFloorX?: number;
  arenaEastFloorX?: number;
  waves: EncounterWave[];
};

/** Road encounters for the Game continuation stretch. */
export const gameEncounters: EncounterDef[] = [
  {
    id: 'wheeler-rush',
    triggerFloorX: 380,
    lockArena: false,
    waves: [
      {
        enemies: [
          { enemyId: 'wheeler', floorXOffset: 40, floorY: 240, delayMs: 0 },
          { enemyId: 'wheeler', floorXOffset: 90, floorY: 340, delayMs: 350 },
        ],
      },
    ],
  },
  {
    id: 'monkey-harass',
    triggerFloorX: 720,
    lockArena: false,
    waves: [
      {
        enemies: [
          { enemyId: 'winged-monkey', floorXOffset: 60, floorY: 200, delayMs: 0 },
          { enemyId: 'winged-monkey', floorXOffset: 120, floorY: 320, delayMs: 400 },
        ],
      },
    ],
  },
  {
    id: 'mixed-arena',
    triggerFloorX: 1100,
    lockArena: true,
    arenaWestFloorX: 980,
    arenaEastFloorX: 1380,
    waves: [
      {
        enemies: [
          { enemyId: 'wheeler', floorXOffset: 50, floorY: 280, delayMs: 0 },
          { enemyId: 'winged-monkey', floorXOffset: 100, floorY: 200, delayMs: 200 },
          { enemyId: 'winged-monkey', floorXOffset: 140, floorY: 360, delayMs: 450 },
          { enemyId: 'wheeler', floorXOffset: 180, floorY: 320, delayMs: 700 },
        ],
      },
      {
        enemies: [
          { enemyId: 'wheeler', floorXOffset: 80, floorY: 250, delayMs: 0 },
          { enemyId: 'winged-monkey', floorXOffset: 130, floorY: 300, delayMs: 300 },
        ],
      },
    ],
  },
];
