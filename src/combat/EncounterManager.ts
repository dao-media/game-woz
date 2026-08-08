import type Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { createEnemy } from '../entities/createEnemy';
import type { Enemy } from '../entities/Enemy';
import type { EncounterDef, EncounterSpawn } from '../data/encounters';
import type { DifficultyParams } from '../ai/DifficultyParams';
import type { EnemyId } from '../data/enemies';

export type EncounterPhase = 'idle' | 'active' | 'cleared';

type PendingSpawn = {
  enemyId: EnemyId;
  floorX: number;
  floorY: number;
  atMs: number;
};

/**
 * Triggered waves + optional arena lock along the road.
 * Phase B director will sit alongside this.
 */
export class EncounterManager {
  phase: EncounterPhase = 'idle';
  activeEncounterId: string | null = null;
  waveIndex = 0;
  arenaLocked = false;
  arenaWest = 0;
  arenaEast = 0;

  private readonly scene: Phaser.Scene;
  private readonly defs: EncounterDef[];
  private readonly difficulty: DifficultyParams;
  private readonly enemies: Enemy[];
  private readonly fired = new Set<string>();
  private pending: PendingSpawn[] = [];
  private elapsedMs = 0;
  private lockBanner: Phaser.GameObjects.Text | null = null;
  private activeDef: EncounterDef | null = null;

  constructor(
    scene: Phaser.Scene,
    defs: EncounterDef[],
    enemies: Enemy[],
    difficulty: DifficultyParams,
  ) {
    this.scene = scene;
    this.defs = defs;
    this.enemies = enemies;
    this.difficulty = difficulty;
  }

  update(dtMs: number, playerFloorX: number): void {
    this.elapsedMs += dtMs;

    for (const def of this.defs) {
      if (this.fired.has(def.id)) continue;
      if (playerFloorX >= def.triggerFloorX) {
        this.fired.add(def.id);
        this.begin(def);
      }
    }

    this.pending = this.pending.filter((p) => {
      if (this.elapsedMs < p.atMs) return true;
      this.enemies.push(
        createEnemy(
          this.scene,
          p.enemyId,
          { floorX: p.floorX, floorY: p.floorY },
          this.difficulty,
        ),
      );
      return false;
    });

    if (this.phase !== 'active' || !this.activeDef) return;

    const live = this.enemies.filter((e) => e.alive);
    if (live.length > 0 || this.pending.length > 0) return;

    if (this.waveIndex + 1 < this.activeDef.waves.length) {
      this.waveIndex += 1;
      this.queueWave(this.activeDef, this.activeDef.waves[this.waveIndex]!);
    } else {
      this.clearEncounter();
    }
  }

  clampPlayerFloorX(floorX: number): number {
    if (!this.arenaLocked) return floorX;
    return Math.min(floorX, this.arenaEast);
  }

  clampCameraLookX(lookX: number): number {
    if (!this.arenaLocked) return lookX;
    const maxLook = this.arenaEast - tuning.gameWidth * 0.25;
    return Math.min(lookX, maxLook);
  }

  debugSpawn(enemyId: EnemyId, floorX: number, floorY: number): void {
    this.enemies.push(
      createEnemy(this.scene, enemyId, { floorX, floorY }, this.difficulty),
    );
  }

  destroy(): void {
    this.lockBanner?.destroy();
    this.lockBanner = null;
  }

  private begin(def: EncounterDef): void {
    this.phase = 'active';
    this.activeEncounterId = def.id;
    this.activeDef = def;
    this.waveIndex = 0;

    if (def.lockArena) {
      this.arenaLocked = true;
      this.arenaWest =
        def.arenaWestFloorX ?? def.triggerFloorX - tuning.arenaLockPadWest;
      this.arenaEast =
        def.arenaEastFloorX ?? def.triggerFloorX + tuning.arenaLockPadEast;
      this.showLockBanner(true);
    }

    const wave = def.waves[0];
    if (wave) this.queueWave(def, wave);
  }

  private queueWave(def: EncounterDef, wave: { enemies: EncounterSpawn[] }): void {
    for (const s of wave.enemies) {
      this.pending.push({
        enemyId: s.enemyId,
        floorX: def.triggerFloorX + s.floorXOffset,
        floorY: s.floorY,
        atMs: this.elapsedMs + s.delayMs,
      });
    }
  }

  private clearEncounter(): void {
    this.phase = 'cleared';
    this.activeDef = null;
    this.activeEncounterId = null;
    if (this.arenaLocked) {
      this.arenaLocked = false;
      this.showLockBanner(false);
    }
  }

  private showLockBanner(on: boolean): void {
    if (!on) {
      this.lockBanner?.destroy();
      this.lockBanner = null;
      return;
    }
    if (this.lockBanner) return;
    this.lockBanner = this.scene.add
      .text(tuning.gameWidth / 2, tuning.encounterLockBannerY, 'area locked — clear enemies', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e8d5a3',
        backgroundColor: '#1a1a1ecc',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(95_000);
  }
}
