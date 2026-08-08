/** All gameplay-feel constants. No magic numbers in logic. */
export const tuning = {
  gameWidth: 960,
  gameHeight: 540,

  foreshorten: 0.55,
  perspectiveFarScale: 0.58,

  depthFar: 120,
  depthNear: 420,
  worldFloorPad: 40,

  backdropHeight: 220,
  backdropParallaxScale: 0.55,

  floorGridStepX: 80,
  floorGridStepY: 40,

  moveSpeedX: 180,
  moveSpeedY: 140,
  runSpeedMul: 1.65,

  jumpVelocityZ: 220,
  gravityZ: 720,

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

  // —— Combat ——
  playerMaxHP: 100,

  /** Silver Slippers: fraction of incoming damage blocked (0.2 = 20% reduction). */
  slipperDamageReduction: 0.2,
  /** Silver Slippers: HP restored per second. */
  slipperRegenPerSec: 2.5,

  /** Placeholder basic kick (Tin-Man / Lion / Scarecrow). */
  placeholderKickDamage: 8,
  placeholderKickRange: 70,
  placeholderKickHalfAngleDeg: 50,
  placeholderKickDurationMs: 220,
  placeholderKickActiveStartMs: 40,
  placeholderKickActiveEndMs: 160,

  /** Dorothy light combo — kick 1 / 2 / 3. */
  kick1Damage: 10,
  kick1Range: 72,
  kick1HalfAngleDeg: 55,
  kick1DurationMs: 200,
  kick1ActiveStartMs: 35,
  kick1ActiveEndMs: 140,

  kick2Damage: 14,
  kick2Range: 78,
  kick2HalfAngleDeg: 58,
  kick2DurationMs: 220,
  kick2ActiveStartMs: 35,
  kick2ActiveEndMs: 150,

  kick3Damage: 22,
  kick3Range: 88,
  kick3HalfAngleDeg: 65,
  kick3DurationMs: 280,
  kick3ActiveStartMs: 40,
  kick3ActiveEndMs: 180,
  kick3Knockback: 95,

  comboWindowMs: 420,
  /** Buffer next light input this many ms before kick ends. */
  comboBufferLeadMs: 90,

  /** Dorothy heavy — heel-click red energy bolt. */
  heavyDamage: 18,
  heavyFloorRange: 220,
  heavyMaxTargets: 3,
  heavyFloorYTolerance: 48,
  heavyCooldownMs: 900,
  heavyProjectileSpeed: 420,
  heavyHitRadius: 28,
  heavyKnockback: 40,
  heavyAttackDurationMs: 180,
  heavyBoltWidth: 18,
  heavyBoltHeight: 8,

  /** Dorothy ultimate — triple heel-click pulse. */
  ultimateDamage: 28,
  ultimateAcquireRange: 260,
  ultimateMaxTargets: 3,
  ultimatePulseRadius: 70,
  ultimateWindupMs: 520,
  ultimateCooldownMs: 8000,
  ultimatePulseDurationMs: 380,
  ultimateKnockback: 55,

  // —— Difficulty (behavioral dials; HP/damage mults stay minor) ——
  difficultyPresets: {
    easy: {
      reactionDelayMs: 520,
      punishAccuracy: 0.25,
      telegraphMult: 1.45,
      perceptionRange: 280,
      retreatBias: 1.25,
      maxSimultaneousAttackers: 1,
      commitCadenceMs: 1400,
      hpMult: 0.85,
      damageMult: 0.85,
    },
    normal: {
      reactionDelayMs: 320,
      punishAccuracy: 0.55,
      telegraphMult: 1.0,
      perceptionRange: 360,
      retreatBias: 1.0,
      maxSimultaneousAttackers: 2,
      commitCadenceMs: 900,
      hpMult: 1.0,
      damageMult: 1.0,
    },
    hard: {
      reactionDelayMs: 160,
      punishAccuracy: 0.9,
      telegraphMult: 0.7,
      perceptionRange: 460,
      retreatBias: 0.75,
      maxSimultaneousAttackers: 3,
      commitCadenceMs: 550,
      hpMult: 1.15,
      damageMult: 1.15,
    },
  },

  // —— Enemy types ——
  monkeyMaxHP: 28,
  monkeyContactDamage: 7,
  monkeyMoveSpeed: 110,
  monkeyStandoffDist: 140,
  monkeyDiveSpeed: 260,
  monkeyHoverZ: 55,
  monkeyDiveZ: 8,
  monkeyBodyWidth: 30,
  monkeyBodyHeight: 36,
  monkeyColor: 0x8a5a9a,

  wheelerMaxHP: 36,
  wheelerContactDamage: 10,
  wheelerMoveSpeed: 200,
  wheelerChargeSpeed: 340,
  wheelerLungeRange: 42,
  wheelerBodyWidth: 34,
  wheelerBodyHeight: 34,
  wheelerColor: 0x6a7a8a,

  enemyContactCooldownMs: 650,
  enemyContactRadius: 30,
  enemyAllySpacing: 55,
  enemyRecoverMs: 420,
  enemyAttackTelegraphMs: 280,
  enemyRecentDamageWindowMs: 700,

  // —— Encounters ——
  arenaLockPadWest: 80,
  arenaLockPadEast: 220,
  encounterLockBannerY: 56,

  dummyMaxHP: 40,
  dummyContactDamage: 8,
  dummyContactCooldownMs: 700,
  dummyContactRadius: 28,
  dummyBodyWidth: 32,
  dummyBodyHeight: 48,

  knockbackStrength: 70,
  hitFlashMs: 100,
  hitStopMs: 50,
  damageNumberRisePx: 36,
  damageNumberDurationMs: 500,

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
    enemy: 0xb05050,
    enemyFlash: 0xffffff,
    redEnergy: 0xe03040,
    redEnergySoft: 0xff6a6a,
    hpBarBg: 0x2a2a32,
    hpBarFill: 0xc4a35a,
    hpBarLow: 0xb05050,
    cooldownReady: 0xc4a35a,
    cooldownBusy: 0x5a5a68,
    ultimateCharge: 0xe03040,
    damageNumber: 0xffe8a0,
  },
} as const;

export type Tuning = typeof tuning;
