import { tuning } from '../config/tuning';

export type FenceEdge = 'near' | 'far';

/** Sequence kinds — data, not new tool code. */
export type FenceTileKind = 'up_start' | 'up' | 'down' | 'down_end';

export type FenceVariant = {
  id: string;
  w: number;
  h: number;
  /** Source-px from canvas left to the rail join. Foliage may hang past this. */
  insetL: number;
  /** Source-px rail span (left join → right join). */
  joinW: number;
};

function tile(
  id: string,
  w: number,
  h: number,
  insetL = 0,
): FenceVariant {
  return { id, w, h, insetL, joinW: w - insetL };
}

/**
 * Authored tiles from photos/Environment/Fencing only (runtime copy:
 * models/fence/game). Up = pickets rise L→R; down = fall L→R.
 * Start has ground-braces on the left; end has ground-braces on the right.
 */
export const FENCE_VARIANTS: Record<FenceTileKind, readonly FenceVariant[]> = {
  up_start: [
    tile('Up_start-0', 445, 229),
    tile('Up_start-1', 464, 230),
    tile('Up_start-2', 559, 230),
    tile('Up_start-3', 530, 230),
  ],
  up: [
    tile('Up-0', 260, 230),
    tile('Up-1', 260, 230),
    tile('Up-2', 260, 230),
    tile('Up-3', 261, 229),
    tile('Up-4', 260, 230),
  ],
  down: [
    tile('Down-0', 260, 230),
    tile('Down-1', 260, 230),
    // Left foliage hangs past the rails — join on the rail, not the canvas.
    tile('Down-2', 299, 229, 39),
    tile('Down-3', 260, 230),
  ],
  down_end: [
    tile('Down_end-0', 447, 233),
    tile('Down_end-1', 493, 230),
    tile('Down_end-2', 454, 232),
  ],
};

/** 1 source-px overlap kills AA hairlines at rail joins. */
const JOIN_OVERLAP_PX = 1;

export type FenceSegmentDef = {
  kind: FenceTileKind;
  variant: FenceVariant;
  floorX: number;
  floorY: number;
  edge: FenceEdge;
};

export type FenceDef = {
  segments: FenceSegmentDef[];
};

export const FENCE_GAME_DIR = 'models/fence/game';

export function fenceTextureKey(id: string): string {
  return `fence-${id}`;
}

export function allFenceVariants(): FenceVariant[] {
  return [
    ...FENCE_VARIANTS.up_start,
    ...FENCE_VARIANTS.up,
    ...FENCE_VARIANTS.down,
    ...FENCE_VARIANTS.down_end,
  ];
}

/** Same variant cannot return until this many other segments have been placed. */
const REPEAT_GAP = 4;

function joinStep(v: FenceVariant): number {
  return Math.max(1, v.joinW - JOIN_OVERLAP_PX) * tuning.fenceTileScale;
}

function recentIds(
  run: readonly { variant: FenceVariant }[],
  extra?: FenceVariant,
): Set<string> {
  const ids = run.map((p) => p.variant.id);
  if (extra) ids.push(extra.id);
  return new Set(ids.slice(-REPEAT_GAP));
}

/**
 * One run along an edge:
 * [Up/Start] [down] [up] [down] [up] … [Down/End]
 *
 * Complete tiles only — never pad the middle. If the run is shorter than the
 * road, center it and leave empty ground on both ends.
 *
 * A given variant cannot be reused until `REPEAT_GAP` other segments have
 * been placed.
 */
export function generateFenceRun(
  roadLength: number,
  rng: () => number = Math.random,
): { kind: FenceTileKind; variant: FenceVariant; floorX: number }[] {
  const scale = tuning.fenceTileScale;
  const endReserve =
    Math.max(...FENCE_VARIANTS.down_end.map((v) => v.joinW)) * scale;
  const start = pick(FENCE_VARIANTS.up_start, rng);
  const run: { kind: FenceTileKind; variant: FenceVariant; floorX: number }[] = [
    { kind: 'up_start', variant: start, floorX: 0 },
  ];
  let x = joinStep(start);

  while (true) {
    const down = pick(FENCE_VARIANTS.down, rng, recentIds(run));
    const up = pick(FENCE_VARIANTS.up, rng, recentIds(run, down));
    const fitted = x + joinStep(down) + joinStep(up) + endReserve;
    if (fitted > roadLength) break;
    run.push({ kind: 'down', variant: down, floorX: x });
    x += joinStep(down);
    run.push({ kind: 'up', variant: up, floorX: x });
    x += joinStep(up);
  }

  const end = pick(FENCE_VARIANTS.down_end, rng, recentIds(run));
  run.push({ kind: 'down_end', variant: end, floorX: x });
  const visualRight = x + end.joinW * scale;
  const offset = (Math.max(0, roadLength) - visualRight) / 2;
  for (const piece of run) piece.floorX += offset;
  return run;
}

export function createFence(roadLength: number, seed = 0x51e4ce): FenceDef {
  const len = Math.max(0, roadLength);
  const rng = mulberry32((seed ^ Math.floor(len)) >>> 0);
  const segments: FenceSegmentDef[] = [];
  for (const edge of ['near', 'far'] as const) {
    const run = generateFenceRun(len, rng);
    const floorY = edge === 'near' ? tuning.fenceNearFloorY : tuning.fenceFarFloorY;
    for (const piece of run) {
      segments.push({ ...piece, floorY, edge });
    }
  }
  return { segments };
}

function pick(
  list: readonly FenceVariant[],
  rng: () => number,
  used?: ReadonlySet<string>,
): FenceVariant {
  const pool = used ? list.filter((v) => !used.has(v.id)) : list;
  const from = pool.length > 0 ? pool : list;
  return from[Math.floor(rng() * from.length) % from.length]!;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
