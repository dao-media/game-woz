import { tuning } from '../config/tuning';
import { Projection } from '../core/Projection';

/** Runtime copies — originals stay in photos/Environment/Plants and masters/plants. */
export const PLANT_GAME_DIR = 'models/plants/game';

export type PlantVariantId = 'grass_medium' | 'grass_large' | 'grass_flowers' | 'wheat';

export type PlantVariant = {
  id: PlantVariantId;
  file: string;
  w: number;
  h: number;
  kind: 'grass' | 'wheat';
};

/** Packed game-sprite sizes (after crop + downscale). */
export const PLANT_VARIANTS: Record<PlantVariantId, PlantVariant> = {
  grass_medium: { id: 'grass_medium', file: 'grass_medium.png', w: 360, h: 140, kind: 'grass' },
  grass_large: { id: 'grass_large', file: 'grass_large.png', w: 451, h: 120, kind: 'grass' },
  grass_flowers: { id: 'grass_flowers', file: 'grass_flowers.png', w: 262, h: 220, kind: 'grass' },
  wheat: { id: 'wheat', file: 'wheat.png', w: 294, h: 180, kind: 'wheat' },
};

export function plantTextureKey(id: PlantVariantId): string {
  return `plant-${id}`;
}

export type PlantTuftDef = {
  variant: PlantVariantId;
  floorX: number;
  floorY: number;
  /** Screen-up elevation on the rear hill (Projection z). */
  hillZ: number;
  baseScale: number;
  flipX: boolean;
  phase: number;
  /** Wheat depth layer, 0 = farthest (crest). */
  row: number;
};

export type PlantFieldDef = {
  grass: PlantTuftDef[];
  wheat: PlantTuftDef[];
};

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Grass on the crest; wheat down the slope toward the fence. Gap so they don't mix. */
const GRASS_ALONG: readonly [number, number] = [0.05, 0.28];
const WHEAT_ALONG: readonly [number, number] = [0.38, 0.95];

/** Checker-staggered mirrors so repeats don't read as one clone. */
function mirrorFlip(cell: number, row: number): boolean {
  const pat = [false, true, false, true, true, false] as const;
  const i = ((cell + row * 2) % pat.length + pat.length) % pat.length;
  return pat[i]!;
}

export function createPlantField(roadLength: number, seed = 0x9e3779b9): PlantFieldDef {
  const len = Math.max(0, roadLength);
  const rng = mulberry32((seed ^ Math.floor(len)) >>> 0);
  return {
    grass: scatterGrass(len, rng),
    wheat: scatterWheat(len, rng),
  };
}

function scatterGrass(len: number, rng: () => number): PlantTuftDef[] {
  const count = Math.max(0, Math.round((len / 1000) * tuning.plantGrassPer1000X));
  const tufts: PlantTuftDef[] = [];
  const [g0, g1] = GRASS_ALONG;
  for (let i = 0; i < count; i++) {
    const roll = rng();
    let variant: PlantVariantId = 'grass_medium';
    let baseScale: number = tuning.plantGrassBaseScale;
    if (roll < 0.12) {
      variant = 'grass_flowers';
      baseScale = tuning.plantGrassFlowersScale;
    } else if (roll < 0.3) {
      variant = 'grass_large';
      baseScale = tuning.plantGrassLargeScale;
    }
    const along = g0 + rng() * (g1 - g0);
    const floorX = 40 + rng() * Math.max(1, len - 80);
    tufts.push({
      variant,
      floorX,
      floorY: Projection.hillAlongToFloorY(along),
      hillZ: Projection.hillAlongToZ(along, floorX),
      baseScale: baseScale * (0.88 + rng() * 0.24),
      flipX: mirrorFlip(i, Math.floor(along * 5)),
      phase: rng() * Math.PI * 2,
      row: -1,
    });
  }
  return tufts;
}

function scatterWheat(len: number, rng: () => number): PlantTuftDef[] {
  const rows = Math.max(1, Math.round(tuning.plantWheatRows));
  const startX = tuning.plantWheatStartFloorX;
  if (len <= startX + 80) return [];

  const tufts: PlantTuftDef[] = [];
  const [w0, w1] = WHEAT_ALONG;
  const alongSpan = w1 - w0;
  for (let row = 0; row < rows; row++) {
    const t = rows === 1 ? 1 : row / (rows - 1);
    const spacing = lerp(tuning.plantWheatSpacingFar, tuning.plantWheatSpacingNear, t);
    const scale = lerp(tuning.plantWheatScaleFar, tuning.plantWheatScaleNear, t);
    const along = w0 + t * alongSpan;
    const alongJitter = alongSpan / (rows * 3);
    let x = startX + rng() * spacing * 0.5;
    let cell = 0;
    while (x < len - 40) {
      const a = clamp(along + (rng() - 0.5) * alongJitter, w0, w1);
      const floorX = x + (rng() - 0.5) * spacing * 0.7;
      tufts.push({
        variant: 'wheat',
        floorX,
        floorY: Projection.hillAlongToFloorY(a),
        hillZ: Projection.hillAlongToZ(a, floorX),
        baseScale: scale * (0.92 + rng() * 0.16),
        flipX: mirrorFlip(cell, row),
        phase: rng() * Math.PI * 2,
        row,
      });
      cell += 1;
      x += spacing;
    }
  }
  return tufts;
}

/** Shared breeze: two sines, traveling along floor-X. */
export function plantWind(tSec: number, floorX: number, phase: number): number {
  return (
    Math.sin(tSec * tuning.plantSwaySpeed + floorX * tuning.plantSwayTravel + phase) * 0.72 +
    Math.sin(tSec * tuning.plantGustSpeed + floorX * 0.01 + phase * 0.35) * 0.28
  );
}
