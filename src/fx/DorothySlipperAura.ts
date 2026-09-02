import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';
import type { Player } from '../entities/Player';
import {
  getMeasuredFeetScreen,
  getMeasuredFeetScreenMarkers,
} from '../entities/dorothyFeet';
import {
  applySlipperSparkleTuning,
  registerSlipperSparklePipeline,
  SLIPPER_SPARKLE_PIPELINE,
  SlipperSparklePipeline,
} from './SlipperSparklePipeline';
import { ensureTransparentQuadTexture } from './transparentTexture';
import { groundBurstDurationMs } from './groundBurstAssets';

const SLIPPER_GLINT_TEX = 'slipper-glint-dot';
const SLIPPER_LIGHT_DISC_TEX = 'slipper-light-disc';

type FeetOrigins = {
  center: { x: number; y: number };
  front: { x: number; y: number } | null;
  back: { x: number; y: number } | null;
};

type OrbitGlint = {
  img: Phaser.GameObjects.Image;
  phase: number;
  /** Signed speed multiplier (negative = reverse orbit). */
  speedMult: number;
  radiusMult: number;
  tint: number;
  twinklePhase: number;
};

/** Fade-in window: explicit ms, else match ground-burst play length. */
function glowFadeInMs(): number {
  if (tuning.slipperGlowFadeInMs > 0) return tuning.slipperGlowFadeInMs;
  const burst = groundBurstDurationMs();
  if (burst > 0) return burst;
  return tuning.slipperSparkleFadeInMs || 300;
}

/** F3 — measured sole contact for the current clip/frame. */
export function computePlayerFeetScreen(
  player: Player,
): { x: number; y: number } | null {
  const vis = player.visual;
  if (!vis) return null;
  return getMeasuredFeetScreen(vis);
}

/** F3 — profile front/back foot markers when split. */
export function computePlayerFeetMarkers(
  player: Player,
): FeetOrigins | null {
  const vis = player.visual;
  if (!vis) return null;
  const m = getMeasuredFeetScreenMarkers(vis);
  return { center: m.center, front: m.front, back: m.back };
}

function ensureGlintTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(SLIPPER_GLINT_TEX)) return SLIPPER_GLINT_TEX;
  const s = 32;
  const tex = scene.textures.createCanvas(SLIPPER_GLINT_TEX, s, s)!;
  const ctx = tex.getContext();
  const r = s / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  tex.refresh();
  return SLIPPER_GLINT_TEX;
}

/** Soft elliptical crimson falloff for the floor light disc. */
function ensureLightDiscTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(SLIPPER_LIGHT_DISC_TEX)) return SLIPPER_LIGHT_DISC_TEX;
  const w = 128;
  const h = 64;
  const tex = scene.textures.createCanvas(SLIPPER_LIGHT_DISC_TEX, w, h)!;
  const ctx = tex.getContext();
  const cx = w / 2;
  const cy = h / 2;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / cx;
      const ny = (y - cy) / cy;
      const d = Math.sqrt(nx * nx + ny * ny);
      const a = d >= 1 ? 0 : Math.pow(1 - d, 1.65);
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  return SLIPPER_LIGHT_DISC_TEX;
}

/**
 * Ultimate-ready slipper aura.
 *
 * Active path: whole-silhouette duplicate of Dorothy's live sprite + Phaser
 * postFX glow (tracks every anim state via frame + transform copy). Sparkles
 * orbit the sprite feet origin — no per-foot / feetFront-feetBack glow path.
 */
export class DorothySlipperAura {
  private readonly scene: Phaser.Scene;
  private glowSprite: Phaser.GameObjects.Sprite | null = null;
  private glowFx: Phaser.FX.Glow | null = null;
  private lightDisc: Phaser.GameObjects.Image | null = null;
  private shadowSuppressed = false;
  private readonly orbitGlints: OrbitGlint[] = [];
  private readonly legacyPipeline: SlipperSparklePipeline | null;
  private readonly legacyReady: boolean;
  private readonly legacyFront: Phaser.GameObjects.Image | null = null;
  private readonly legacyBack: Phaser.GameObjects.Image | null = null;

  private prevCharge = 0;
  /** 0→1 fade-in when charge crosses full (synced with ground burst). */
  private sparkleFadeT = 0;
  private feetOrigins: FeetOrigins | null = null;
  /** Seconds — drives glow brightness waves. */
  private glowWaveT = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const useLegacy = tuning.slipperSparkleLegacyRim;
    const useDup = tuning.slipperGlowDuplicateEnabled && !useLegacy;

