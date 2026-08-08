import Phaser from 'phaser';
import type { ForkBranch } from '../data/branches';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import type { EncounterManager } from '../combat/EncounterManager';
import { Projection } from '../core/Projection';
import type { DifficultyId } from '../ai/DifficultyParams';

export type DebugCombatContext = {
  difficulty: DifficultyId;
  enemies: Enemy[];
  encounter: EncounterManager;
};

export class DebugOverlay {
  private readonly text: Phaser.GameObjects.Text;
  private visible = false;

  constructor(scene: Phaser.Scene) {
    this.text = scene.add
      .text(12, 12, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
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
    combat?: DebugCombatContext,
  ): void {
    if (!this.visible) return;

    const lines = [
      `floorX  ${player.floorX.toFixed(1)}  floorY  ${player.floorY.toFixed(1)}`,
      `depth01  ${player.depth01.toFixed(3)}  depthScale  ${Projection.depthScale(player.floorY).toFixed(3)}`,
      `z  ${player.z.toFixed(1)}`,
      `fsm  ${player.state}  combo  ${player.comboIndex}  recovery  ${player.isInAttackRecovery ? 'Y' : 'n'}`,
      `hp  ${player.health.currentHP.toFixed(1)} / ${player.health.maxHP}  lastHit  ${player.lastHitDamage}`,
      `heavyCd  ${(player.heavyCooldownRemainMs / 1000).toFixed(2)}s  ultCd  ${(player.ultimateCooldownRemainMs / 1000).toFixed(2)}s`,
      `character  ${selectedCharacter ?? player.characterId}`,
      `path  ${branch?.id ?? '(none)'} — ${branch?.label ?? ''}`,
    ];

    if (combat) {
      const enc = combat.encounter;
      lines.push(
        `difficulty  ${combat.difficulty}`,
        `enemies  ${combat.enemies.length}  encounter  ${enc.phase}  wave  ${enc.waveIndex}  locked  ${enc.arenaLocked}`,
        `activeEnc  ${enc.activeEncounterId ?? '(none)'}`,
      );
      for (const e of combat.enemies.slice(0, 4)) {
        const top = e.lastScores
          .slice(0, 3)
          .map((s) => `${s.id}:${s.score.toFixed(2)}`)
          .join(' ');
        lines.push(
          `  [${e.enemyId}] intent=${e.lastChosen} exec=${e.lastExecutorState} z=${e.z.toFixed(0)}`,
          `    ${top}`,
        );
      }
    }

    this.text.setText(lines.join('\n'));
  }
}
