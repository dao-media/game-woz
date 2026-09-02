/** All gameplay-feel constants. No magic numbers in logic. */
export const tuning = {
  gameWidth: 960,
  gameHeight: 540,

  foreshorten: 0.55,
  perspectiveFarScale: 0.58,
  /**
   * Extra shrink/lag past the far road edge (0 = clamp, 1 = vanish at horizon).
   * Mild — rear décor size mostly comes from the hill, not this.
   */
  sceneryDepthFalloff: 0.22,

  depthFar: 120,
  depthNear: 420,
  worldFloorPad: 40,
  /** Ground beyond the far fence, as a fraction of the walkable road's floor-Y span. */
  farSceneryStripRatio: 0.3,
  /**
   * Rear hill: crest elevation in screen-px (subtracted from screen Y).
   * Tall enough that peaks silhouette against the sky, not a flat strip.
   */
  hillHeight: 64,
  /** How much farther (floor-Y) the crest sits vs the toe — mild parallax only. */
  hillFloorDrop: 16,

  /**
   * Fence near row — just outside the walkable near bound (depthNear), in the
   * floor pad so posts plant on the ground and always draw in front of fighters.
   */
  fenceNearFloorY: 432,
  /**
   * Fence far row — just beyond the far walkable bound (depthFar), on the
   * inner edge of the far scenery strip. Characters on the road always sort
   * in front.
   */
  fenceFarFloorY: 118,
  postSpacingFloorX: 64,
  postBaseScale: 0.8,
  postGreyboxWidth: 11,
  postGreyboxHeight: 64,
  /**
   * Authored fence tiles (~230px tall). Floor span = sourceWidth × fenceTileScale.
   * 0.224 is 20% smaller than the first authored fit (0.28).
   */
  fenceTileScale: 0.224,
  /** Two rails per edge, as a fraction of post height (0 = ground). */
  railHeightLo: 0.3,
  railHeightHi: 0.66,
  railThickness: 8,

  /** Far-grass strip as a fraction of the YBR block (top of the image). */
  ybrGrassBandFar: 0.085,
  /** Near-grass strip as a fraction of the YBR block (bottom of the image). */
  ybrGrassBandNear: 0.103,
  /** Grass-tip sway in floor-X. Bricks stay still. */
  ybrGrassSway: 4.5,
  ybrGrassSwaySpeed: 1.15,
  ybrGrassGustSpeed: 0.42,
  ybrGrassSwayTravel: 0.028,

  /** Sparse grass tufts per 1000 floor-X (crest of the rear hill). */
  plantGrassPer1000X: 4.5,
  plantGrassBaseScale: 0.21,
  plantGrassLargeScale: 0.16,
  plantGrassFlowersScale: 0.17,
  /** Grass lean (radians) from the feet. Wheat uses the same sprite lean (no mesh slices). */
  plantGrassLean: 0.028,
  /** Whole-tuft breeze (radians). Mesh tip-bends shard the texture. */
  plantWheatLean: 0.07,

  /** Wheat field starts after the gate so the intro isn't a grain wall. */
  plantWheatStartFloorX: 220,
  plantWheatRows: 5,
  plantWheatSpacingFar: 100,
  plantWheatSpacingNear: 68,
  plantWheatScaleFar: 0.37,
  plantWheatScaleNear: 0.43,
  plantSwaySpeed: 0.85,
  plantGustSpeed: 0.38,
  plantSwayTravel: 0.024,

  backdropHeight: 220,
  backdropParallaxScale: 0.55,

  /** Layered atmosphere — parallax sky, horizon haze, ground mist, dust motes. */
  atmSkyFarScroll: 0.1,
  atmSkyMidScroll: 0.22,
  atmGroundMistScroll: 0.38,
  atmSparkNearScroll: 0.88,
  atmSkyBandAlpha: 0.85,
  atmSkyCloudAlpha: 0.14,
  atmSkyCloudSpacing: 280,
  atmHorizonHazeHeight: 52,
  atmHorizonHazeAlpha: 0.28,
  atmGroundMistAlpha: 0.1,
  atmDepthWashAlpha: 0.16,
  atmVignetteStrength: 0.55,
  atmMistPulseSpeed: 0.0014,
  /**
   * Dust density (≈ particles emitted per second per layer).
   * Higher = denser volume; keep far densest / softest, near sparsest / brightest.
   */
  atmDustFarQty: 4.5,
  atmDustMidQty: 3.2,
  atmSparkNearQty: 2.4,
  /** Horizontal drift (px/s). Mild + wide range avoids “laser stream” lanes. */
  atmDustFarSpeedX: { min: -10, max: 6 },
  atmDustMidSpeedX: { min: -16, max: 10 },
  atmSparkNearSpeedX: { min: -22, max: 14 },
  /** Vertical float (px/s). Negative = rise. Needed so motes don’t read as flat streams. */
  atmDustFarSpeedY: { min: -8, max: 4 },
  atmDustMidSpeedY: { min: -14, max: 6 },
  atmSparkNearSpeedY: { min: -20, max: 8 },
  /** Soft gravity welling particles upward over life (px/s²). */
  atmDustGravityY: -4,
  atmSparkGravityY: -8,
  /** Pre-warm emitters so the first frame isn’t empty. */
  atmDustAdvanceMs: 3500,

  floorGridStepX: 80,
  floorGridStepY: 40,

  // Walk: midpoint of pre-cut (180/140) and 20%-cut (144/112) → 90% of original.
  moveSpeedX: 162, // (180 + 144) / 2
  moveSpeedY: 126, // (140 + 112) / 2
  // Keep run absolute speed at the post-cut level (144×1.65 / 162).
  runSpeedMul: 1.4666666667, // 1.65 × (0.8 / 0.9)

  // Peak height ∝ v²/(2g). 170 ≈ 220 × √0.6 → 40% lower apex (anims untouched).
  jumpVelocityZ: 170,
  gravityZ: 720,

  gateFloorX: 160,
  gateOpeningFloorY: 270,
  gateOpeningHalfWidth: 45,
  gateSpawnFloorX: 110,
  gateWalkHandoffFloorX: 220,

  introCameraMoveMs: 1400,
  introCameraMoveEase: 'Cubic.easeInOut',
  forkSplitFloorX: 900,
  /** Munchkinland length, in YBR blocks. */
  munchkinYbrSegments: 48,
  /** Continuation (Game) length, in YBR blocks. */
  continuationYbrSegments: 64,
  finishMargin: 64,

  shadowScaleGround: 1,
  shadowScaleAir: 0.55,
  shadowMaxZ: 80,

  playerBodyWidth: 36,
  playerBodyHeight: 56,
  /** On-screen Dorothy sprite height (px) — shared across walk/run/idle packs. */
  playerSpriteHeight: 114, // 95 × 1.2
  /**
   * Extra screen-Y (toward camera / down the screen) for the Dorothy sprite so
   * soles plant on the shadow instead of reading behind it. Scaled by entity
   * depth scale; shadow stays on the floor contact point.
   */
  playerSpriteTowardCameraPx: 6,
  /**
   * How strongly character sprites shrink/grow with floor depth (0 = flat, 1 = full
   * perspectiveFarScale). Sole permitted scale modifier besides baseScale.
   */
  playerDepthScaleStrength: 1,

  /** Dev harness: plant Blender test sprites on the floor (see SpriteCompositeTest). */
  devSpriteTest: false,
  devSpriteTestCubeFloorXOffset: 80,

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
  /** Matches Light1 playback: 69 frames @ 42 fps × ~2.054 timeScale → 800 ms. */
  kick1DurationMs: 800,
  /** Active window ≈ mid-kick (scaled to 800 ms clip). */
  kick1ActiveStartMs: 326,
  kick1ActiveEndMs: 555,

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

  /** Legacy combo timeout — unused by rhythm combo; kept for reference. */
  comboWindowMs: 420,

  /** Rhythm combo: ms after kick 1 ends before marker-2 window opens / closes. */
  comboWindow2OpenMs: 120,
  comboWindow2CloseMs: 380,
  /** Rhythm combo: ms after kick 2 ends before marker-3 window opens / closes. */
  comboWindow3OpenMs: 100,
  comboWindow3CloseMs: 360,

  /** Combo marker meter — screen offset from player feet (negative = up). */
  comboMeterOffsetY: -52,
  comboMeterMarkerSize: 10,
  comboMeterMarkerGap: 6,

  /** Fixed screen px from sprite top to overhead bars (negative = above head). Not depth-scaled. */
  overheadBarOffsetY: -9,
  overheadBarWidth: 44,
  overheadBarHeight: 5,
  overheadBarGap: 3,

  /** Ultimate meter sparkles when charge is full — sparse waves on a shared rectangular path. */
  ultMeterSparkleScaleStart: 0.495,
  ultMeterSparkleScaleEnd: 0,
  ultMeterSparkleLifespanMin: 480,
  ultMeterSparkleLifespanMax: 820,
  /** Ms for one full lap around the ult bar perimeter. */
  ultMeterSparkleOrbitPeriodMs: 2200,
  /** Px outside bar edge for the shared sparkle path. */
  ultMeterSparklePathPad: 1,
  /** Ms between sparkle waves (± jitter applied in code). */
  ultMeterSparkleWaveIntervalMs: 520,
  ultMeterSparkleBurstMin: 3,
  ultMeterSparkleBurstMax: 6,
  ultMeterSparkleAlphaStart: 0.75,

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

  /** Passive ultimate fill — full meter over this many seconds (always on). */
  ultimateBaseChargeSeconds: 30,
  /** Landed kick charge (sum ≈ 0.333 → three full combos fill the meter). */
  ultimateChargeKick1: 0.08,
  ultimateChargeKick2: 0.1,
  ultimateChargeKick3: 0.153,
  /** Landed shoe-laser hit (~1/35 of the meter). */
  ultimateChargePerLaserHit: 1 / 35,

  /** P sets ultimate charge to 100% and replays charge-full VFX (no F3 required). */
  debugForceUltimate: true,

  /**
   * Fraction down the sprite frame where soles sit (407/460 in NEW 460² exports).
   * Fallback when a frame is missing from the measured feet cache.
   */
  feetAnchorRatio: 407 / 460,
  /** Bottom fraction of frame scanned for foot alpha (build + runtime sparkle). */
  feetRegionRatio: 0.18,
  /** Feet cache granularity — per-frame for walk/run/jump; idle per-frame in cache. */
  feetMeasureGranularity: 'per-frame' as const,

  /** Slipper aura — ground-flush radial ray burst at feet when ultimate is full. */
  /** Shelved — ray shader renders as white box; sparkle-only for now. */
  slipperRayBurstEnabled: false,
  /** Ground ellipse width ≈ ratio × sprite display height (depth already in displayHeight). */
  slipperGlowWidthRatio: 0.8,
  /** Ground ellipse height ≈ ratio × sprite display height × groundFlatten. */
  slipperGlowHeightRatio: 0.3,
  slipperGlowMinPx: 28,
  slipperGlowMaxPx: 120,
  /** Floor foreshorten for the ground ellipse (perspective flatten). */
  slipperGlowGroundFlatten: 0.55,
  /** Frame fraction from top to knee — caps glow height (no pillar above knee). */
  slipperGlowKneeRatio: 0.58,
  slipperGlowRayCount: 14,
  slipperGlowIntensity: 0.62,
  slipperGlowRotationSpeed: 0.42,
  /**
   * Deep/dark crimson for slipper duplicate glow (+ shelved ray burst).
   * Darker than bright red so NORMAL/SCREEN stays crimson, not pink on light pixels.
   */
  slipperGlowColor: 0x8a0f1e,
  /**
   * Phaser blend on the glowing duplicate: 0 NORMAL · 3 SCREEN.
   * Do NOT use ADD (1) — ADD over shoe/skin blows out to pink.
   */
  slipperGlowBlendMode: 0,
  /** UV-space inner hole (transparent core at feet) — shelved ray burst. */
  slipperGlowInnerRadius: 0.06,
  slipperGlowOuterRadius: 0.92,
  slipperGlowPulseMin: 0.72,
  slipperGlowPulseMax: 1,
  slipperGlowPulseHz: 0.0045,

  /**
   * Active ultimate-ready path: duplicate Dorothy sprite + Phaser postFX glow
   * behind her (follows animation automatically — no foot tracking).
   */
  slipperGlowDuplicateEnabled: true,
  /** Outer glow strength (Phaser Glow FX). Soft diffuse halo, not a hard rim. */
  slipperGlowOuterStrength: 3.2,
  /**
   * Subtle brightness waves on the crimson glow (fraction of outerStrength).
   * Dual-sine so peaks feel like soft pulses, not a metronome.
   */
  slipperGlowWaveAmp: 0.2,
  /** Primary wave rate (Hz). */
  slipperGlowWaveHz: 0.85,
  /** Secondary wave mix (0–1) at ~1.7× primary Hz for organic pulsing. */
  slipperGlowWaveSecondary: 0.35,
  /** Keep 0 — knockout + real sprite on top supplies the silhouette fill. */
  slipperGlowInnerStrength: 0,
  /** Phaser Glow quality (0.05–1). Lower = cheaper / softer. */
  slipperGlowQuality: 0.12,
  /** Glow blur distance in px — higher = more diffuse. */
  slipperGlowDistance: 14,
  /**
   * Vertical crop of the duplicate: fraction of frame height from the bottom
   * that remains visible (hard max). Prefer `slipperGlowTopCutoff` for ankle height.
   */
  slipperGlowFootFalloff: 0.18,
  /**
   * Normalized height up from measured feet (frame fraction) where glow ≈ 0.
   * Lower = tighter on slippers/ankles (not riding up the shin/leg).
   */
  slipperGlowTopCutoff: 0.12,
  /** Depth units to place the glowing duplicate behind the real player sprite. */
  slipperGlowDepthBehind: 0.02,
  /** DepthSort tie-break for the glow duplicate (below player). */
  slipperGlowDepthTieBreak: 0,
  /**
   * Floor light under glowing slippers — replaces the dark shadow with a
   * soft crimson disc (shoes casting light).
   */
  slipperLightDiscWidth: 52,
  slipperLightDiscHeight: 18,
  /** Peak alpha of the floor light (multiplied by glow fade + wave). */
  slipperLightDiscAlpha: 0.62,
  /** Phaser blend: 0 NORMAL · 1 ADD · 3 SCREEN. SCREEN keeps crimson on YBR. */
  slipperLightDiscBlend: 3,
  /** Tint on the soft disc texture (deep crimson). */
  slipperLightDiscColor: 0x9a1224,
  /**
   * Fade-in ms for glow + sparkle when charge hits full.
   * 0 = match `groundBurstDurationMs()` so they arrive with the power-up burst.
   */
  slipperGlowFadeInMs: 0,
  /**
   * Re-enable the old SlipperSparkleExteriorRimV3 foot-band shader.
   * Off by default — duplicate glow replaces it.
   */
  slipperSparkleLegacyRim: false,

  /**
   * Subtle crimson glints swirling around the slippers (accents the glow).
   */
  slipperSparkleCount: 6,
  /** Soft-dot scale (texture is 32px) — keep tiny. */
  slipperSparkleSize: 0.09,
  /** Peak glint alpha (before fade-in multiply). */
  slipperSparkleOpacity: 0.67,
  /**
   * Crimson shades for orbiting glints (dark → bright).
   * First entry used as fallback single tint.
   */
  slipperSparkleTint: 0xb01428,
  slipperSparkleTints: [0x6e0a14, 0x8a0f1e, 0xb01428, 0xd42038, 0xe84a55],
  /** Ground-plane orbit ellipse half-width (px) around measured feet. */
  slipperSparkleOrbitRadiusX: 9,
  /** Ground-plane orbit ellipse half-height (px) — keep flat so glints stay at shoes. */
  slipperSparkleOrbitRadiusY: 2,
  /**
   * Extra screen-Y bias on the orbit center (positive = down). Keeps the top
   * of the swirl from climbing her legs.
   */
  slipperSparkleOrbitBiasY: 2,
  /** Cap how far above the feet a glint may travel (px, screen up). */
  slipperSparkleOrbitMaxUpPx: 4,
  /** Orbit angular speed (radians / second). */
  slipperSparkleOrbitSpeed: 2.15,
  /** Per-glint twinkle frequency (Hz). */
  slipperSparkleTwinkleHz: 2.6,
  /** Depth offset when a glint passes in front of / behind the sprite. */
  slipperSparkleOrbitDepth: 0.04,
  /** Phaser blend for glints: 1 ADD · 3 SCREEN. */
  slipperSparkleParticleBlend: 1,
  /** @deprecated Orbit path replaced lifespan emit rate. */
  slipperSparkleRateMs: 120,
  /** @deprecated */
  slipperSparkleLifespanMs: 380,
  /** @deprecated — use orbit radii. */
  slipperSparkleSpreadPx: 12,

  /** Jump: z at which ray burst fully becomes a circle (px). */
  jumpCircleZThreshold: 48,
  /** Exponent for semicircle→circle blend (<1 = ease-in, >1 = ease-out). */
  jumpCircleBlendPower: 1.35,

  /**
   * @deprecated Use `slipperGlowFadeInMs` (0 = burst duration). Kept as legacy fallback.
   */
  slipperSparkleFadeInMs: 400,
  /**
   * @deprecated Color comes from `colors.slipperCrimson` — kept for reference only.
   */
  slipperSparkleColor: 0xe01830,
  /**
   * Soft exterior rim only (transparent halo). Keep modest — ADD stacks.
   */
  slipperSparkleIntensity: 0.48,
  /** Gentle shimmer along the edge (low = slow breathe). */
  slipperSparkleTwinkleSpeed: 1.6,
  /** Wider = softer diffusion off the alpha edge. */
  slipperSparkleEdgeSoftness: 0.48,
  /** @deprecated Glitter density — outline mode has no discrete point hash. */
  slipperSparkleDensity: 1,
  /** Edge sample width in source texels (small = tight shoe rim). */
  slipperSparkleGlowWidth: 2.8,
  /**
   * Vertical sample band above the measured sole (ny) — slippers only.
   * Keep tight so ankles/dress stay out of the rim.
   */
  slipperSparkleSampleRatio: 0.05,
  /** Extra frame fraction sampled below the measured sole. */
  slipperSparkleFeetPad: 0.03,
  /** Quad reach — how far the exterior halo can fall off. */
  slipperSparkleRadius: 1.7,
  slipperSparkleWidthRatio: 0.5,
  slipperSparkleMinPx: 18,
  slipperSparkleMaxPx: 56,
  /**
   * Phaser blend: 0 NORMAL · 1 ADD · 3 SCREEN.
   * ADD for soft crimson exterior rim (no opaque tint — shader gates that).
   */
  slipperSparkleBlendMode: 1,
  /** DepthSort tie-break — above player sprite (1) so glow sits on slippers. */
  slipperSparkleDepthTieBreak: 2,

  /** Profile (E/W) — two per-foot glows that scissor; merge when feet overlap. */
  profileFootGlowScale: 0.65,
  profileFootGlowIntensityMult: 0.82,
  rearFootScaleMult: 0.78,
  rearFootIntensityMult: 0.62,
  /** Single merged glow boost when profile feet close (1.10–1.15×). */
  mergeScaleBoost: 1.12,
  mergeIntensityBoost: 1.2,
  /** Smooth split↔merge transition (ms). */
  splitMergeBlendMs: 120,
  /** Offline merge threshold — mirrored in measure_dorothy_feet.py. */
  profileFeetMergeDistNx: 0.075,

  /** Ultimate-ready one-shot red ground burst (10-frame sheet at feet). */
  groundBurstOneShot: true,
  /** Source sheet frame size (10 × 256×144 RGBA strip in public/fx/ground-burst/). */
  groundBurstFrameWidth: 256,
  groundBurstFrameHeight: 144,
  groundBurstFrameCount: 10,
  /** Frame 0 is fully empty in the sheet — start the anim on the first opaque frame. */
  groundBurstAnimStartFrame: 1,
  /** 25 fps = 40 ms/frame → ~360 ms from frame 1–9 at 1×. */
  groundBurstFrameRate: 25,
  /** Playback speed (1.2 = 20% faster). */
  groundBurstTimeScale: 1.2,
  /**
   * Measured (scripts/measure_ground_burst.py → groundBurstCache.json): lowest
   * opaque row / frameHeight across played frames. Sprite origin uses this so
   * the visible burst base sits on feet — not the empty frame bottom.
   */
  groundBurstAlphaBottomRatio: 0.80208,
  /**
   * Screen height (px at entityScale 1). Spike art is sparse — 38px was invisible
   * on the YBR; needs ~2.5× to read at gameplay scale.
   */
  groundBurstDisplayHeight: 96,
  /** Extra multiplier on top of display-height fit (0.42 ≈ 58% of original). */
  groundBurstScale: 0.42,
  /**
   * Phaser blend mode for both sandwich layers.
   * 0 NORMAL · 1 ADD · 2 MULTIPLY · 3 SCREEN · 4 OVERLAY
   */
  groundBurstBlendMode: 4,
  /** Screen-Y nudge from measured feet (positive = down the screen). */
  groundBurstAnchorOffsetY: 1,
  /** DepthSort tie-break — behind sparkle on same floor plane. */
  groundBurstDepthTieBreak: 0.48,
  /** Subtracted from player sprite depth so slippers draw on top of the back burst. */
  groundBurstDepthBehind: 0.03,
  /**
   * Front sandwich layer — dimmed burst in front of Dorothy, clipped to her
   * sprite alpha (BitmapMask). Back layer stays full-opacity behind her.
   */
  burstFrontOpacity: 0.4,
  /** Added to player sprite depth so the front burst draws over her body. */
  burstFrontDepthAhead: 0.05,
  /** When false, front copy still draws in front but is not silhouette-masked. */
  burstFrontMask: true,

  /** Enemy spawn — rise from below floor + ground burst sheet (Stage 1). */
  spawnRiseDepth: 48,
  /** Ms to ease z from −spawnRiseDepth to rest hoverZ (0 for ground enemies). */
  spawnRiseMs: 720,
  /** Source sheet: 40 × 242×256 RGBA strip in public/fx/enemy-spawn/. */
  enemySpawnFrameWidth: 242,
  enemySpawnFrameHeight: 256,
  enemySpawnFrameCount: 40,
  enemySpawnFrameRate: 25,
  /** Screen height (px at entityScale 1) for the spawn burst (~35% smaller than 72). */
  enemySpawnFxDisplayHeight: 47,
  /** Playback speed multiplier (1.4 = 40% faster). */
  enemySpawnFxTimeScale: 1.4,
  enemySpawnScale: 1,
  /** Phaser blend mode — NORMAL respects RGBA alpha. */
  enemySpawnBlendMode: 0,
  enemySpawnDepthTieBreak: 0.9,
  /** Subtracted from enemy body depth so the burst sits behind the rising enemy. */
  enemySpawnDepthBehind: 0.04,

  /** Optional radial sheets (preloaded; gameplay wiring TBD). */
  groundRadialFrameWidth: 256,
  groundRadialFrameHeight: 225,
  groundRadialFrameCount: 7,
  groundRadialFrameRate: 25,
  radialPowerupFrameWidth: 201,
  radialPowerupFrameHeight: 256,
  radialPowerupFrameCount: 25,
  radialPowerupFrameRate: 25,

  /** Game continuation spawn X after Munchkinland fork (west end of road). */
  gameContinuationSpawnFloorX: 80,

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
    fencePost: 0x6a5a48,
    fenceOutline: 0x14100c,
    fenceWoodDark: 0x3a2418,
    fenceWoodMid: 0x6b442c,
    fenceWoodLight: 0x8f5e3c,
    fenceWoodHi: 0xb0784c,
    fenceWoodGrain: 0x4e2e1c,
    fenceWoodSide: 0x452818,
    forkMarker: 0xe8d5a3,
    player: 0xc4a35a,
    shadow: 0x1a1a1e,
    grass: 0x3a4a32,
    sceneryGroundFar: 0x2a3826,
    sceneryGroundNear: 0x3e5238,
    sceneryHillLit: 0x4d6844,
    sceneryHillShadow: 0x1c281a,
    trackBeyond: 0x5a7a52,
    trackFar: 0x6a8aaa,
    trackMidFar: 0x7a9a7a,
    trackMid: 0x8a9a6a,
    trackNear: 0xaa8a6a,
    enemy: 0xb05050,
    enemyFlash: 0xffffff,
    redEnergy: 0xe03040,
    redEnergySoft: 0xff6a6a,
    slipperCrimson: 0xe01830,
    slipperRoadGlow: 0xffc070,
    hpBarBg: 0x2a2a32,
    hpBarGreen: 0x44cc55,
    hpBarYellow: 0xe8d44a,
    hpBarOrange: 0xe88838,
    hpBarRed: 0xdd4444,
    hpBarFill: 0xc4a35a,
    hpBarLow: 0xb05050,
    cooldownReady: 0xc4a35a,
    cooldownBusy: 0x5a5a68,
    ultimateChargeEmpty: 0x7a7a86,
    ultimateCharge: 0xb44cff,
    damageNumber: 0xffe8a0,
    atmSkyCool: 0x2a3348,
    atmSkyWarm: 0x4a5878,
    atmCloudSoft: 0x6a7898,
    atmCloudLit: 0x9ab0c8,
    atmHazeGold: 0xe8c878,
    atmMistGreen: 0x5a7a52,
    atmDepthWash: 0x1a2430,
    atmDustFar: 0xc8d8e8,
    atmDustMid: 0xe8e0c8,
    atmSparkNear: 0xfff4d0,
  },
} as const;

export type Tuning = typeof tuning;
