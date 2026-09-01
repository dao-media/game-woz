import Phaser from 'phaser';
import { Projection } from '../core/Projection';
import { applyDepth } from '../core/DepthSort';
import { tuning } from '../config/tuning';
import type { Player } from '../entities/Player';

/**
 * HP + ultimate charge bars floating above the player (world-anchored UI).
 */
export class OverheadPlayerBars {
  private readonly root: Phaser.GameObjects.Container;
  private readonly hpBg: Phaser.GameObjects.Rectangle;
  private readonly hpFill: Phaser.GameObjects.Rectangle;
  private readonly ultBg: Phaser.GameObjects.Rectangle;
  private readonly ultFill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    const w = tuning.overheadBarWidth;
    const h = tuning.overheadBarHeight;
    const gap = tuning.overheadBarGap;

    this.hpBg = scene.add.rectangle(0, 0, w, h, tuning.colors.hpBarBg, 0.92);
    this.hpBg.setStrokeStyle(1, 0x5a5a68, 0.85);
    this.hpFill = scene.add.rectangle(-w / 2, 0, w, h, tuning.colors.hpBarFill);
    this.hpFill.setOrigin(0, 0.5);

    this.ultBg = scene.add.rectangle(0, gap + h, w, h, tuning.colors.hpBarBg, 0.92);
    this.ultBg.setStrokeStyle(1, 0x5a5a68, 0.85);
    this.ultFill = scene.add
      .rectangle(-w / 2, gap + h, w, h, tuning.colors.ultimateCharge)
      .setOrigin(0, 0.5);

    this.root = scene.add.container(0, 0, [this.hpBg, this.hpFill, this.ultBg, this.ultFill]);
    this.root.setScrollFactor(1);
  }

  update(player: Player): void {
    this.root.setVisible(!player.health.isDead);
    if (player.health.isDead) return;

    const screen = Projection.toScreen(player.floorX, player.floorY, player.z);
    const depthScale = Projection.entityDepthScale(
      player.floorY,
      tuning.overheadBarDepthScaleStrength,
    );
    const entityScale = Projection.entityDepthScale(
      player.floorY,
      tuning.playerDepthScaleStrength,
    );

    const spriteH = player.visual?.displayHeight ?? tuning.playerBodyHeight * entityScale;
    const headY = (player.visual?.y ?? player.body.y) - spriteH * 0.88;
    const barScale = depthScale;
    const w = tuning.overheadBarWidth * barScale;
    const h = tuning.overheadBarHeight * barScale;
    const gap = tuning.overheadBarGap * barScale;

    this.root.setPosition(screen.x, headY + tuning.overheadBarOffsetY * entityScale);
    applyDepth(this.root, player.floorY, 3);

    this.hpBg.setSize(w, h).setPosition(0, 0);
    this.ultBg.setSize(w, h).setPosition(0, gap + h);

    const hpRatio = Phaser.Math.Clamp(player.health.ratio, 0, 1);
    this.hpFill.width = w * hpRatio;
    this.hpFill.height = h;
    this.hpFill.setPosition(-w / 2, 0);
    this.hpFill.fillColor =
      hpRatio <= 0.3 ? tuning.colors.hpBarLow : tuning.colors.hpBarFill;

    const ultReady =
      player.ultimateCooldownRemainMs <= 0 && player.ultimateCharge >= 1;
    const ultRatio = Phaser.Math.Clamp(player.ultimateCharge, 0, 1);
    this.ultFill.width = w * ultRatio;
    this.ultFill.height = h;
    this.ultFill.setPosition(-w / 2, gap + h);
    this.ultFill.fillColor = ultReady
      ? tuning.colors.ultimateCharge
      : tuning.colors.cooldownBusy;
    this.ultFill.setAlpha(player.ultimateCooldownRemainMs > 0 ? 0.65 : 1);
  }

  destroy(): void {
    this.root.destroy();
  }
}
