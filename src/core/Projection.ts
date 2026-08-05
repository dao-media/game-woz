import { tuning } from '../config/tuning';

export type FloorPoint = {
  floorX: number;
  floorY: number;
  z?: number;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

/** Screen-X of the vanishing point (typically camera mid-X). */
let vanishingX = 0;

/**
 * Floor → screen with one-point perspective.
 *
 * - Y is foreshortened (three-quarter tilt).
 * - X converges toward a vanishing point on the horizon as floorY → far.
 * - Vanishing X tracks the camera look-at so a scrolling stage still reads correctly.
 */
export const Projection = {
  get vanishingX(): number {
    return vanishingX;
  },

  setVanishingX(x: number): void {
    vanishingX = x;
  },

  /**
   * Horizontal scale at a given floor depth.
   * 1 at near edge, `perspectiveFarScale` at far edge.
   */
  depthScale(floorY: number): number {
    const span = tuning.depthNear - tuning.depthFar;
    if (span <= 0) return 1;
    const t = clamp((tuning.depthNear - floorY) / span, 0, 1);
    return 1 + (tuning.perspectiveFarScale - 1) * t;
  },

  toScreen(floorX: number, floorY: number, z = 0): ScreenPoint {
    const scale = Projection.depthScale(floorY);
    const vp = vanishingX;
    return {
      x: vp + (floorX - vp) * scale,
      y: floorY * tuning.foreshorten - z,
    };
  },

  fromFloor(point: FloorPoint): ScreenPoint {
    return Projection.toScreen(point.floorX, point.floorY, point.z ?? 0);
  },

  /** Projected Y of a floor-Y depth (no hop). */
  floorYToScreenY(floorY: number): number {
    return floorY * tuning.foreshorten;
  },

  /** Horizon line — far walkable edge in screen Y. */
  horizonY(): number {
    return Projection.floorYToScreenY(tuning.depthFar);
  },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
