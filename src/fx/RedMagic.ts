// RedMagic.ts — Scarlet-Witch-style red energy VFX for Phaser 3 (TS).
// One instance per Scene. Textures are generated once and shared.
//
//   const fx = new RedMagic(this);          // in Scene.create()
//   fx.ring(enemy.x, enemy.y);              // ambient orbit (start/stop)
//   fx.pulse(enemy.x, enemy.y);             // Dorothy ULTIMATE — shockwave
//   fx.beam(dorothy.x, dorothy.y, ex, ey);  // slow homing comet
//   fx.blast(dorothy.x, dorothy.y, ex, ey); // directed cone — Dorothy HEAVY
//   fx.channel(mx, my, ax, ay);             // held / re-aimable beam
//
// Requires WebGL (Phaser.AUTO picks it) for ADD blend + postFX bloom.

import Phaser from 'phaser';
import { tuning } from '../config/tuning';

const DOT = 'rm-dot';
const RING = 'rm-ring';

/** red → pink → white; additive overlaps climb toward white-hot on their own */
const PALETTE = [0xff2d2d, 0xff4d4d, 0xff7a6a, 0xffb3a0, 0xffffff];

export interface RedMagicOptions {
  /** ellipse half-width / half-height of the ambient ring */
  radiusX?: number;
  radiusY?: number;
  /** radians/sec the ambient ring sweeps */
  spin?: number;
  /** add a camera-wide bloom+vignette. Turn off if the Scene already blooms. */
  cameraLight?: boolean;
  /**
   * Vertical squash for flat-on-floor rings (pulse / ring).
   * Defaults to the game's foreshorten so magic matches the raked floor plane.
   */
  floorSquash?: number;
}

type ChannelState = {
  mx: number;
  my: number;
  ax: number;
  ay: number;
};

export class RedMagic {
  private scene: Phaser.Scene;
  private dots!: Phaser.GameObjects.Particles.ParticleEmitter;
  private rings!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Directed cone emitter — angle op reads aimDeg (not GameObject rotation). */
  private blastDots!: Phaser.GameObjects.Particles.ParticleEmitter;
  private blastSparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  private opts: Required<RedMagicOptions>;
  private ringOn = false;
  private t = 0;
  private ringPos = { x: 0, y: 0 };
  private channelState: ChannelState | null = null;
  /** Live aim for blast emitter `angle` op (degrees). */
  private aimDeg = 0;
  private blastSpreadDeg = 28;
  private bloomFx: Phaser.FX.Bloom | null = null;
  private vigFx: Phaser.FX.Vignette | null = null;

  constructor(scene: Phaser.Scene, opts: RedMagicOptions = {}) {
    this.scene = scene;
    this.opts = {
      radiusX: 90,
      radiusY: 46,
      spin: 1.6,
      cameraLight: true,
      floorSquash: tuning.foreshorten,
      ...opts,
    };

    RedMagic.ensureTextures(scene);
    this.buildEmitters();
    if (this.opts.cameraLight) this.lightCamera();

    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Live-tune ring / foreshorten knobs (Particle Studio + in-game tweaks). */
  configure(partial: {
    radiusX?: number;
    radiusY?: number;
    spin?: number;
    floorSquash?: number;
  }): void {
    if (partial.radiusX != null) this.opts.radiusX = partial.radiusX;
    if (partial.radiusY != null) this.opts.radiusY = partial.radiusY;
    if (partial.spin != null) this.opts.spin = partial.spin;
    if (partial.floorSquash != null) this.opts.floorSquash = partial.floorSquash;
  }

  /** Live-tune camera bloom / vignette when RedMagic owns them. */
  setCameraLight(bloom: number, blur: number, vig: number): void {
    if (this.bloomFx) {
      this.bloomFx.strength = bloom;
      this.bloomFx.blurStrength = blur;
    }
    if (this.vigFx) this.vigFx.strength = vig;
  }

  // ---- public abilities -----------------------------------------------------

  /** Ambient orbiting ring at a point. Call with no coords to stop. */
  ring(x?: number, y?: number): void {
    if (x == null) {
      this.ringOn = false;
      return;
    }
    this.ringPos.x = x;
    this.ringPos.y = y!;
    this.ringOn = true;
  }

  /** Dorothy ULTIMATE — an expanding shockwave around a point. */
  pulse(x: number, y: number): void {
    const squash = this.opts.floorSquash;
    const flash = this.scene.add
      .image(x, y, DOT)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(9999)
      .setScale(0.3)
      .setTint(0xffffff);
    this.scene.tweens.add({
      targets: flash,
      scale: 3,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.out',
      onComplete: () => flash.destroy(),
    });

    const state = { r: 6 };
    this.scene.tweens.add({
      targets: state,
      r: 130,
      duration: 520,
      ease: 'Cubic.out',
    });
    const ev = this.scene.time.addEvent({
      delay: 12,
      repeat: 42,
      callback: () => {
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2 + Math.random();
          const px = x + Math.cos(a) * state.r;
          const py = y + Math.sin(a) * state.r * squash;
          this.dots.emitParticleAt(px, py, 1);
          if (i % 3 === 0) this.rings.emitParticleAt(px, py, 1);
        }
      },
    });
    this.scene.time.delayedCall(560, () => ev.remove());
  }

