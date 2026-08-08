import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getSelectedCharacterId, getSelectedPath, getServices } from '../core/Registry';
import {
  createDepthTracks,
  getTrack,
  type DepthTrack,
  type DepthTrackId,
} from '../core/DepthTracks';
import { Projection } from '../core/Projection';
import { gameScenery } from '../data/scenery';
import { gameEncounters } from '../data/encounters';
import { createPlayer } from '../entities/createPlayer';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { StageProp } from '../entities/StageProp';
import { createStageLayers, redrawStage, type StageLayers } from '../render/StageView';
import { DebugOverlay } from '../ui/DebugOverlay';
import { CombatHUD } from '../ui/CombatHUD';
import { EncounterManager } from '../combat/EncounterManager';
import { resolveDifficultyParams } from '../ai/DifficultyParams';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private enemies: Enemy[] = [];
  private props: StageProp[] = [];
  private tracks: readonly DepthTrack[] = [];
  private stage!: StageLayers;
  private debug!: DebugOverlay;
  private hud!: CombatHUD;
  private encounters!: EncounterManager;
  private finished = false;
  private defeated = false;
  private readonly worldWidth = tuning.continuationRoadLength;
  private spawnToggle = 0;

  constructor() {
    super('Game');
  }

  create(): void {
    const path = getSelectedPath(this);
    const { input, runState } = getServices(this);
    input.bind(this);
    input.setEnabled(true);
    this.finished = false;
    this.defeated = false;
    this.tracks = createDepthTracks();
    this.enemies = [];

    const difficulty = resolveDifficultyParams(runState.difficulty);

    this.cameras.main.setBackgroundColor(tuning.colors.background);
    const horizon = Projection.horizonY();
    const floorBottom = tuning.depthNear + tuning.worldFloorPad;
    const screenNear = Projection.floorYToScreenY(floorBottom);
    const camTop = horizon - tuning.backdropHeight - 20;
    const camBottom = screenNear + 40;
    this.cameras.main.setBounds(0, camTop, this.worldWidth, camBottom - camTop);

    this.stage = createStageLayers(this);

    this.props = gameScenery.map((def) => {
      const track = getTrack(this.tracks, def.track as DepthTrackId);
      return new StageProp(this, def, track);
    });

    const spawnY = (path.floorYMin + path.floorYMax) / 2;
    this.player = createPlayer(
      this,
      getSelectedCharacterId(this),
      { floorX: 80, floorY: spawnY },
      { xMin: 0, xMax: this.worldWidth },
    );

    this.encounters = new EncounterManager(
      this,
      gameEncounters,
      this.enemies,
      difficulty,
    );

    this.hud = new CombatHUD(this);
    this.debug = new DebugOverlay(this);
    this.add
      .text(
        16,
        tuning.gameHeight - 28,
        `${path.label} → ${path.destination}  ·  J/L/U  ·  ] spawn  ·  F3`,
        {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#c4c4d0',
        },
      )
      .setScrollFactor(0)
      .setDepth(99999);

    this.syncCameraAndStage();
  }

  update(_t: number, dt: number): void {
    if (this.finished || this.defeated) return;

    const { input, runState } = getServices(this);
    if (input.justDown('debug')) this.debug.toggle();

    if (input.justDown('spawnEnemy')) {
      this.spawnToggle = 1 - this.spawnToggle;
      const id = this.spawnToggle === 0 ? 'wheeler' : 'winged-monkey';
      this.encounters.debugSpawn(
        id,
        this.player.floorX + 120,
        clampSpawnY(this.player.floorY),
      );
    }

    this.encounters.update(dt, this.player.floorX);

    // Arena east clamp before player move settles.
    const liveTargets = this.enemies.filter((e) => e.alive);
    this.player.update(input, dt, liveTargets);
    this.player.floorX = this.encounters.clampPlayerFloorX(this.player.floorX);

    for (const enemy of this.enemies) {
      enemy.update(dt, this.player, this.enemies);
    }

    this.hud.update(this.player);
    this.syncCameraAndStage();

    const path = getSelectedPath(this);
    this.debug.update(this.player, path, runState.selectedCharacter, {
      difficulty: runState.difficulty,
      enemies: this.enemies.filter((e) => e.alive),
      encounter: this.encounters,
    });

    if (this.player.health.isDead) {
      this.defeated = true;
      this.time.delayedCall(600, () => {
        this.scene.start('CharacterSelect');
      });
      return;
    }

    if (
      !this.encounters.arenaLocked &&
      this.player.floorX >= this.worldWidth - tuning.finishMargin
    ) {
      this.finished = true;
      this.scene.start('Win');
    }
  }

  private syncCameraAndStage(): void {
    const cam = this.cameras.main;
    let lookX = this.player.floorX;
    lookX = this.encounters.clampCameraLookX(lookX);
    cam.scrollX = lookX - tuning.gameWidth / 2;
    cam.scrollY = Projection.horizonY() - tuning.backdropHeight * 0.35;

    redrawStage(
      this.stage,
      this.worldWidth,
      cam.scrollX + tuning.gameWidth / 2,
      cam.scrollX,
      getTrack(this.tracks, 'backdrop'),
    );

    this.props.forEach((p) => p.syncVisual());
    this.player.syncVisual();
    this.enemies.forEach((e) => e.syncVisual());
  }
}

function clampSpawnY(y: number): number {
  return Phaser.Math.Clamp(y + (Math.random() - 0.5) * 60, tuning.depthFar, tuning.depthNear);
}
