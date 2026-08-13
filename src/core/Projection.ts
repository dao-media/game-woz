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

  /**
   * Cosmetic entity size vs depth. `strength` 0 = flat size, 1 = full depthScale.
   * Sole permitted scale modifier for character sprites (no per-clip multipliers).
   */
  entityDepthScale(floorY: number, strength = 1): number {
    const d = Projection.depthScale(floorY);
    const s = clamp(strength, 0, 1);
    return 1 + (d - 1) * s;
  },

  /** Ground contact screen-Y (no jump). Airborne sprites use groundScreenY − z. */
  groundScreenY(floorY: number): number {
    return floorY * tuning.foreshorten;
  },

  toScreen(floorX: number, floorY: number, z = 0): ScreenPoint {
    const scale = Projection.depthScale(floorY);
    const vp = vanishingX;
    return {
      x: vp + (floorX - vp) * scale,
      y: Projection.groundScreenY(floorY) - z,
    };
  },

  fromFloor(point: FloorPoint): ScreenPoint {
    return Projection.toScreen(point.floorX, point.floorY, point.z ?? 0);
  },

  floorYToScreenY(floorY: number): number {
    return floorY * tuning.foreshorten;
  },

  /** Horizon line — far walkable edge in screen Y. */
  horizonY(): number {
    return Projection.floorYToScreenY(tuning.depthFar);
  },

  /** Map continuous depth01 (0 near → 1 far) onto the walkable floor-Y band. */
  depth01ToFloorY(depth01: number): number {
    const t = clamp(depth01, 0, 1);
    return tuning.depthNear + (tuning.depthFar - tuning.depthNear) * t;
  },

  floorYToDepth01(floorY: number): number {
    const span = tuning.depthNear - tuning.depthFar;
    if (span <= 0) return 0;
    return clamp((tuning.depthNear - floorY) / span, 0, 1);
  },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
