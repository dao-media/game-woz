/**
 * Data-driven scenery on depth tracks (décor only — not player lanes).
 */
export type SceneryKind = 'post' | 'tree' | 'marker' | 'crate';
export type SceneryTrack = 'far' | 'midFar' | 'mid' | 'near';

export type SceneryDef = {
  kind: SceneryKind;
  floorX: number;
  track: SceneryTrack;
  label?: string;
};

export const munchkinScenery: SceneryDef[] = [
  { kind: 'post', floorX: 300, track: 'near' },
  { kind: 'post', floorX: 300, track: 'mid' },
  { kind: 'tree', floorX: 300, track: 'far' },
  { kind: 'post', floorX: 520, track: 'near' },
  { kind: 'tree', floorX: 520, track: 'midFar' },
  { kind: 'crate', floorX: 700, track: 'near' },
  { kind: 'post', floorX: 700, track: 'mid' },
  { kind: 'tree', floorX: 700, track: 'far' },
  { kind: 'marker', floorX: 900, track: 'mid', label: 'FORK' },
  { kind: 'marker', floorX: 940, track: 'near', label: 'Emerald City Road' },
  { kind: 'marker', floorX: 940, track: 'mid', label: 'Westward Path' },
  { kind: 'marker', floorX: 940, track: 'far', label: 'Southern Trail' },
  { kind: 'tree', floorX: 1100, track: 'midFar' },
  { kind: 'post', floorX: 1100, track: 'near' },
];

export const gameScenery: SceneryDef[] = [
  { kind: 'post', floorX: 300, track: 'near' },
  { kind: 'post', floorX: 300, track: 'mid' },
  { kind: 'tree', floorX: 300, track: 'far' },
  { kind: 'crate', floorX: 520, track: 'near' },
  { kind: 'tree', floorX: 520, track: 'midFar' },
  { kind: 'post', floorX: 780, track: 'near' },
  { kind: 'post', floorX: 780, track: 'mid' },
  { kind: 'tree', floorX: 780, track: 'far' },
  { kind: 'tree', floorX: 1100, track: 'midFar' },
  { kind: 'post', floorX: 1100, track: 'near' },
  { kind: 'crate', floorX: 1500, track: 'near' },
  { kind: 'post', floorX: 1500, track: 'mid' },
  { kind: 'tree', floorX: 1500, track: 'far' },
  { kind: 'tree', floorX: 1900, track: 'midFar' },
  { kind: 'post', floorX: 1900, track: 'near' },
];
