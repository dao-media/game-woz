import Phaser from 'phaser';
import { Projection } from '../core/Projection';
import { tuning } from '../config/tuning';

const MOTE = 'atm-mote';
const SPARK = 'atm-spark';

function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(MOTE)) return;

  const soft = scene.textures.createCanvas(MOTE, 12, 12)!;
  const ctx = soft.getContext();
  const g = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 12, 12);
  soft.refresh();

  const spark = scene.textures.createCanvas(SPARK, 8, 8)!;
  const sctx = spark.getContext();
  sctx.fillStyle = 'rgba(255,255,255,1)';
  sctx.fillRect(3, 0, 2, 8);
  sctx.fillRect(0, 3, 8, 2);
  spark.refresh();
}

type LayerRoot = Phaser.GameObjects.Graphics | Phaser.GameObjects.Particles.ParticleEmitter;

/**
 * Multi-plane atmosphere: parallax sky bands, horizon glow, ground mist,
 * depth-graded dust motes, and a subtle screen vignette.
 */
export class LayeredAtmospherics {
  private readonly scene: Phaser.Scene;
  private readonly worldWidth: number;
  private readonly roots: LayerRoot[] = [];

  private skyFar!: Phaser.GameObjects.Graphics;
  private skyMid!: Phaser.GameObjects.Graphics;
  private horizonGlow!: Phaser.GameObjects.Graphics;
  private groundMist!: Phaser.GameObjects.Graphics;
  private depthWash!: Phaser.GameObjects.Graphics;
  private vignette!: Phaser.GameObjects.Graphics;

  private dustFar!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dustMid!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkNear!: Phaser.GameObjects.Particles.ParticleEmitter;

  private pulseMs = 0;
  private masterAlpha = 1;

