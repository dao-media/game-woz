import Phaser from 'phaser';
import type { ForkBranch } from '../data/branches';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import type { EncounterManager } from '../combat/EncounterManager';
import { Projection } from '../core/Projection';
import { tuning } from '../config/tuning';
import type { DifficultyId } from '../ai/DifficultyParams';

export type DebugCombatContext = {
  difficulty: DifficultyId;
  enemies: Enemy[];
  encounter: EncounterManager;
};

export type DebugFenceContext = {
  tileCount: number;
  nearFloorY: number;
  farFloorY: number;
};

export type DebugYbrContext = {
  segments: number;
  tileCount: number;
  roadLength: number;
};

export type DebugUpdateExtras = {
  combat?: DebugCombatContext;
  fence?: DebugFenceContext;
  ybr?: DebugYbrContext;
  /** Slipper glow feet anchor(s) (F3 debug). */
  slipperFeet?: { x: number; y: number } | null;
  slipperFeetFront?: { x: number; y: number } | null;
  slipperFeetBack?: { x: number; y: number } | null;
  /** Player measured feet (F3 debug). */
  playerFeet?: { x: number; y: number } | null;
  playerFeetFront?: { x: number; y: number } | null;
  playerFeetBack?: { x: number; y: number } | null;
  sparkleFx?: Record<string, unknown> | null;
  groundBurstFx?: Record<string, unknown> | null;
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

  isVisible(): boolean {
    return this.visible;
  }

  update(
    player: Player,
    branch: ForkBranch | null | undefined,
    selectedCharacter: string | null | undefined,
    extras?: DebugUpdateExtras,
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
      `fsm  ${player.state}  comboKick  ${player.comboIndex + 1}  markers  ${player.comboMarkersLit}/3`,
      `comboWin  ${player.comboWindowActive ? `open→${player.comboWindowTarget}` : 'closed'}`,
      `hp  ${player.health.currentHP.toFixed(1)} / ${player.health.maxHP}  lastHit  ${player.lastHitDamage}`,
      `heavyCd  ${(player.heavyCooldownRemainMs / 1000).toFixed(2)}s  ultCd  ${(player.ultimateCooldownRemainMs / 1000).toFixed(2)}s`,
      `ultCharge  ${(player.ultimateCharge * 100).toFixed(1)}%  lastCharge+  ${(player.lastUltimateChargeAdded * 100).toFixed(2)}%`,
      `character  ${selectedCharacter ?? player.characterId}`,
      `path  ${branch?.id ?? '(none)'} — ${branch?.label ?? ''}`,
    );

    if (extras?.combat) {
      const enc = extras.combat.encounter;
      lines.push(
        `difficulty  ${extras.combat.difficulty}`,
        `enemies  ${extras.combat.enemies.length}  encounter  ${enc.phase}  wave  ${enc.waveIndex}  locked  ${enc.arenaLocked}`,
        `activeEnc  ${enc.activeEncounterId ?? '(none)'}`,
      );
      for (const e of extras.combat.enemies.slice(0, 4)) {
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

    if (extras?.fence) {
      lines.push(
        `fence  tiles ${extras.fence.tileCount}  nearY ${extras.fence.nearFloorY}  farY ${extras.fence.farFloorY}`,
      );
    }

    if (extras?.ybr) {
      lines.push(
        `ybr  ${extras.ybr.segments} seg  tiles ${extras.ybr.tileCount}  length ${extras.ybr.roadLength.toFixed(0)}`,
      );
    }

    if (extras?.sparkleFx) {
      const s = extras.sparkleFx;
      lines.push(
        `glow  mode=${String(s.mode ?? '?')}  ready=${s.pipelineReady ? 'ok' : 'OFF'}  active=${s.active}  fade=${Number(s.fadeT).toFixed(2)}  vis=${s.frontVisible}  ${Number(s.frontW).toFixed(0)}×${Number(s.frontH).toFixed(0)}`,
      );
      const pipe = s.pipeline as
        | { mode?: string; colorRgb?: number[]; programLinked?: boolean }
        | null
        | undefined;
      if (pipe) {
        const rgb = pipe.colorRgb;
        const rgbStr = Array.isArray(rgb)
          ? rgb.map((v) => Number(v).toFixed(2)).join(',')
          : '?';
        lines.push(
          `sparkle  mode=${pipe.mode ?? '?'}  rgb=${rgbStr}  linked=${pipe.programLinked ? 'y' : 'n'}`,
        );
      }
      if (s.pipeline) {
        const p = s.pipeline as { programLinked: boolean; hasSpriteTexture: boolean };
        lines.push(
          `  glsl linked=${p.programLinked}  spriteTex=${p.hasSpriteTexture}`,
        );
      }
    } else {
      lines.push('sparkle  (slipperAura null — check [Game] disabled log)');
    }

    if (extras?.groundBurstFx) {
      const g = extras.groundBurstFx;
      lines.push(
        `burst  anim=${g.animReady ? 'ok' : 'OFF'}  sprite=${g.hasSprite}  playing=${g.playing}  vis=${g.visible}  αbot=${Number(g.alphaBottomRatio ?? 0).toFixed(3)}`,
      );
      lines.push(
        `burstF  vis=${g.frontVisible}  mask=${g.frontMasked ? 'on' : 'off'}  α=${Number(g.frontOpacity ?? 0).toFixed(2)}`,
      );
    } else {
      lines.push('burst  (groundBurst null — check [Game] disabled log)');
    }

    if (tuning.debugForceUltimate) {
      lines.push('debug  P = force ult charge + replay VFX (no F3 needed)');
    }

    this.text.setText(lines.join('\n'));

    this.feetLine.clear();
    const refY = this.idleRef?.feetScreenY ?? feetScreenY;
    const cam = this.text.scene.cameras.main;
    const x0 = cam.worldView.left;
    const x1 = cam.worldView.right;
    this.feetLine.lineStyle(1, 0xa0ffa0, 0.55);
    this.feetLine.lineBetween(x0, refY, x1, refY);

    if (extras?.playerFeet) {
      const { x, y } = extras.playerFeet;
      this.feetLine.lineStyle(2, 0x40ff60, 0.9);
      this.feetLine.strokeCircle(x, y, 5);
      this.feetLine.fillStyle(0x40ff60, 0.35);
      this.feetLine.fillCircle(x, y, 5);
    }

    if (extras?.playerFeetFront) {
      const { x, y } = extras.playerFeetFront;
      this.feetLine.lineStyle(2, 0x80ff90, 0.85);
      this.feetLine.strokeCircle(x, y, 4);
    }

    if (extras?.playerFeetBack) {
      const { x, y } = extras.playerFeetBack;
      this.feetLine.lineStyle(2, 0x30cc50, 0.7);
      this.feetLine.strokeCircle(x, y, 3);
    }

    if (extras?.slipperFeet) {
      const { x, y } = extras.slipperFeet;
      this.feetLine.lineStyle(2, 0xff4040, 0.9);
      this.feetLine.strokeCircle(x, y, 4);
      this.feetLine.fillStyle(0xff4040, 0.35);
      this.feetLine.fillCircle(x, y, 4);
    }

    if (extras?.slipperFeetFront) {
      const { x, y } = extras.slipperFeetFront;
      this.feetLine.lineStyle(2, 0xff8080, 0.85);
      this.feetLine.strokeCircle(x, y, 3);
    }

    if (extras?.slipperFeetBack) {
      const { x, y } = extras.slipperFeetBack;
      this.feetLine.lineStyle(2, 0xcc3030, 0.7);
      this.feetLine.strokeCircle(x, y, 3);
    }
  }
}
