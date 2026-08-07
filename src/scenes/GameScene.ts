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
import { StageProp } from '../entities/StageProp';
import { createStageLayers, redrawStage, type StageLayers } from '../render/StageView';
import { DebugOverlay } from '../ui/DebugOverlay';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private props: StageProp[] = [];
  private tracks: readonly DepthTrack[] = [];
  private stage!: StageLayers;
  private debug!: DebugOverlay;
  private finished = false;
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

    this.debug = new DebugOverlay(this);
    this.add
      .text(16, tuning.gameHeight - 28, `${path.label} → ${path.destination}  ·  F3 debug`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#c4c4d0',
      })
      .setScrollFactor(0)
      .setDepth(99999);

    this.syncCameraAndStage();
  }

  update(_t: number, dt: number): void {
    if (this.finished) return;

    const { input, runState } = getServices(this);
    if (input.justDown('debug')) this.debug.toggle();

    this.player.update(input, dt);
    this.syncCameraAndStage();

    const path = getSelectedPath(this);
    this.debug.update(this.player, path, runState.selectedCharacter);

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
  }
}
