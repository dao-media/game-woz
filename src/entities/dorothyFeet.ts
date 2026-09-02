import Phaser from 'phaser';
import feetCacheJson from '../data/dorothyFeetCache.json';
import { tuning } from '../config/tuning';

export type FeetPoint = { nx: number; ny: number };

type FeetFrameEntry = FeetPoint & {
  profile?: boolean;
  merged?: boolean;
  feetFront?: FeetPoint;
  feetBack?: FeetPoint;
  /** Full-silhouette horizontal center of mass (for idle plant / body align). */
  bodyNx?: number;
};

type FeetCache = {
  version: number;
  feetRegionRatio: number;
  granularity: string;
  mergeDistNx?: number;
  frames: Record<string, Record<string, FeetFrameEntry>>;
};

export type MeasuredFeetFrame = {
  /** Center / single-foot contact. */
  single: FeetPoint;
  profile: boolean;
  merged: boolean;
  feetFront: FeetPoint | null;
  feetBack: FeetPoint | null;
  /** Body mass nx — idle origin uses this so she doesn't lean toward facing. */
  bodyNx: number;
};

const feetCache = feetCacheJson as FeetCache;

const FALLBACK: MeasuredFeetFrame = {
  single: { nx: 0.5, ny: tuning.feetAnchorRatio },
  profile: false,
  merged: true,
  feetFront: null,
  feetBack: null,
  bodyNx: 0.5,
};

function mirrorPoint(nx: number, flip: boolean): number {
  return flip ? 1 - nx : nx;
}

function normalizeEntry(
  entry: FeetFrameEntry,
  flip: boolean,
): MeasuredFeetFrame {
  const single: FeetPoint = {
    nx: mirrorPoint(entry.nx, flip),
    ny: entry.ny,
  };
  const bodyNx = mirrorPoint(entry.bodyNx ?? entry.nx, flip);

  if (!entry.profile) {
    return {
      single,
      profile: false,
      merged: true,
      feetFront: null,
      feetBack: null,
      bodyNx,
    };
  }

  const merged = entry.merged ?? true;
  let feetFront: FeetPoint | null = null;
  let feetBack: FeetPoint | null = null;

  if (!merged && entry.feetFront && entry.feetBack) {
    feetFront = {
      nx: mirrorPoint(entry.feetFront.nx, flip),
      ny: entry.feetFront.ny,
    };
    feetBack = {
      nx: mirrorPoint(entry.feetBack.nx, flip),
      ny: entry.feetBack.ny,
    };
  }

  return { single, profile: true, merged, feetFront, feetBack, bodyNx };
}

/** Cached per-frame sole data — single point plus optional profile split. */
export function getMeasuredFeetFrame(
  sprite: Phaser.GameObjects.Sprite,
): MeasuredFeetFrame {
  const atlasKey = sprite.texture.key;
  const frameName = sprite.frame.name;
  const entry = feetCache.frames[atlasKey]?.[frameName];
  if (!entry) return FALLBACK;
  return normalizeEntry(entry, sprite.scaleX < 0);
}

/** @deprecated Prefer getMeasuredFeetFrame — returns center/single point. */
export function getMeasuredFeetNormalized(sprite: Phaser.GameObjects.Sprite): FeetPoint {
  return getMeasuredFeetFrame(sprite).single;
}

export function feetPointToScreen(
  sprite: Phaser.GameObjects.Sprite,
  point: FeetPoint,
): { x: number; y: number } {
  return {
    x: sprite.x + (point.nx - sprite.originX) * sprite.displayWidth,
    y: sprite.y + (point.ny - sprite.originY) * sprite.displayHeight,
  };
}

/** World-space sole contact from measured cache + current sprite transform. */
export function getMeasuredFeetScreen(
  sprite: Phaser.GameObjects.Sprite,
): { x: number; y: number } {
  return feetPointToScreen(sprite, getMeasuredFeetFrame(sprite).single);
}

/** Profile debug / FX — front, back, and merged center in screen space. */
export function getMeasuredFeetScreenMarkers(
  sprite: Phaser.GameObjects.Sprite,
): {
  center: { x: number; y: number };
  front: { x: number; y: number } | null;
  back: { x: number; y: number } | null;
} {
  const frame = getMeasuredFeetFrame(sprite);
  return {
    center: feetPointToScreen(sprite, frame.single),
    front: frame.feetFront ? feetPointToScreen(sprite, frame.feetFront) : null,
    back: frame.feetBack ? feetPointToScreen(sprite, frame.feetBack) : null,
  };
}

export function getFeetCacheRegionRatio(): number {
  return feetCache.feetRegionRatio;
}
