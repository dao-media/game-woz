import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import type { Player } from '../entities/Player';

/**
 * Corner combat HUD — heavy (laser) cooldown only.
 * Player HP + ultimate charge live on OverheadPlayerBars.
 */
export class CombatHUD {
  private readonly root: Phaser.GameObjects.Container;
  private readonly heavySlot: Phaser.GameObjects.Rectangle;
  private readonly heavyFill: Phaser.GameObjects.Rectangle;
  private readonly heavyLabel: Phaser.GameObjects.Text;

  private readonly slotSize = 28;

  constructor(scene: Phaser.Scene) {
    const slotY = 0;
    this.heavySlot = scene.add.rectangle(0, slotY, this.slotSize, this.slotSize, tuning.colors.hpBarBg, 0.9);
    this.heavySlot.setStrokeStyle(1, 0x5a5a68, 0.9);
    this.heavyFill = scene.add
      .rectangle(0, slotY + this.slotSize / 2, this.slotSize - 4, this.slotSize - 4, tuning.colors.cooldownReady, 0.85)
      .setOrigin(0.5, 1);
    this.heavyLabel = scene.add
      .text(0, slotY + 20, 'L', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#c4c4d0',
      })
      .setOrigin(0.5, 0);

    this.root = scene.add.container(16, 28, [
      this.heavySlot,
      this.heavyFill,
      this.heavyLabel,
    ]);
    this.root.setScrollFactor(0).setDepth(90_000);
  }

  update(player: Player): void {
    const heavyReady = player.heavyCooldownRemainMs <= 0;
    const heavyRatio = heavyReady
      ? 1
      : 1 - player.heavyCooldownRemainMs / tuning.heavyCooldownMs;
    this.heavyFill.displayHeight = Math.max(2, (this.slotSize - 4) * Phaser.Math.Clamp(heavyRatio, 0, 1));
    this.heavyFill.fillColor = heavyReady
      ? tuning.colors.cooldownReady
      : tuning.colors.cooldownBusy;
    this.heavyLabel.setText(
      heavyReady ? 'L' : `${Math.ceil(player.heavyCooldownRemainMs / 1000)}`,
    );
  }

  destroy(): void {
    this.root.destroy();
  }
}
