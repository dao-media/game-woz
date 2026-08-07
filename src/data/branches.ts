import { tuning } from '../config/tuning';
import { Projection } from '../core/Projection';

/**
 * Fork branches — chosen by the player's floorY (depth) at the split.
 */
export type ForkBranch = {
  id: string;
  label: string;
  floorYMin: number;
  floorYMax: number;
  destination: string;
};

const span = tuning.depthNear - tuning.depthFar;

export const forkBranches: ForkBranch[] = [
  {
    id: 'emerald',
    label: 'Emerald City Road',
    floorYMin: tuning.depthFar + (2 * span) / 3,
    floorYMax: tuning.depthNear + 0.001,
    destination: 'the Emerald City',
  },
  {
    id: 'west',
    label: 'Westward Path',
    floorYMin: tuning.depthFar + span / 3,
    floorYMax: tuning.depthFar + (2 * span) / 3,
    destination: 'the land of the Winkies',
  },
  {
    id: 'south',
    label: 'Southern Trail',
    floorYMin: tuning.depthFar,
    floorYMax: tuning.depthFar + span / 3,
    destination: 'Quadling Country',
  },
];

export function getBranchById(id: string): ForkBranch | undefined {
  return forkBranches.find((b) => b.id === id);
}

export function branchForFloorY(floorY: number): ForkBranch {
  const y = Math.max(tuning.depthFar, Math.min(tuning.depthNear, floorY));
  return (
    forkBranches.find((b) => y >= b.floorYMin && y < b.floorYMax) ??
    forkBranches[forkBranches.length - 1]!
  );
}

export function branchForDepth(depth01: number): ForkBranch {
  return branchForFloorY(Projection.depth01ToFloorY(depth01));
}

export const DEFAULT_BRANCH_ID = forkBranches[0]!.id;