    this.legacyReady = useLegacy && this.tryRegisterLegacyPipeline(scene);
    this.legacyPipeline = this.legacyReady
      ? ((scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines.get(
          SLIPPER_SPARKLE_PIPELINE,
        ) as SlipperSparklePipeline)
      : null;

    if (useLegacy && this.legacyReady) {
      const tex = ensureTransparentQuadTexture(scene);
      this.legacyFront = this.createLegacyImage(scene, tex);
      this.legacyBack = this.createLegacyImage(scene, tex);
    }

    if (useDup) {
      const tex = ensureTransparentQuadTexture(scene);
      const sprite = scene.add
        .sprite(0, 0, tex)
        .setScrollFactor(1)
        .setVisible(false)
        .setBlendMode(tuning.slipperGlowBlendMode);

      try {
        this.glowFx = sprite.postFX.addGlow(
          tuning.slipperGlowColor,
          tuning.slipperGlowOuterStrength,
          tuning.slipperGlowInnerStrength,
          true,
          tuning.slipperGlowQuality,
          tuning.slipperGlowDistance,
        );
        this.glowSprite = sprite;
      } catch (err) {
        console.warn('[DorothySlipperAura] postFX.addGlow failed', err);
        sprite.destroy();
      }

      this.orbitGlints.push(...this.createOrbitGlints(scene));
    }

    const discKey = ensureLightDiscTexture(scene);
    this.lightDisc = scene.add
      .image(0, 0, discKey)
      .setVisible(false)
      .setScrollFactor(1)
      .setOrigin(0.5, 0.5)
      .setBlendMode(tuning.slipperLightDiscBlend)
      .setTint(tuning.slipperLightDiscColor);
  }

  private createOrbitGlints(scene: Phaser.Scene): OrbitGlint[] {
    const key = ensureGlintTexture(scene);
    const tints =
      tuning.slipperSparkleTints.length > 0
        ? tuning.slipperSparkleTints
        : [tuning.slipperSparkleTint];
    const n = Math.max(1, Math.round(tuning.slipperSparkleCount));
    const out: OrbitGlint[] = [];
    for (let i = 0; i < n; i++) {
      const tint = tints[i % tints.length]!;
      const img = scene.add
        .image(0, 0, key)
        .setVisible(false)
        .setScrollFactor(1)
        .setBlendMode(tuning.slipperSparkleParticleBlend)
        .setTint(tint);
      out.push({
        img,
        phase: (i / n) * Math.PI * 2,
        speedMult: (i % 2 === 0 ? 1 : -1) * (0.88 + (i % 3) * 0.1),
        radiusMult: 0.72 + (i % 4) * 0.1,
        tint,
        twinklePhase: (i * 1.7) % (Math.PI * 2),
      });
    }
    return out;
  }

  private tryRegisterLegacyPipeline(scene: Phaser.Scene): boolean {
    const renderer = scene.game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
    try {
      registerSlipperSparklePipeline(scene.game);
      return renderer.pipelines.has(SLIPPER_SPARKLE_PIPELINE);
    } catch (err) {
      console.warn('[DorothySlipperAura] legacy sparkle pipeline failed', err);
      return false;
    }
  }

  private createLegacyImage(
    scene: Phaser.Scene,
    texKey: string,
  ): Phaser.GameObjects.Image {
    const img = scene.add
      .image(0, 0, texKey)
      .setOrigin(0.5, 1)
      .setScrollFactor(1)
      .setBlendMode(tuning.slipperSparkleBlendMode)
      .setVisible(false);
    if (this.legacyReady) img.setPipeline(SLIPPER_SPARKLE_PIPELINE);
    return img;
  }

  /** Called when ground burst fires — fade starts from 0 with the burst. */
  beginSparkleFadeIn(): void {
    if (this.sparkleFadeT <= 0 || this.sparkleFadeT >= 1) {
      this.sparkleFadeT = 0;
    }
  }

  /** Debug: replay charge-full glow fade from 0 (with burst). */
  forceChargeFullActivate(): void {
    this.prevCharge = 0;
    this.sparkleFadeT = 0;
  }

