import { tuning } from '../config/tuning';
import { Projection } from '../core/Projection';

/** Runtime copy of photos/Environment/YellowBrickRoad.jpg — originals stay put. */
export const YBR_GAME_DIR = 'models/ybr/game';
export const YBR_TEX = 'ybr-block';
export const YBR_FILE = 'YellowBrickRoad.jpg';

/** Source size of the authored block. */
export const YBR_SRC_W = 750;
export const YBR_SRC_H = 1359;

/** Behind characters/fence, above the grass floor fill. */
export const YBR_DEPTH = -900;

/**
 * Floor-Y subdivisions per block. Extra stops in the grass bands so a breeze
 * can lean blade tips without moving the bricks.
 */
export const YBR_GRASS_SLICES = 6;
export const YBR_BRICK_SLICES = 8;

/** 1 source-px overlap closes AA seams between repeats. */
const JOIN_OVERLAP_PX = 1;

/**
 * Converts one authored block's width into floor-X so the near edge matches
 * the texture aspect given the fence-to-fence screen height.
 */
export function ybrTileScale(): number {
  const screenH =
    (tuning.fenceNearFloorY - tuning.fenceFarFloorY) * tuning.foreshorten;
  const depth = Projection.depthScale(tuning.fenceNearFloorY);
  return screenH / YBR_SRC_H / Math.max(depth, 1e-6);
}

/** Floor-X span of one YBR block (the level measuring stick). */
export function ybrSegmentSpan(): number {
  return Math.max(1, YBR_SRC_W - JOIN_OVERLAP_PX) * ybrTileScale();
}

/** Level length in floor-X from a segment count (48, 64, …). */
export function ybrRoadLength(segments: number): number {
  return Math.max(0, segments) * ybrSegmentSpan();
}

export type YbrFloorVert = {
  floorX: number;
  floorY: number;
  /** 0 = far fence / top of texture, 1 = near fence / bottom. */
  t: number;
};

function ybrDepthStops(): number[] {
  const farBand = tuning.ybrGrassBandFar;
  const nearBand = tuning.ybrGrassBandNear;
  const brick0 = farBand;
  const brick1 = 1 - nearBand;
  const ts: number[] = [];
  for (let i = 0; i <= YBR_GRASS_SLICES; i++) {
    ts.push((farBand * i) / YBR_GRASS_SLICES);
  }
  for (let i = 1; i < YBR_BRICK_SLICES; i++) {
    ts.push(brick0 + (brick1 - brick0) * (i / YBR_BRICK_SLICES));
  }
  for (let i = 0; i <= YBR_GRASS_SLICES; i++) {
    ts.push(brick1 + (nearBand * i) / YBR_GRASS_SLICES);
  }
  return ts.filter((t, i) => i === 0 || t > ts[i - 1]! + 1e-6);
}

/** 1 at grass tips, 0 at the brick (roots stay planted). */
export function ybrGrassTipWeight(t: number): number {
  const farBand = tuning.ybrGrassBandFar;
  const nearBand = tuning.ybrGrassBandNear;
  if (t <= farBand) return 1 - t / Math.max(farBand, 1e-6);
  if (t >= 1 - nearBand) return (t - (1 - nearBand)) / Math.max(nearBand, 1e-6);
  return 0;
}

/** Unique grid + triangle indices for a run of floor-laid YBR blocks. */
export function buildYbrGeometry(segments: number): {
  vertices: number[];
  uvs: number[];
  indices: number[];
  uniqueFloor: YbrFloorVert[];
} {
  const span = ybrSegmentSpan();
  const stops = ybrDepthStops();
  const farY = tuning.fenceFarFloorY;
  const nearY = tuning.fenceNearFloorY;
  const vertices: number[] = [];
  const uvs: number[] = [];
  const uniqueFloor: YbrFloorVert[] = [];
  const indices: number[] = [];

  for (let s = 0; s < segments; s++) {
    const x0 = s * span;
    const x1 = x0 + span;
    const base = uniqueFloor.length;
    for (const t of stops) {
      const floorY = farY + (nearY - farY) * t;
      vertices.push(0, 0, 0, 0);
      uvs.push(0, t, 1, t);
      uniqueFloor.push({ floorX: x0, floorY, t }, { floorX: x1, floorY, t });
    }
    for (let d = 0; d < stops.length - 1; d++) {
      const i = base + d * 2;
      indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }

  return { vertices, uvs, indices, uniqueFloor };
}
