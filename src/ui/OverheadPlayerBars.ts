import Phaser from 'phaser';
import { Projection } from '../core/Projection';
import { applyDepth } from '../core/DepthSort';
import { tuning } from '../config/tuning';
import type { Player } from '../entities/Player';

const SPARKLE_KEY = 'overhead-ult-sparkle';

const HP_COLOR_STOPS: readonly { t: number; color: number }[] = [
  { t: 1, color: tuning.colors.hpBarGreen },
  { t: 0.66, color: tuning.colors.hpBarYellow },
  { t: 0.33, color: tuning.colors.hpBarOrange },
  { t: 0, color: tuning.colors.hpBarRed },
];

function lerpColor(from: number, to: number, t: number): number {
  const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(
    Phaser.Display.Color.IntegerToColor(from),
    Phaser.Display.Color.IntegerToColor(to),
    100,
    Math.round(Phaser.Math.Clamp(t, 0, 1) * 100),
  );
  return Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b);
}

function hpFillColor(ratio: number): number {
  const r = Phaser.Math.Clamp(ratio, 0, 1);
  for (let i = 0; i < HP_COLOR_STOPS.length - 1; i++) {
    const a = HP_COLOR_STOPS[i]!;
    const b = HP_COLOR_STOPS[i + 1]!;
    if (r <= a.t && r >= b.t) {
      const span = a.t - b.t;
      const u = span <= 0 ? 0 : (a.t - r) / span;
      return lerpColor(a.color, b.color, u);
    }
  }
  return tuning.colors.hpBarRed;
}

function ensureSparkleTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SPARKLE_KEY)) return;
  const s = 5;
  const tex = scene.textures.createCanvas(SPARKLE_KEY, s, s);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fillRect(2, 0, 1, 5);
  ctx.fillRect(0, 2, 5, 1);
  tex.refresh();
}

/** Clockwise position on a centered rectangle perimeter (t ∈ [0, 1)). */
function pointOnRectPath(
  t: number,
  halfW: number,
  halfH: number,
): { x: number; y: number } {
  const width = halfW * 2;
  const height = halfH * 2;
  const perimeter = 2 * (width + height);
  let d = ((t % 1) + 1) % 1 * perimeter;

  if (d < width) return { x: -halfW + d, y: -halfH };
  d -= width;
  if (d < height) return { x: halfW, y: -halfH + d };
  d -= height;
  if (d < width) return { x: halfW - d, y: halfH };
  d -= width;
  return { x: -halfW, y: halfH - d };
}

const pathOffsetByParticle = new WeakMap<
  Phaser.GameObjects.Particles.Particle,
  number
>();

/**
 * HP + ultimate charge bars floating above the player.
 * Tracks screen position (X/Y) with the character; bar size and head gap stay
 * fixed in screen pixels — no perspective / depth scaling.
 */
export class OverheadPlayerBars {
  private readonly root: Phaser.GameObjects.Container;
  private readonly hpBg: Phaser.GameObjects.Rectangle;
  private readonly hpFill: Phaser.GameObjects.Rectangle;
  private readonly ultBg: Phaser.GameObjects.Rectangle;
  private readonly ultFill: Phaser.GameObjects.Rectangle;
  private readonly sparkles: Phaser.GameObjects.Particles.ParticleEmitter | null;

  private readonly barW = tuning.overheadBarWidth;
  private readonly barH = tuning.overheadBarHeight;
  private readonly barGap = tuning.overheadBarGap;
  private readonly ultLocalY: number;
  private waveMs = 0;
  private nextWaveAtMs = 0;
  private ultWasFull = false;
  private orbitPhase = 0;