  getDebugState(player: Player): {
    pipelineReady: boolean;
    active: boolean;
    fadeT: number;
    frontVisible: boolean;
    frontAlpha: number;
    frontW: number;
    frontH: number;
    mode: string;
    textureKey: string;
    frameName: string;
    pipeline: ReturnType<SlipperSparklePipeline['getDebugState']> | null;
  } {
    const glow = this.glowSprite;
    const vis = player.visual;
    return {
      pipelineReady: this.glowFx != null || this.legacyReady,
      active: this.isActive(player),
      fadeT: this.sparkleFadeT,
      frontVisible: glow?.visible ?? this.legacyFront?.visible ?? false,
      frontAlpha: glow?.alpha ?? this.legacyFront?.alpha ?? 0,
      frontW: glow?.displayWidth ?? this.legacyFront?.displayWidth ?? 0,
      frontH: glow?.displayHeight ?? this.legacyFront?.displayHeight ?? 0,
      mode: this.glowFx
        ? 'duplicate-glow'
        : this.legacyReady
          ? 'legacy-rim'
          : 'off',
      textureKey: glow?.texture.key ?? vis?.texture.key ?? '',
      frameName: String(glow?.frame.name ?? vis?.frame.name ?? ''),
      pipeline: this.legacyPipeline?.getDebugState() ?? null,
    };
  }

  getFeetOrigins(): FeetOrigins | null {
    return this.feetOrigins;
  }

  getFeetOrigin(): { x: number; y: number } | null {
    return this.feetOrigins?.center ?? null;
  }

  getSparkleFade(): number {
    return this.sparkleFadeT;
  }

  update(player: Player, dtMs: number): void {
    const charge = player.ultimateCharge;
    if (this.prevCharge < 1 && charge >= 1) {
      this.beginSparkleFadeIn();
    }
    this.prevCharge = charge;

    const active = this.isActive(player);
    if (!active) {
      this.hideAll(player);
      this.feetOrigins = null;
      if (charge < 1) this.sparkleFadeT = 0;
      return;
    }

    if (this.sparkleFadeT < 1) {
      const fadeMs = glowFadeInMs();
      const step = dtMs / Math.max(fadeMs, 1);
      this.sparkleFadeT = Phaser.Math.Clamp(this.sparkleFadeT + step, 0, 1);
    }

    const fade = Phaser.Math.Easing.Sine.Out(this.sparkleFadeT);
    if (fade <= 0.001) {
      this.hideAll(player);
      return;
    }

    // Debug overlay only — glow path does not use feetFront/feetBack.
    const vis = player.visual;
    if (vis) {
      const m = getMeasuredFeetScreenMarkers(vis);
      this.feetOrigins = {
        center: { x: vis.x, y: vis.y },
        front: m.front,
        back: m.back,
      };
    } else {
      this.feetOrigins = null;
    }

    this.glowWaveT += dtMs / 1000;
    this.syncLightDisc(player, fade);

    if (this.glowSprite && this.glowFx) {
      this.legacyFront?.setVisible(false);
      this.legacyBack?.setVisible(false);
      this.syncDuplicateGlow(player, fade);
      this.syncGlints(player, fade, dtMs);
      return;
    }

    // Legacy ExteriorRim only when duplicate path is off.
    this.stopGlints();
    if (this.legacyReady && this.legacyPipeline && this.legacyFront) {
      this.glowSprite?.setVisible(false);
      this.legacyPipeline.uTime = this.scene.time.now * 0.001;
      applySlipperSparkleTuning(this.legacyPipeline);
      this.syncLegacySingle(player, fade);
    }
  }

  private isActive(player: Player): boolean {
    return (
      (player.ultimateCharge >= 1 && player.ultimateCooldownRemainMs <= 0) ||
      player.state === 'ultimate'
    );
  }

  private hideAll(player?: Player): void {
    this.glowSprite?.setVisible(false);
    this.legacyFront?.setVisible(false);
    this.legacyBack?.setVisible(false);
    this.lightDisc?.setVisible(false);
    this.stopGlints();
    if (player) this.setShadowSuppressed(player, false);
  }

  private setShadowSuppressed(player: Player, suppress: boolean): void {
    if (suppress === this.shadowSuppressed) {
      if (suppress) player.shadow.setVisible(false);
      return;
    }
    this.shadowSuppressed = suppress;
    player.shadow.setVisible(!suppress);
  }