  /** Slow homing comet — particles spray omni while spawn travels. */
  beam(x0: number, y0: number, x1: number, y1: number): void {
    const p = { x: x0, y: y0 };
    this.scene.tweens.add({
      targets: p,
      x: x1,
      y: y1,
      duration: 500,
      ease: 'Quad.in',
      onUpdate: () => {
        for (let i = 0; i < 3; i++) {
          this.dots.emitParticleAt(
            p.x + (Math.random() - 0.5) * 10,
            p.y + (Math.random() - 0.5) * 10,
            1,
          );
        }
        if (Math.random() < 0.4) this.sparks.emitParticleAt(p.x, p.y, 1);
      },
      onComplete: () => this.impactBurst(x1, y1),
    });
  }

  /**
   * Directed cone fired toward a target — Dorothy HEAVY.
   * Angle is an emitter op reading `aimDeg`; do not use setAngle on the GameObject.
   */
  blast(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    spreadDeg = 28,
  ): void {
    this.aimDeg = (Phaser.Math.RadToDeg(Math.atan2(y1 - y0, x1 - x0)) + 360) % 360;
    this.blastSpreadDeg = spreadDeg;

    // Muzzle flash
    const muzzle = this.scene.add
      .image(x0, y0, DOT)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(9999)
      .setScale(0.45)
      .setTint(0xffffff);
    this.scene.tweens.add({
      targets: muzzle,
      scale: 1.8,
      alpha: 0,
      duration: 180,
      ease: 'Cubic.out',
      onComplete: () => muzzle.destroy(),
    });

    const dist = Math.hypot(x1 - x0, y1 - y0);
    const travelMs = Phaser.Math.Clamp(dist * 0.55, 120, 280);
    const p = { x: x0, y: y0 };
    this.scene.tweens.add({
      targets: p,
      x: x1,
      y: y1,
      duration: travelMs,
      ease: 'Quad.out',
      onUpdate: () => {
        this.blastDots.emitParticleAt(p.x, p.y, 4);
        if (Math.random() < 0.55) this.blastSparks.emitParticleAt(p.x, p.y, 2);
        if (Math.random() < 0.2) this.rings.emitParticleAt(p.x, p.y, 1);
      },
      onComplete: () => this.impactBurst(x1, y1),
    });
  }

  /** Held / re-aimable beam from muzzle → aim point. */
  channel(mx: number, my: number, ax: number, ay: number): void {
    this.channelState = { mx, my, ax, ay };
  }

  stopChannel(): void {
    this.channelState = null;
  }

  // ---- internals ------------------------------------------------------------

  private impactBurst(x: number, y: number): void {
    for (let i = 0; i < 14; i++) {
      this.dots.emitParticleAt(
        x + (Math.random() - 0.5) * 18,
        y + (Math.random() - 0.5) * 18,
        1,
      );
    }
    for (let i = 0; i < 8; i++) {
      this.sparks.emitParticleAt(x, y, 1);
    }
    this.rings.emitParticleAt(x, y, 2);
  }

