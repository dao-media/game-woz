import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import type { Health } from '../combat/Health';
import type { Player } from '../entities/Player';

/**
 * Combat HUD — HP bar + heavy cooldown + ultimate cooldown/charge.
 */
export class CombatHUD {
  private readonly root: Phaser.GameObjects.Container;
  private readonly barBg: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;

  private readonly heavySlot: Phaser.GameObjects.Rectangle;
  private readonly heavyFill: Phaser.GameObjects.Rectangle;
  private readonly heavyLabel: Phaser.GameObjects.Text;

  private readonly ultSlot: Phaser.GameObjects.Rectangle;
  private readonly ultFill: Phaser.GameObjects.Rectangle;
  private readonly ultLabel: Phaser.GameObjects.Text;

  private readonly barWidth = 180;
  private readonly barHeight = 12;
  private readonly slotSize = 28;

  constructor(scene: Phaser.Scene) {
    this.barBg = scene.add.rectangle(0, 0, this.barWidth, this.barHeight, tuning.colors.hpBarBg);
    this.barBg.setOrigin(0, 0.5);
    this.barFill = scene.add.rectangle(0, 0, this.barWidth, this.barHeight, tuning.colors.hpBarFill);
    this.barFill.setOrigin(0, 0.5);

    this.label = scene.add
      .text(0, -18, 'HP', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#c4c4d0',
      })
      .setOrigin(0, 1);

    const slotY = 26;
    this.heavySlot = scene.add.rectangle(0, slotY, this.slotSize, this.slotSize, tuning.colors.hpBarBg, 0.9);
    this.heavySlot.setStrokeStyle(1, 0x5a5a68, 0.9);
    this.heavyFill = scene.add
      .rectangle(0, slotY + this.slotSize / 2, this.slotSize - 4, this.slotSize - 4, tuning.colors.cooldownReady, 0.85)
      .setOrigin(0.5, 1);
    this.heavyLabel = scene.add
      .text(0, slotY + 20, 'H', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#c4c4d0',
      })
      .setOrigin(0.5, 0);

    this.ultSlot = scene.add.rectangle(36, slotY, this.slotSize, this.slotSize, tuning.colors.hpBarBg, 0.9);
    this.ultSlot.setStrokeStyle(1, 0x5a5a68, 0.9);
    this.ultFill = scene.add
      .rectangle(36, slotY + this.slotSize / 2, this.slotSize - 4, this.slotSize - 4, tuning.colors.ultimateCharge, 0.85)
      .setOrigin(0.5, 1);
    this.ultLabel = scene.add
      .text(36, slotY + 20, 'U', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#c4c4d0',
      })
      .setOrigin(0.5, 0);

    this.root = scene.add.container(16, 28, [
      this.barBg,
      this.barFill,
      this.label,
      this.heavySlot,
      this.heavyFill,
      this.heavyLabel,
      this.ultSlot,
      this.ultFill,
      this.ultLabel,
    ]);
    this.root.setScrollFactor(0).setDepth(90_000);
  }

  update(player: Player): void {
    this.updateHealth(player.health);

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

    const ultCdRatio =
      player.ultimateCooldownRemainMs <= 0
        ? 1
        : 1 - player.ultimateCooldownRemainMs / tuning.ultimateCooldownMs;
    // Charge meter seam: show max(charge, cooldown refill progress) so CD gate is visible now.
    const ultDisplay = Math.max(player.ultimateCharge, ultCdRatio);
    const ultReady = player.ultimateCooldownRemainMs <= 0 && player.ultimateCharge >= 1;
    this.ultFill.displayHeight = Math.max(2, (this.slotSize - 4) * Phaser.Math.Clamp(ultDisplay, 0, 1));
    this.ultFill.fillColor = ultReady
      ? tuning.colors.ultimateCharge
      : tuning.colors.cooldownBusy;
    this.ultLabel.setText(
      ultReady ? 'U' : `${Math.ceil(player.ultimateCooldownRemainMs / 1000)}`,
    );
  }

  private updateHealth(health: Health): void {
    const ratio = Phaser.Math.Clamp(health.ratio, 0, 1);
    this.barFill.width = this.barWidth * ratio;
    this.barFill.fillColor =
      ratio <= 0.3 ? tuning.colors.hpBarLow : tuning.colors.hpBarFill;
    this.label.setText(`HP  ${Math.ceil(health.currentHP)} / ${health.maxHP}`);
  }

  destroy(): void {
    this.root.destroy();
  }
}