  constructor(scene: Phaser.Scene, worldWidth: number) {
    this.scene = scene;
    this.worldWidth = worldWidth;
    ensureTextures(scene);

    this.skyFar = this.makeSkyLayer(-2500, tuning.atmSkyFarScroll);
    this.skyMid = this.makeSkyLayer(-2300, tuning.atmSkyMidScroll);
    this.horizonGlow = scene.add.graphics().setDepth(-1990).setScrollFactor(0);
    this.groundMist = this.makeSkyLayer(-980, tuning.atmGroundMistScroll);
    this.depthWash = scene.add.graphics().setDepth(78000).setScrollFactor(0);
    this.vignette = scene.add.graphics().setDepth(78001).setScrollFactor(0);

    this.dustFar = this.makeDustEmitter(-1200, tuning.atmSkyMidScroll, {
      qty: tuning.atmDustFarQty,
      speedX: tuning.atmDustFarSpeedX,
      speedY: tuning.atmDustFarSpeedY,
      gravityY: tuning.atmDustGravityY,
      scale: { start: 0.18, end: 0.04 },
      alpha: { start: 0.2, end: 0 },
      lifespan: { min: 4800, max: 9000 },
      tint: tuning.colors.atmDustFar,
      zoneTop: 0.02,
      zoneBottom: 0.58,
    });
    this.dustMid = this.makeDustEmitter(-400, tuning.atmGroundMistScroll, {
      qty: tuning.atmDustMidQty,
      speedX: tuning.atmDustMidSpeedX,
      speedY: tuning.atmDustMidSpeedY,
      gravityY: tuning.atmDustGravityY,
      scale: { start: 0.26, end: 0.06 },
      alpha: { start: 0.3, end: 0 },
      lifespan: { min: 3400, max: 6400 },
      tint: tuning.colors.atmDustMid,
      zoneTop: 0.12,
      zoneBottom: 0.78,
    });
    this.sparkNear = this.makeDustEmitter(42000, tuning.atmSparkNearScroll, {
      qty: tuning.atmSparkNearQty,
      speedX: tuning.atmSparkNearSpeedX,
      speedY: tuning.atmSparkNearSpeedY,
      gravityY: tuning.atmSparkGravityY,
      scale: { start: 0.32, end: 0.08 },
      alpha: { start: 0.42, end: 0 },
      lifespan: { min: 2000, max: 4200 },
      tint: tuning.colors.atmSparkNear,
      zoneTop: 0.28,
      zoneBottom: 0.98,
      texture: SPARK,
    });

    this.roots.push(
      this.skyFar,
      this.skyMid,
      this.horizonGlow,
      this.groundMist,
      this.depthWash,
      this.vignette,
      this.dustFar,
      this.dustMid,
      this.sparkNear,
    );

    this.drawSkyFar();
    this.drawSkyMid();
    this.drawScreenOverlays();

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Fade with stage intro (Munchkinland) or cutscene overlays. */
  setAlpha(alpha: number): void {
    this.masterAlpha = Phaser.Math.Clamp(alpha, 0, 1);
    for (const root of this.roots) {
      root.setAlpha(this.masterAlpha);
    }
  }

  /** All layers — for intro cross-fades that tween individual objects. */
  get displayObjects(): readonly Phaser.GameObjects.GameObject[] {
    return this.roots;
  }

  update(dtMs: number, cameraScrollX: number): void {
    this.pulseMs += dtMs;
    this.drawHorizonGlow(cameraScrollX);
    this.animateGroundMist(cameraScrollX);
    this.positionEmitters(cameraScrollX);
  }

  destroy(): void {
    for (const root of this.roots) {
      root.destroy();
    }
    this.roots.length = 0;
  }

  private makeSkyLayer(depth: number, scrollFactor: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics().setDepth(depth).setScrollFactor(scrollFactor);
    return g;
  }

  private drawSkyFar(): void {
    const g = this.skyFar;
    g.clear();
    const horizon = Projection.horizonY();
    const top = horizon - tuning.backdropHeight;
    const h = horizon - top;

    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const t1 = (i + 1) / bands;
      const y0 = Phaser.Math.Linear(top, horizon, t0);
      const y1 = Phaser.Math.Linear(top, horizon, t1);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(tuning.colors.atmSkyCool),
        Phaser.Display.Color.ValueToColor(tuning.colors.atmSkyWarm),
        bands,
        i,
      );
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 0.55 * tuning.atmSkyBandAlpha);
      g.fillRect(0, y0, this.worldWidth, Math.max(1, y1 - y0));
    }

    g.fillStyle(tuning.colors.atmCloudSoft, tuning.atmSkyCloudAlpha * 0.55);
    for (let x = -120; x < this.worldWidth + 120; x += tuning.atmSkyCloudSpacing) {
      const wobble = Math.sin(x * 0.004) * 18;
      g.fillEllipse(x + 140, top + h * 0.22 + wobble, 220, 46);
      g.fillEllipse(x + 60, top + h * 0.38 - wobble * 0.5, 160, 32);
    }
  }

  private drawSkyMid(): void {
    const g = this.skyMid;
    g.clear();
    const horizon = Projection.horizonY();
    const top = horizon - tuning.backdropHeight;
    const h = horizon - top;

    g.fillStyle(tuning.colors.atmCloudLit, tuning.atmSkyCloudAlpha);
    for (let x = -80; x < this.worldWidth + 80; x += tuning.atmSkyCloudSpacing * 0.72) {
      const drift = Math.sin(x * 0.007 + 1.3) * 12;
      g.fillEllipse(x + 90, top + h * 0.52 + drift, 130, 28);
      g.fillEllipse(x + 200, top + h * 0.64 - drift, 96, 20);
    }

    g.lineStyle(1, tuning.colors.atmCloudLit, 0.08);
    for (let x = 0; x < this.worldWidth; x += 48) {
      const y = top + h * (0.45 + 0.12 * Math.sin(x * 0.011));
      g.lineBetween(x, y, x + 36, y + 6);
    }
  }

  private animateGroundMist(cameraScrollX: number): void {
    const g = this.groundMist;
    const pulse = 0.82 + 0.18 * Math.sin(this.pulseMs * tuning.atmMistPulseSpeed);

    const horizon = Projection.horizonY();
    const roadFarY = Projection.floorYToScreenY(tuning.depthFar);
    const span = Math.max(8, roadFarY - horizon);
    const phase = cameraScrollX * 0.002 + this.pulseMs * 0.00035;

    g.clear();
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const wave = Math.sin(phase + i * 1.7) * 8;
      const y = horizon + span * (0.1 + t * 0.82) + wave;
      const alpha = tuning.atmGroundMistAlpha * (1 - t * 0.5) * pulse;
      g.fillStyle(tuning.colors.atmMistGreen, alpha);
      g.fillRect(-40, y - 12, this.worldWidth + 80, 24);
    }
  }

  private drawHorizonGlow(_cameraScrollX: number): void {
    const g = this.horizonGlow;
    g.clear();
    const horizon = Projection.horizonY();
    const h = tuning.atmHorizonHazeHeight;
    const w = tuning.gameWidth;
    const steps = 8;

    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const y0 = horizon - h * 0.35 + h * t0;
      const y1 = horizon - h * 0.35 + h * t1;
      const a = tuning.atmHorizonHazeAlpha * (1 - t0);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(tuning.colors.atmHazeGold),
        Phaser.Display.Color.ValueToColor(tuning.colors.horizon),
        steps,
        i,
      );
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), a);
      g.fillRect(0, y0, w, Math.max(1, y1 - y0));
    }
  }

  private drawScreenOverlays(): void {
    const w = tuning.gameWidth;
    const h = tuning.gameHeight;
    const horizon = Projection.horizonY();

    this.depthWash.clear();
    const washSteps = 6;
    for (let i = 0; i < washSteps; i++) {
      const t0 = i / washSteps;
      const t1 = (i + 1) / washSteps;
      const y0 = Phaser.Math.Linear(horizon - 20, h, t0);
      const y1 = Phaser.Math.Linear(horizon - 20, h, t1);
      const a = tuning.atmDepthWashAlpha * t0;
      this.depthWash.fillStyle(tuning.colors.atmDepthWash, a);
      this.depthWash.fillRect(0, y0, w, Math.max(1, y1 - y0));
    }

    this.vignette.clear();
    const vig = tuning.atmVignetteStrength;
    const pad = 28;
    this.vignette.fillStyle(0x0a0a12, vig * 0.35);
    this.vignette.fillRect(0, 0, w, pad);
    this.vignette.fillRect(0, h - pad, w, pad);
    this.vignette.fillRect(0, 0, pad, h);
    this.vignette.fillRect(w - pad, 0, pad, h);
  }

  private makeDustEmitter(
    depth: number,
    scrollFactor: number,
    cfg: {
      qty: number;
      speedX: { readonly min: number; readonly max: number };
      speedY: { readonly min: number; readonly max: number };
      gravityY: number;
      scale: { start: number; end: number };
      alpha: { start: number; end: number };
      lifespan: { min: number; max: number };
      tint: number;
      zoneTop: number;
      zoneBottom: number;
      texture?: string;
    },
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    const horizon = Projection.horizonY();
    const nearY = Projection.floorYToScreenY(tuning.depthNear + tuning.worldFloorPad);
    const zoneTop = horizon + (nearY - horizon) * cfg.zoneTop;
    const zoneBottom = horizon + (nearY - horizon) * cfg.zoneBottom;
    const zoneH = Math.max(24, zoneBottom - zoneTop);
    // Emit across a viewport-wide band, with a little side pad so edges don’t clip.
    const zoneW = tuning.gameWidth + 120;

    // qty ≈ particles/sec. Cap frequency so denser layers actually fill the volume.
    const perSec = Math.max(0, cfg.qty);
    const frequency = perSec <= 0 ? -1 : Math.max(40, Math.round(1000 / perSec));

    const emitter = this.scene.add.particles(0, 0, cfg.texture ?? MOTE, {
      blendMode: Phaser.BlendModes.ADD,
      emitting: perSec > 0,
      // Point mode: independent X/Y drift (radial+angle ≈180 was the “stream” look).
      radial: false,
      frequency,
      quantity: 1,
      speedX: { min: cfg.speedX.min, max: cfg.speedX.max },
      speedY: { min: cfg.speedY.min, max: cfg.speedY.max },
      gravityY: cfg.gravityY,
      scale: cfg.scale,
      alpha: cfg.alpha,
      lifespan: cfg.lifespan,
      tint: cfg.tint,
      rotate: { min: 0, max: 360 },
      advance: tuning.atmDustAdvanceMs,
      maxAliveParticles: Math.ceil(perSec * 12) + 24,
      emitZone: {
        type: 'random',
        source: {
          getRandomPoint: (out) => {
            out.x = Math.random() * zoneW - zoneW * 0.5;
            out.y = zoneTop + Math.random() * zoneH;
            return out;
          },
        },
      } as Phaser.Types.GameObjects.Particles.ParticleEmitterRandomZoneConfig,
    });
    emitter.setDepth(depth).setScrollFactor(scrollFactor);
    return emitter;
  }

  private positionEmitters(cameraScrollX: number): void {
    // Keep the emit volume locked to the camera mid so parallax layers stay filled
    // while scrollFactor handles lag. Y stays 0 — zone coords are absolute screen Y.
    const cx = cameraScrollX + tuning.gameWidth / 2;
    this.dustFar.setPosition(cx, 0);
    this.dustMid.setPosition(cx, 0);
    this.sparkNear.setPosition(cx, 0);
  }
}
