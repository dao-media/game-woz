/**
 * Yellow Brick Road paths. Each run picks one path; each terminates at a
 * different place in Oz. Encounter graphs / lengths come later — scaffold only.
 */
export type RoadPath = {
  id: string;
  name: string;
  /** Oz location where this path ends (shown on win). */
  destination: string;
  blurb: string;
  /** Floor-plane length of this lane (world width). */
  worldWidth: number;
};

export const roadPaths: RoadPath[] = [
  {
    id: 'emerald',
    name: 'Road to the Emerald City',
    destination: 'the Emerald City',
    blurb: 'The classic route — straight to the Wizard’s gates.',
    worldWidth: 2400,
  },
  {
    id: 'west',
    name: 'Westward Path',
    destination: 'the land of the Winkies',
    blurb: 'Toward the Wicked Witch of the West’s domain.',
    worldWidth: 2800,
  },
  {
    id: 'south',
    name: 'Southern Trail',
    destination: 'Quadling Country',
    blurb: 'Through fighting trees and stranger folk.',
    worldWidth: 2600,
  },
  {
    id: 'nome',
    name: 'Underground Cut',
    destination: 'the Nome Kingdom',
    blurb: 'A darker road beneath the surface of Oz.',
    worldWidth: 3000,
  },
];

export function getPathById(id: string): RoadPath | undefined {
  return roadPaths.find((p) => p.id === id);
}

export const DEFAULT_PATH_ID = roadPaths[0]!.id;