  constructor(scene: Phaser.Scene) {
    ensureSparkleTexture(scene);

    this.hpBg = scene.add.rectangle(0, 0, this.barW, this.barH, tuning.colors.hpBarBg, 0.92);
    this.hpBg.setStrokeStyle(1, 0x5a5a68, 0.85);
    this.hpFill = scene.add
      .rectangle(-this.barW / 2, 0, this.barW, this.barH, tuning.colors.hpBarGreen)
      .setOrigin(0, 0.5);

    this.ultLocalY = this.barGap + this.barH;
    this.ultBg = scene.add.rectangle(0, this.ultLocalY, this.barW, this.barH, tuning.colors.hpBarBg, 0.92);
    this.ultBg.setStrokeStyle(1, 0x5a5a68, 0.85);
    this.ultFill = scene.add
      .rectangle(-this.barW / 2, this.ultLocalY, this.barW, this.barH, tuning.colors.ultimateChargeEmpty)
      .setOrigin(0, 0.5);

    this.root = scene.add.container(0, 0, [
      this.hpBg,
      this.hpFill,
      this.ultBg,
      this.ultFill,
    ]);
    this.root.setScrollFactor(1);

    // Keep emitters out of containers — nested particle emitters can stall WebGL updates.
    if (scene.textures.exists(SPARKLE_KEY)) {
      const halfW = this.barW / 2 + tuning.ultMeterSparklePathPad;
      const halfH = this.barH / 2 + tuning.ultMeterSparklePathPad;

      const pathCoord = (
        particle: Phaser.GameObjects.Particles.Particle | undefined,
        axis: 'x' | 'y',
        assignOffset: boolean,
      ): number => {
        if (!particle) return 0;
        if (assignOffset && !pathOffsetByParticle.has(particle)) {
          pathOffsetByParticle.set(particle, Math.random());
        }
        const offset = pathOffsetByParticle.get(particle) ?? 0;
        const t = (offset + this.orbitPhase) % 1;
        return pointOnRectPath(t, halfW, halfH)[axis];
      };

      this.sparkles = scene.add.particles(0, 0, SPARKLE_KEY, {
        emitting: false,
        frequency: -1,
        speed: 0,
        lifespan: {
          min: tuning.ultMeterSparkleLifespanMin,
          max: tuning.ultMeterSparkleLifespanMax,
        },
        scale: {
          start: tuning.ultMeterSparkleScaleStart,
          end: tuning.ultMeterSparkleScaleEnd,
        },
        alpha: {
          start: tuning.ultMeterSparkleAlphaStart,
          end: 0,
        },
        rotate: { min: 0, max: 360 },
        tint: [0xffffff, 0xe8c8ff, tuning.colors.ultimateCharge],
        blendMode: Phaser.BlendModes.ADD,
        x: {
          onEmit: (particle) => pathCoord(particle, 'x', true),
          onUpdate: (particle) => pathCoord(particle, 'x', false),
        },
        y: {
          onEmit: (particle) => pathCoord(particle, 'y', false),
          onUpdate: (particle) => pathCoord(particle, 'y', false),
        },
      });
      this.sparkles.setScrollFactor(1);
      this.sparkles.setVisible(false);
    } else {
      this.sparkles = null;
    }
  }

  update(player: Player, dtMs = 16): void {
    const visible = !player.health.isDead;
    this.root.setVisible(visible);
    if (!visible) {
      this.sparkles?.stop();
      this.sparkles?.setVisible(false);
      this.ultWasFull = false;
      return;
    }

    const anchorX =
      player.visual?.x ?? Projection.toScreen(player.floorX, player.floorY, player.z).x;

    let headTopY: number;
    if (player.visual) {
      headTopY = player.visual.y - player.visual.displayHeight;
    } else {
      const entityScale = Projection.entityDepthScale(
        player.floorY,
        tuning.playerDepthScaleStrength,
      );
      headTopY = player.body.y - tuning.playerBodyHeight * entityScale;
    }

    const rootY = headTopY + tuning.overheadBarOffsetY;
    this.root.setPosition(anchorX, rootY);
    applyDepth(this.root, player.floorY, 3);

    const hpRatio = Phaser.Math.Clamp(player.health.ratio, 0, 1);
    this.hpFill.width = this.barW * hpRatio;
    this.hpFill.fillColor = hpFillColor(hpRatio);

    const ultRatio = Phaser.Math.Clamp(player.ultimateCharge, 0, 1);
    const ultFull = ultRatio >= 1;
    this.ultFill.width = this.barW * ultRatio;
    this.ultFill.fillColor = lerpColor(
      tuning.colors.ultimateChargeEmpty,
      tuning.colors.ultimateCharge,
      ultRatio,
    );

    if (this.sparkles) {
      this.sparkles.setPosition(anchorX, rootY + this.ultLocalY);
      applyDepth(this.sparkles, player.floorY, 3);
      this.sparkles.setVisible(ultFull);
    }

    this.ultFill.setAlpha(player.ultimateCooldownRemainMs > 0 ? 0.65 : 1);
    if (ultFull) {
      this.orbitPhase =
        (this.orbitPhase + dtMs / tuning.ultMeterSparkleOrbitPeriodMs) % 1;
      this.tickSparkleWaves(dtMs);
    } else {
      this.ultWasFull = false;
      this.waveMs = 0;
      this.nextWaveAtMs = 0;
      this.orbitPhase = 0;
    }
  }

  /** Sparse burst waves — sparkles ride a single shared path around the bar. */
  private tickSparkleWaves(dtMs: number): void {
    if (!this.sparkles) return;

    if (!this.ultWasFull) {
      this.ultWasFull = true;
      this.waveMs = 0;
      this.nextWaveAtMs = 0;
    }

    this.waveMs += dtMs;
    if (this.waveMs < this.nextWaveAtMs) return;

    const count = Phaser.Math.Between(
      tuning.ultMeterSparkleBurstMin,
      tuning.ultMeterSparkleBurstMax,
    );
    this.sparkles.explode(count);

    const base = tuning.ultMeterSparkleWaveIntervalMs;
    const jitter = Phaser.Math.Between(-120, 120);
    this.nextWaveAtMs = this.waveMs + base + jitter;
  }

  destroy(): void {
    this.sparkles?.destroy();
    this.root.destroy();
  }
}
