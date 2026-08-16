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
   * 1 at the near edge, `perspectiveFarScale` at the far road edge, then a
   * further falloff through the beyond-fence strip so rear décor lags and
   * shrinks instead of sitting on one clamped plane.
   */
  depthScale(floorY: number): number {
    const span = tuning.depthNear - tuning.depthFar;
    if (span <= 0) return 1;
    const t = (tuning.depthNear - floorY) / span;
    if (t <= 1) {
      return 1 + (tuning.perspectiveFarScale - 1) * clamp(t, 0, 1);
    }
    const scenery = Projection.farScenerySpan();
    const extra = scenery <= 0 ? 0 : clamp((tuning.depthFar - floorY) / scenery, 0, 1);
    return tuning.perspectiveFarScale * (1 - extra * tuning.sceneryDepthFalloff);
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

  /**
   * Rear hill behind the far fence. `along` 0 = crest (back), 1 = toe (at the fence).
   * Floor-Y stays near the fence so décor keeps readable size; z stacks rows up the slope.
   * Peak height undulates along X so the ridge reads as hills, not a flat ramp.
   */
  hillPeak(floorX: number): number {
    const a = 0.5 + 0.5 * Math.sin(floorX * 0.0068 + 0.2);
    const b = 0.5 + 0.5 * Math.sin(floorX * 0.0154 + 1.9);
    const c = 0.5 + 0.5 * Math.sin(floorX * 0.031 + 0.7);
    return 0.42 + 0.58 * (0.55 * a + 0.32 * b + 0.13 * c);
  },

  hillAlongToFloorY(along: number): number {
    const a = clamp(along, 0, 1);
    const toe = tuning.fenceFarFloorY - 8;
    const crest = toe - tuning.hillFloorDrop;
    return toe * a + crest * (1 - a);
  },

  hillAlongToZ(along: number, floorX = 0): number {
    const u = 1 - clamp(along, 0, 1);
    const rise = u * u * (3 - 2 * u);
    return rise * tuning.hillHeight * Projection.hillPeak(floorX);
  },

  hillAlongToScreenY(along: number, floorX = 0): number {
    return (
      Projection.groundScreenY(Projection.hillAlongToFloorY(along)) -
      Projection.hillAlongToZ(along, floorX)
    );
  },

  hillToScreen(floorX: number, along: number): ScreenPoint {
    return Projection.toScreen(
      floorX,
      Projection.hillAlongToFloorY(along),
      Projection.hillAlongToZ(along, floorX),
    );
  },

  fromFloor(point: FloorPoint): ScreenPoint {
    return Projection.toScreen(point.floorX, point.floorY, point.z ?? 0);
  },

  floorYToScreenY(floorY: number): number {
    return floorY * tuning.foreshorten;
  },

  /** Walkable Yellow Brick Road span in floor-Y. */
  roadFloorSpan(): number {
    return tuning.depthNear - tuning.depthFar;
  },

  /** Far scenery strip span — `farSceneryStripRatio` of the road height. */
  farScenerySpan(): number {
    return Projection.roadFloorSpan() * tuning.farSceneryStripRatio;
  },

  /** Far edge of the beyond-fence ground strip (backdrop / floor seam). */
  horizonFloorY(): number {
    return tuning.fenceFarFloorY - Projection.farScenerySpan();
  },

  /** Mid-strip floor-Y for décor planted just beyond the far fence. */
  farSceneryFloorY(): number {
    return (Projection.horizonFloorY() + tuning.fenceFarFloorY) / 2;
  },

  /** Horizon line — far edge of the scenery strip in screen Y. */
  horizonY(): number {
    return Projection.floorYToScreenY(Projection.horizonFloorY());
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
