/**
 * Data-driven scenery on depth tracks (décor only — not player lanes).
 * `beyond` sits on the grass strip outside the far fence.
 */
export type SceneryKind = 'post' | 'tree' | 'marker' | 'crate';
export type SceneryTrack = 'beyond' | 'far' | 'midFar' | 'mid' | 'near';

export type SceneryDef = {
  kind: SceneryKind;
  floorX: number;
  track: SceneryTrack;
  label?: string;
};

export const munchkinScenery: SceneryDef[] = [
  { kind: 'tree', floorX: 200, track: 'beyond' },
  { kind: 'tree', floorX: 480, track: 'beyond' },
  { kind: 'tree', floorX: 760, track: 'beyond' },
  { kind: 'tree', floorX: 1080, track: 'beyond' },
  { kind: 'tree', floorX: 300, track: 'far' },
  { kind: 'tree', floorX: 520, track: 'midFar' },
  { kind: 'crate', floorX: 700, track: 'near' },
  { kind: 'tree', floorX: 700, track: 'far' },
  { kind: 'marker', floorX: 900, track: 'mid', label: 'FORK' },
  { kind: 'marker', floorX: 940, track: 'near', label: 'Emerald City Road' },
  { kind: 'marker', floorX: 940, track: 'mid', label: 'Westward Path' },
  { kind: 'marker', floorX: 940, track: 'far', label: 'Southern Trail' },
  { kind: 'tree', floorX: 1100, track: 'midFar' },
];

export const gameScenery: SceneryDef[] = [
  { kind: 'tree', floorX: 220, track: 'beyond' },
  { kind: 'tree', floorX: 560, track: 'beyond' },
  { kind: 'tree', floorX: 920, track: 'beyond' },
  { kind: 'tree', floorX: 1280, track: 'beyond' },
  { kind: 'tree', floorX: 1680, track: 'beyond' },
  { kind: 'tree', floorX: 2100, track: 'beyond' },
  { kind: 'tree', floorX: 300, track: 'far' },
  { kind: 'crate', floorX: 520, track: 'near' },
  { kind: 'tree', floorX: 520, track: 'midFar' },
  { kind: 'tree', floorX: 780, track: 'far' },
  { kind: 'tree', floorX: 1100, track: 'midFar' },
  { kind: 'crate', floorX: 1500, track: 'near' },
  { kind: 'tree', floorX: 1500, track: 'far' },
  { kind: 'tree', floorX: 1900, track: 'midFar' },
];
