/** All gameplay-feel constants. No magic numbers in logic. */
export const tuning = {
  gameWidth: 960,
  gameHeight: 540,

  /** Vertical compression of floor depth → three-quarter tilt. */
  foreshorten: 0.55,
  /**
   * One-point perspective: horizontal scale at the far edge relative to near (1 = no pinch).
   * Far floor is narrower toward the vanishing point — cross-lines shorten toward far.
   */
  perspectiveFarScale: 0.58,

  /** Walkable depth band in floor-Y (far = smaller / toward horizon, near = larger). */
  depthFar: 120,
  depthNear: 420,
  /** Extra floor-Y padding beyond depth band for drawing. */
  worldFloorPad: 40,

  /** Flat vertical backdrop height above the far floor edge (screen px). */
  backdropHeight: 220,
  /**
   * Backdrop scroll factor as a fraction of the far-floor track factor.
   * Lower = wall lags more (stronger parallax behind the road).
   */
  backdropParallaxScale: 0.55,

  floorGridStepX: 80,
  floorGridStepY: 40,

  /** Ground speed along the road (floor-X units / second). */
  moveSpeedX: 180,
  /** Depth travel speed (floor-Y units / second). */
  moveSpeedY: 140,
  runSpeedMul: 1.65,

  jumpVelocityZ: 220,
  gravityZ: 720,

  /**
   * Munchkinland gate — planted on one perspective ray (constant floorX).
   * Opening spans mid floor-Y of the road band.
   */
  gateFloorX: 160,
  gateOpeningFloorY: 270,
  gateOpeningHalfWidth: 45,
  gateSpawnFloorX: 110,
  gateWalkHandoffFloorX: 220,

  introCameraMoveMs: 1400,
  introCameraMoveEase: 'Cubic.easeInOut',
  forkSplitFloorX: 900,
  munchkinRoadLength: 1400,
  continuationRoadLength: 2400,
  finishMargin: 64,

  shadowScaleGround: 1,
  shadowScaleAir: 0.55,
  shadowMaxZ: 80,

  playerBodyWidth: 36,
  playerBodyHeight: 56,

  colors: {
    background: 0x1a1a1e,
    backdropTop: 0x2c3344,
    backdropBottom: 0x1e2430,
    backdropLine: 0x3a4558,
    floorFar: 0xa88840,
    floorNear: 0xd4b86a,
    floorLine: 0x8a7030,
    horizon: 0xe8d5a3,
    road: 0xc4a35a,
    munchkin: 0x7a5a8a,
    divider: 0x5a6a7a,
    forkMarker: 0xe8d5a3,
    player: 0xc4a35a,
    shadow: 0x1a1a1e,
    grass: 0x3a4a32,
    trackFar: 0x6a8aaa,
    trackMidFar: 0x7a9a7a,
    trackMid: 0x8a9a6a,
    trackNear: 0xaa8a6a,
  },
} as const;

export type Tuning = typeof tuning;
