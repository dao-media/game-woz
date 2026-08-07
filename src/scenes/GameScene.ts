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
import { createPlayer } from '../entities/createPlayer';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { StageProp } from '../entities/StageProp';
import { createStageLayers, redrawStage, type StageLayers } from '../render/StageView';
import { DebugOverlay } from '../ui/DebugOverlay';
import { CombatHUD } from '../ui/CombatHUD';

const DUMMY_SPAWNS: ReadonlyArray<{ floorX: number; floorY: number }> = [
  { floorX: 420, floorY: 200 },
  { floorX: 560, floorY: 310 },
  { floorX: 720, floorY: 250 },
  { floorX: 900, floorY: 360 },
];

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private enemies: Enemy[] = [];
  private props: StageProp[] = [];
  private tracks: readonly DepthTrack[] = [];
  private stage!: StageLayers;
  private debug!: DebugOverlay;
  private hud!: CombatHUD;
  private finished = false;
  private defeated = false;
  private readonly worldWidth = tuning.continuationRoadLength;

  constructor() {
    super('Game');
  }

  create(): void {
    const path = getSelectedPath(this);
    const { input } = getServices(this);
    input.bind(this);
    input.setEnabled(true);
    this.finished = false;
    this.defeated = false;
    this.tracks = createDepthTracks();

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

    this.enemies = DUMMY_SPAWNS.map((s) => new Enemy(this, s));

    this.hud = new CombatHUD(this);
    this.debug = new DebugOverlay(this);
    this.add
      .text(16, tuning.gameHeight - 28, `${path.label} → ${path.destination}  ·  J/L/U  ·  F3 debug`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#c4c4d0',
      })
      .setScrollFactor(0)
      .setDepth(99999);

    this.syncCameraAndStage();
  }

  update(_t: number, dt: number): void {
    if (this.finished || this.defeated) return;

    const { input, runState } = getServices(this);
    if (input.justDown('debug')) this.debug.toggle();

    const liveTargets = this.enemies.filter((e) => e.alive);
    this.player.update(input, dt, liveTargets);

    for (const enemy of this.enemies) {
      enemy.update(dt, this.player);
    }

    this.hud.update(this.player);
    this.syncCameraAndStage();

    const path = getSelectedPath(this);
    this.debug.update(this.player, path, runState.selectedCharacter);

    if (this.player.health.isDead) {
      this.defeated = true;
      this.time.delayedCall(600, () => {
        this.scene.start('CharacterSelect');
      });
      return;
    }

    if (this.player.floorX >= this.worldWidth - tuning.finishMargin) {
      this.finished = true;
      this.scene.start('Win');
    }
  }

  private syncCameraAndStage(): void {
    const cam = this.cameras.main;
    cam.scrollX = this.player.floorX - tuning.gameWidth / 2;
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
