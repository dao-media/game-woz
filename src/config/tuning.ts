/** All gameplay-feel constants. No magic numbers in logic. */
export const tuning = {
  gameWidth: 960,
  gameHeight: 540,

  /** Vertical compression of floor depth → three-quarter tilt. */
  foreshorten: 0.55,
  /**
   * One-point perspective: horizontal scale at the far edge relative to near (1 = no pinch).
   * Far floor is narrower toward the vanishing point.
   */
  perspectiveFarScale: 0.58,

  /** Floor-plane walk speed (pixels / second in floor space). */
  moveSpeed: 180,
  /** Floor-plane fast-run speed while run action (Shift) is held. */
  runSpeed: 320,

  hopHeight: 48,
  /** Upward z-velocity impulse on hop start. */
  hopImpulse: 280,
  /** Gravity pulling z back to 0 (units / s²). */
  zGravity: 900,

  /** Walkable depth band in floor-Y (far = smaller, near = larger). */
  depthFar: 120,
  depthNear: 420,

  worldWidth: 2400,
  /** Extra floor-Y padding beyond depth band for world bounds. */
  worldFloorPad: 40,

  /** Flat vertical backdrop height above the far floor edge (screen px). */
  backdropHeight: 220,
  /**
   * Backdrop scroll factor as a fraction of the far-floor track factor.
   * Lower = wall lags more (stronger parallax behind the road).
   */
  backdropParallaxScale: 0.55,

  feetWidth: 28,
  feetHeight: 14,

  playerBodyWidth: 36,
  playerBodyHeight: 56,

  obstacleWidth: 48,
  obstacleHeight: 64,

  floorGridStepX: 80,
  floorGridStepY: 40,

  colors: {
    background: 0x1a1a1e,
    backdropTop: 0x2c3344,
    backdropBottom: 0x1e2430,
    backdropLine: 0x3a4558,
    floorFar: 0x2a2a32,
    floorNear: 0x3d3d48,
    floorLine: 0x5a5a68,
    horizon: 0xc4a35a,
    player: 0xc4a35a,
    playerFeet: 0x8a7040,
    obstacle: 0x6b7c8a,
    obstacleNear: 0x8a9aaa,
  },
} as const;

export type Tuning = typeof tuning;