  /**
   * Soft crimson floor disc at the shadow contact point — shoes casting light.
   * Hides the dark ellipse while active.
   */
  private syncLightDisc(player: Player, fade: number): void {
    const disc = this.lightDisc;
    if (!disc) return;

    this.setShadowSuppressed(player, true);

    const ground = Projection.toScreen(player.floorX, player.floorY, 0);
    const groundY = Projection.groundScreenY(player.floorY);
    const entityScale = player.entityVisualScale;
    const airT = Phaser.Math.Clamp(player.z / tuning.shadowMaxZ, 0, 1);
    const airMul = Phaser.Math.Linear(
      tuning.shadowScaleGround,
      tuning.shadowScaleAir,
      airT,
    );
    const wave = this.glowWaveFactor();

    disc.setVisible(true);
    disc.setPosition(ground.x, groundY);
    disc.setDisplaySize(
      tuning.slipperLightDiscWidth * entityScale * airMul,
      tuning.slipperLightDiscHeight * entityScale * airMul,
    );
    disc.setTint(tuning.slipperLightDiscColor);
    disc.setBlendMode(tuning.slipperLightDiscBlend);
    disc.setAlpha(tuning.slipperLightDiscAlpha * fade * (0.85 + 0.15 * wave));
    applyDepth(disc, player.floorY, 0);
  }

  private stopGlints(): void {
    for (const g of this.orbitGlints) {
      g.img.setVisible(false);
    }
  }

