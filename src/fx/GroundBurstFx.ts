import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';
import type { Player } from '../entities/Player';
import { getMeasuredFeetScreen } from '../entities/dorothyFeet';
import groundBurstCacheJson from '../data/groundBurstCache.json';
import {
  ensureGroundBurstAnim,
  GROUND_BURST_ANIM,
  GROUND_BURST_TEXTURE,
} from './groundBurstAssets';

/**
 * Measured alpha-bottom within the 256×144 frame (scripts/measure_ground_burst.py).
 * Prefer cache; fall back to tuning if the JSON is missing/stale.
 */
const BURST_ALPHA_BOTTOM = Phaser.Math.Clamp(
  (groundBurstCacheJson as { burstAlphaBottomRatio?: number }).burstAlphaBottomRatio ??
    tuning.groundBurstAlphaBottomRatio,
  0.05,
  1,
);

/**
 * One-shot red ground burst when ultimate charge crosses to full.
 *
 * Sandwich: full-opacity back copy behind Dorothy + dimmed front copy in front,
 * alpha-masked to her live sprite silhouette so energy only shows over her body.
 */
export class GroundBurstFx {
  /** Full burst behind the player (existing layer). */
  private readonly back: Phaser.GameObjects.Sprite | null;
  /** Dimmed overlay in front, clipped to Dorothy's sprite alpha. */
  private readonly front: Phaser.GameObjects.Sprite | null;
  private readonly animReady: boolean;
  private prevCharge = 0;
  private playing = false;
  private dorothyMask: Phaser.Display.Masks.BitmapMask | null = null;
  private maskSource: Phaser.GameObjects.Sprite | null = null;
  /** Fires when charge crosses to full and burst starts. */
  onChargeFull: (() => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.animReady = ensureGroundBurstAnim(scene);

    if (!this.animReady || !scene.textures.exists(GROUND_BURST_TEXTURE)) {
      this.back = null;
      this.front = null;
      return;
    }

    this.back = this.makeBurstSprite(scene);
    this.front = this.makeBurstSprite(scene);
    this.front.setAlpha(tuning.burstFrontOpacity);
  }

  private makeBurstSprite(scene: Phaser.Scene): Phaser.GameObjects.Sprite {
    return scene.add
      .sprite(0, 0, GROUND_BURST_TEXTURE, 0)
      // Origin at measured opaque base (~0.80), not frame bottom (1.0).
      .setOrigin(0.5, BURST_ALPHA_BOTTOM)
      .setScrollFactor(1)
      .setBlendMode(tuning.groundBurstBlendMode)
      .setVisible(false);
  }

  update(player: Player): void {
    if (!this.back || !this.animReady) return;

    const charge = player.ultimateCharge;
    const crossedFull =
      tuning.groundBurstOneShot &&
      this.prevCharge < 1 &&
      charge >= 1;
    this.prevCharge = charge;

    if (crossedFull && !this.playing) {
      this.playAtFeet(player);
    }

    if (this.playing) {
      this.syncToFeet(player);
    }
  }

  resetChargeTracking(charge = 0): void {
    this.prevCharge = charge;
  }

  /** Debug / force: replay charge-full burst + sparkle fade (same path as real cross). */
  replayChargeFull(player: Player): void {
    if (!this.back || !this.animReady) return;
    this.prevCharge = 0;
    this.playAtFeet(player);
  }

  getDebugState(): {
    animReady: boolean;
    hasSprite: boolean;
    playing: boolean;
    visible: boolean;
    alphaBottomRatio: number;
    frontVisible: boolean;
    frontMasked: boolean;
    frontOpacity: number;
  } {
    return {
      animReady: this.animReady,
      hasSprite: this.back != null,
      playing: this.playing,
      visible: this.back?.visible ?? false,
      alphaBottomRatio: BURST_ALPHA_BOTTOM,
      frontVisible: this.front?.visible ?? false,
      frontMasked: this.dorothyMask != null && tuning.burstFrontMask,
      frontOpacity: tuning.burstFrontOpacity,
    };
  }

  private playAtFeet(player: Player): void {
    if (!this.back) return;
    const vis = player.visual;
    if (!vis) return;

    this.back.removeAllListeners(Phaser.Animations.Events.ANIMATION_COMPLETE);
    this.back.stop();
    this.front?.stop();

    this.playing = true;
    this.back.setVisible(true);
    if (this.front) {
      this.front.setVisible(true);
      this.front.setAlpha(tuning.burstFrontOpacity);
    }
    this.syncToFeet(player);

    this.onChargeFull?.();

    // Back owns the anim clock; front mirrors its frame each sync (lockstep).
    this.back.play(GROUND_BURST_ANIM);
    this.back.anims.timeScale = tuning.groundBurstTimeScale;
    this.back.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.stopBurst();
    });
  }

  private stopBurst(): void {
    this.back?.setVisible(false);
    this.back?.stop();
    this.front?.setVisible(false);
    this.front?.stop();
    this.playing = false;
  }

  private syncToFeet(player: Player): void {
    if (!this.back) return;
    const vis = player.visual;
    if (!vis) return;

    const feet = getMeasuredFeetScreen(vis);
    const entityScale = Projection.entityDepthScale(
      player.floorY,
      tuning.playerDepthScaleStrength,
    );
    const displayH = tuning.groundBurstDisplayHeight * entityScale;
    const scale =
      (displayH / tuning.groundBurstFrameHeight) * tuning.groundBurstScale;

    const feetY = feet.y + tuning.groundBurstAnchorOffsetY;

    this.back.setPosition(feet.x, feetY);
    this.back.setScale(scale);
    this.back.setBlendMode(tuning.groundBurstBlendMode);

    applyDepth(this.back, player.floorY, tuning.groundBurstDepthTieBreak);
    this.back.setDepth(
      Math.min(this.back.depth, vis.depth - tuning.groundBurstDepthBehind),
    );

    if (this.front) {
      this.front.setPosition(feet.x, feetY);
      this.front.setScale(scale);
      this.front.setAlpha(tuning.burstFrontOpacity);
      this.front.setBlendMode(tuning.groundBurstBlendMode);

      // Lockstep: same texture frame as the back copy.
      if (this.back.frame) {
        this.front.setFrame(this.back.frame.name);
      }

      applyDepth(this.front, player.floorY, tuning.groundBurstDepthTieBreak);
      this.front.setDepth(vis.depth + tuning.burstFrontDepthAhead);

      this.applyDorothyMask(vis);
    }
  }

  /**
   * Bitmap-mask the front burst to Dorothy's live sprite alpha (per-frame
   * silhouette — not a bounding box). Toggle via tuning.burstFrontMask.
   */
  private applyDorothyMask(vis: Phaser.GameObjects.Sprite): void {
    if (!this.front) return;

    if (!tuning.burstFrontMask) {
      this.clearDorothyMask();
      return;
    }

    if (this.maskSource === vis && this.dorothyMask) {
      this.front.setMask(this.dorothyMask);
      return;
    }

    this.clearDorothyMask();
    // Phaser renders `vis` into the mask buffer each frame → true sprite alpha.
    this.dorothyMask = this.front.createBitmapMask(vis);
    this.maskSource = vis;
    this.front.setMask(this.dorothyMask);
  }

  private clearDorothyMask(): void {
    this.front?.clearMask(true);
    this.dorothyMask = null;
    this.maskSource = null;
  }
}