  private onUpdate(_: number, deltaMs: number): void {
    if (this.channelState) {
      this.emitChannel(deltaMs);
    }
    if (!this.ringOn) return;
    this.t += (deltaMs / 1000) * this.opts.spin;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = this.t + (i / n) * 0.5 + Math.random() * 0.15;
      const x = this.ringPos.x + Math.cos(a) * this.opts.radiusX;
      const y = this.ringPos.y + Math.sin(a) * this.opts.radiusY;
      this.dots.emitParticleAt(x, y, 1);
      if (Math.random() < 0.1) this.rings.emitParticleAt(x, y, 1);
      if (Math.random() < 0.3) this.sparks.emitParticleAt(x, y, 1);
    }
  }

  private emitChannel(_deltaMs: number): void {
    const c = this.channelState;
    if (!c) return;
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Phaser.Math.Linear(c.mx, c.ax, t) + (Math.random() - 0.5) * 6;
      const y = Phaser.Math.Linear(c.my, c.ay, t) + (Math.random() - 0.5) * 6;
      this.dots.emitParticleAt(x, y, 1);
      if (i === 0 || i === steps || Math.random() < 0.35) {
        this.sparks.emitParticleAt(x, y, 1);
      }
    }
  }

  private buildEmitters(): void {
    const s = this.scene;
    const shared = {
      blendMode: Phaser.BlendModes.ADD as const,
      alpha: { start: 1, end: 0 },
      emitting: false,
    };

    this.dots = s.add.particles(0, 0, DOT, {
      ...shared,
      lifespan: 750,
      scale: { start: 0.55, end: 0 },
      speed: { min: 0, max: 40 },
      angle: { min: 0, max: 360 },
      tint: PALETTE,
    });
    this.rings = s.add.particles(0, 0, RING, {
      ...shared,
      lifespan: 750,
      scale: { start: 0.2, end: 0.9 },
      alpha: { start: 0.9, end: 0 },
      speed: { min: 0, max: 12 },
      angle: { min: 0, max: 360 },
      tint: [0xff3a3a, 0xff8a7a, 0xffffff],
    });
    this.sparks = s.add.particles(0, 0, DOT, {
      ...shared,
      lifespan: 350,
      scale: { start: 0.14, end: 0 },
      speed: { min: 20, max: 90 },
      angle: { min: 0, max: 360 },
      tint: 0xffffff,
    });

    // Directed cone — angle is an op (function), NOT emitter GameObject rotation.
    const aimAngle = (): number => {
      const half = this.blastSpreadDeg * 0.5;
      return this.aimDeg + (Math.random() * 2 - 1) * half;
    };

    this.blastDots = s.add.particles(0, 0, DOT, {
      ...shared,
      lifespan: { min: 180, max: 320 },
      scale: { start: 0.5, end: 0 },
      speed: { min: 220, max: 420 },
      angle: aimAngle,
      tint: PALETTE,
    });
    this.blastSparks = s.add.particles(0, 0, DOT, {
      ...shared,
      lifespan: { min: 120, max: 240 },
      scale: { start: 0.18, end: 0 },
      speed: { min: 280, max: 520 },
      angle: aimAngle,
      tint: [0xffb3a0, 0xffffff],
    });

    [
      this.dots,
      this.rings,
      this.sparks,
      this.blastDots,
      this.blastSparks,
    ].forEach((e) => e.setDepth(9000));
  }

  private lightCamera(): void {
    const cam = this.scene.cameras.main;
    this.bloomFx = cam.postFX.addBloom(0xffffff, 1, 1, 1.4, 1.1, 6);
    this.vigFx = cam.postFX.addVignette(0.5, 0.5, 0.85, 0.35);
  }

  private destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    this.channelState = null;
    this.dots?.destroy();
    this.rings?.destroy();
    this.sparks?.destroy();
    this.blastDots?.destroy();
    this.blastSparks?.destroy();
  }

  /** textures are painted once per Scene as canvas radial gradients */
  private static ensureTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists(DOT)) {
      const s = 64;
      const tex = scene.textures.createCanvas(DOT, s, s)!;
      const ctx = tex.getContext();
      const r = s / 2;
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      tex.refresh();
    }
    if (!scene.textures.exists(RING)) {
      const s = 64;
      const w = 6;
      const tex = scene.textures.createCanvas(RING, s, s)!;
      const ctx = tex.getContext();
      const r = s / 2;
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(255,255,255,1)';
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.shadowBlur = w * 1.5;
      ctx.beginPath();
      ctx.arc(r, r, r - w, 0, Math.PI * 2);
      ctx.stroke();
      tex.refresh();
    }
  }
}