  /**
   * Crimson glints on a foreshortened ellipse around the sprite feet origin
   * (vis.x/y — already includes jump z). No per-foot split.
   */
  private syncGlints(player: Player, fade: number, dtMs: number): void {
    const vis = player.visual;
    if (!vis || this.orbitGlints.length === 0) {
      this.stopGlints();
      return;
    }

    const dt = dtMs / 1000;
    const baseSpeed = tuning.slipperSparkleOrbitSpeed;
    const rx0 = tuning.slipperSparkleOrbitRadiusX;
    const ry0 = tuning.slipperSparkleOrbitRadiusY;
    const biasY = tuning.slipperSparkleOrbitBiasY;
    const maxUp = tuning.slipperSparkleOrbitMaxUpPx;
    const depthAmp = tuning.slipperSparkleOrbitDepth;
    const twinkleHz = tuning.slipperSparkleTwinkleHz;
    const size = tuning.slipperSparkleSize;
    const peakA = tuning.slipperSparkleOpacity * fade;
    // Sprite origin is the sole plant — follows jump lift automatically.
    const ax = vis.x;
    const ay = vis.y;

    for (const g of this.orbitGlints) {
      g.phase += baseSpeed * g.speedMult * dt;
      g.twinklePhase += twinkleHz * Math.PI * 2 * dt;

      const a = g.phase;
      const rx = rx0 * g.radiusMult;
      const ry = ry0 * g.radiusMult;
      const x = ax + Math.cos(a) * rx;
      const sinA = Math.sin(a);
      const yOff =
        (sinA >= 0 ? sinA * ry : sinA * ry * 0.45) + biasY;
      const y = Math.max(ay - maxUp, ay + yOff);
      const depthOff = sinA * depthAmp;

      const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(g.twinklePhase));
      const img = g.img;
      img.setVisible(true);
      img.setPosition(x, y);
      img.setScale(size * (0.9 + 0.15 * twinkle));
      img.setAlpha(peakA * twinkle);
      img.setTint(g.tint);
      img.setBlendMode(tuning.slipperSparkleParticleBlend);

      applyDepth(img, player.floorY, tuning.slipperSparkleDepthTieBreak);
      img.setDepth(vis.depth + depthOff);
    }
  }

  /**
   * Mirror Dorothy's live sprite every tick (all anims / dirs / jump z).
   * Crop band is anchored to originY (sole plant in frame space) — NOT the
   * canvas bottom — so jump frames (empty pad under the feet) still glow.
   */
  private syncDuplicateGlow(player: Player, fade: number): void {
    const vis = player.visual;
    const glow = this.glowSprite;
    const fx = this.glowFx;
    if (!vis || !glow || !fx) return;

    // Clear stale crop before swapping atlas frames (jump ↔ walk sizes differ).
    glow.setCrop();

    const frameName = vis.frame.name;
    glow.setTexture(vis.texture.key, frameName);
    // Dorothy mirrors via negative scaleX — do not also flipX.
    glow.setFlip(false, false);
    glow.setOrigin(vis.originX, vis.originY);
    glow.setPosition(vis.x, vis.y);
    glow.setScale(vis.scaleX, vis.scaleY);
    glow.setAngle(vis.angle);
    glow.setBlendMode(tuning.slipperGlowBlendMode);

    const wave = this.glowWaveFactor();
    glow.setAlpha(fade * (0.9 + 0.1 * wave));
    glow.setVisible(true);

    const fh = Math.max(1, glow.frame.height);
    const fw = Math.max(1, glow.frame.width);
    // Sole line in this frame = sprite origin Y (set by applyDorothyFeetOrigin).
    const feetNy = Phaser.Math.Clamp(vis.originY, 0.45, 0.98);
    const band = Phaser.Math.Clamp(
      Math.max(tuning.slipperGlowFootFalloff, tuning.slipperGlowTopCutoff),
      0.06,
      0.45,
    );
    const padBelow = 0.04;
    const cropTopNy = Phaser.Math.Clamp(feetNy - band, 0, 1);
    const cropBotNy = Phaser.Math.Clamp(feetNy + padBelow, cropTopNy + 0.04, 1);
    const cropY = Math.floor(fh * cropTopNy);
    const cropH = Math.max(1, Math.ceil(fh * (cropBotNy - cropTopNy)));
    glow.setCrop(0, cropY, fw, Math.min(cropH, fh - cropY));

    fx.color = tuning.slipperGlowColor;
    fx.outerStrength = tuning.slipperGlowOuterStrength * fade * wave;
    fx.innerStrength = tuning.slipperGlowInnerStrength * fade;

    applyDepth(glow, player.floorY, tuning.slipperGlowDepthTieBreak);
    glow.setDepth(vis.depth - tuning.slipperGlowDepthBehind);
  }

  /** 1 = baseline; peaks at 1+amp — soft dual-sine brightness waves. */
  private glowWaveFactor(): number {
    const amp = Math.max(0, tuning.slipperGlowWaveAmp);
    if (amp <= 0.001) return 1;
    const hz = Math.max(0.05, tuning.slipperGlowWaveHz);
    const t = this.glowWaveT;
    const primary = Math.sin(t * hz * Math.PI * 2);
    const secondary = Math.sin(t * hz * 1.7 * Math.PI * 2 + 1.1);
    const mix = Phaser.Math.Clamp(tuning.slipperGlowWaveSecondary, 0, 1);
    const shaped =
      (1 - mix) * (0.5 + 0.5 * primary) + mix * (0.5 + 0.5 * secondary);
    return 1 + amp * shaped;
  }

  /** Legacy ExteriorRim path — off unless slipperSparkleLegacyRim. */
  private syncLegacySingle(player: Player, fade: number): void {
    const vis = player.visual;
    const image = this.legacyFront;
    if (!vis || !image || !this.legacyPipeline) return;

    const feet = getMeasuredFeetScreen(vis);
    const footW = Phaser.Math.Clamp(
      tuning.slipperSparkleWidthRatio * vis.displayWidth,
      tuning.slipperSparkleMinPx * 0.5,
      tuning.slipperSparkleMaxPx,
    );
    const footH = Phaser.Math.Clamp(
      Math.max(
        tuning.slipperSparkleSampleRatio * vis.displayHeight * 2.4,
        tuning.slipperSparkleMinPx * 0.7,
      ),
      tuning.slipperSparkleMinPx * 0.5,
      tuning.slipperSparkleMaxPx * 0.55,
    );

    image.setVisible(true);
    image
      .setPosition(feet.x, feet.y)
      .setDisplaySize(footW, footH)
      .setBlendMode(tuning.slipperSparkleBlendMode)
      .setAlpha(1);

    this.legacyPipeline.bindSpriteFrame(vis.frame);
    image.setData('slipperSparkle', {
      uAspect: Math.max(footW / Math.max(footH, 1), 0.01),
      uIntensityMult: 1,
      uFadeMult: fade,
      uSourceEdgePx: vis.frame.width,
      uFeetNy: vis.originY,
      textureKey: vis.texture.key,
      frameName: vis.frame.name,
      uFrameUV: [vis.frame.u0, vis.frame.v0, vis.frame.u1, vis.frame.v1],
    });

    applyDepth(image, player.floorY, tuning.slipperSparkleDepthTieBreak);
    image.setDepth(Math.max(image.depth, vis.depth + 0.01));
    this.legacyBack?.setVisible(false);
  }
}
