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

type IdleGroundTruth = {
  feetScreenY: number;
  bodyHeight: number;
};

/**
 * F3 overlay. When visible, auto-captures idle (z≈0) as scale/feet ground truth
 * and shows Δheight / Δfeet for other clips. Optional feet reference line.
 */
export class DebugOverlay {
  private readonly text: Phaser.GameObjects.Text;
  private readonly feetLine: Phaser.GameObjects.Graphics;
  private visible = false;
  private idleRef: IdleGroundTruth | null = null;

  constructor(scene: Phaser.Scene) {
    this.text = scene.add
      .text(12, 12, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#a0ffa0',
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(100000)
      .setVisible(false);

    this.feetLine = scene.add
      .graphics()
      .setScrollFactor(1)
      .setDepth(99999)
      .setVisible(false);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.text.setVisible(this.visible);
    this.feetLine.setVisible(this.visible);
    if (!this.visible) {
      this.feetLine.clear();
      return;
    }
    // Immediate feedback so an empty first frame doesn't look like a dead toggle.
    if (!this.text.text) this.text.setText('debug…');
  }

  update(
    player: Player,
    branch: ForkBranch | null | undefined,
    selectedCharacter: string | null | undefined,
    combat?: DebugCombatContext,
  ): void {
    if (!this.visible) return;

    const animName = player.visual?.anims.currentAnim?.key ?? '(none)';
    const bodyHeight = player.visual?.displayHeight ?? player.body.displayHeight;
    const feetScreenY = player.visual?.y ?? player.body.y;

    const groundedIdle = player.state === 'idle' && player.z < 0.5;
    if (groundedIdle) {
      this.idleRef = { feetScreenY, bodyHeight };
    }

    const entityScale = player.entityVisualScale;
    const depthOnly = Projection.entityDepthScale(
      player.floorY,
      // strength applied inside entityVisualScale; show raw depth factor too
      1,
    );
    const lines = [
      `floorX  ${player.floorX.toFixed(1)}  floorY  ${player.floorY.toFixed(1)}  z  ${player.z.toFixed(1)}`,
      `entityScale  ${entityScale.toFixed(4)}  depthScale  ${depthOnly.toFixed(4)}  (scale = f(floorY) only)`,
      `jumpScaleDrift  ${player.jumpScaleDrift.toFixed(4)}  floorYDrift  ${player.jumpFloorYDrift.toFixed(2)}`,
      `  (leak only if scale drifts while floorYDrift≈0)`,
      `anim  ${animName}`,
      `spriteH  ${bodyHeight.toFixed(1)}px  feetY  ${feetScreenY.toFixed(1)}`,
    ];

    if (this.idleRef) {
      const dH = bodyHeight - this.idleRef.bodyHeight;
      const dF = feetScreenY - this.idleRef.feetScreenY;
      lines.push(
        `idleRef  H=${this.idleRef.bodyHeight.toFixed(1)}  feetY=${this.idleRef.feetScreenY.toFixed(1)}`,
        `Δheight  ${dH >= 0 ? '+' : ''}${dH.toFixed(1)}  Δfeet  ${dF >= 0 ? '+' : ''}${dF.toFixed(1)}`,
      );
    } else {
      lines.push(`idleRef  (stand idle to capture)`);
    }

    lines.push(
      `fsm  ${player.state}  combo  ${player.comboIndex}  recovery  ${player.isInAttackRecovery ? 'Y' : 'n'}`,
      `hp  ${player.health.currentHP.toFixed(1)} / ${player.health.maxHP}  lastHit  ${player.lastHitDamage}`,
      `heavyCd  ${(player.heavyCooldownRemainMs / 1000).toFixed(2)}s  ultCd  ${(player.ultimateCooldownRemainMs / 1000).toFixed(2)}s`,
      `character  ${selectedCharacter ?? player.characterId}`,
      `path  ${branch?.id ?? '(none)'} — ${branch?.label ?? ''}`,
    );

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

    this.feetLine.clear();
    const refY = this.idleRef?.feetScreenY ?? feetScreenY;
    const cam = this.text.scene.cameras.main;
    const x0 = cam.worldView.left;
    const x1 = cam.worldView.right;
    this.feetLine.lineStyle(1, 0xa0ffa0, 0.55);
    this.feetLine.lineBetween(x0, refY, x1, refY);
  }
}
