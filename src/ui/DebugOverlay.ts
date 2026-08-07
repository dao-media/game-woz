import Phaser from 'phaser';
import type { ForkBranch } from '../data/branches';
import type { Player } from '../entities/Player';
import { Projection } from '../core/Projection';

export class DebugOverlay {
  private readonly text: Phaser.GameObjects.Text;
  private visible = false;

  constructor(scene: Phaser.Scene) {
    this.text = scene.add
      .text(12, 12, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#a0ffa0',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(100000)
      .setVisible(false);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.text.setVisible(this.visible);
  }

  update(
    player: Player,
    branch: ForkBranch | null | undefined,
    selectedCharacter: string | null | undefined,
  ): void {
    if (!this.visible) return;
    this.text.setText(
      [
        `floorX  ${player.floorX.toFixed(1)}  floorY  ${player.floorY.toFixed(1)}`,
        `depth01  ${player.depth01.toFixed(3)}  depthScale  ${Projection.depthScale(player.floorY).toFixed(3)}`,
        `z  ${player.z.toFixed(1)}`,
        `fsm  ${player.state}  combo  ${player.comboIndex}`,
        `hp  ${player.health.currentHP.toFixed(1)} / ${player.health.maxHP}  lastHit  ${player.lastHitDamage}`,
        `heavyCd  ${(player.heavyCooldownRemainMs / 1000).toFixed(2)}s  ultCd  ${(player.ultimateCooldownRemainMs / 1000).toFixed(2)}s`,
        `ultCharge  ${player.ultimateCharge.toFixed(2)}  ultTargets  ${player.ultimateTargetsAcquired}`,
        `character  ${selectedCharacter ?? player.characterId}`,
        `path  ${branch?.id ?? '(none)'} — ${branch?.label ?? ''}`,
      ].join('\n'),
    );
  }
}
