import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import {
  createDepthTracks,
  getTrack,
  trackParallaxSpeed,
  type DepthTrack,
} from '../core/DepthTracks';
import { Projection } from '../core/Projection';
import { getSelectedPath, getServices } from '../core/Registry';
import { createStageLayers, redrawStage, type StageLayers } from '../core/StageView';
import { playerDef } from '../data/entities';
import { Obstacle } from '../entities/Obstacle';
import { Player } from '../entities/Player';
import { TrackProp } from '../entities/TrackProp';

/** Distance from world end that counts as finishing the run. */
const FINISH_MARGIN = 64;

const TRACK_PROP_COLORS: Record<string, number> = {
  far: 0x6a8aaa,
  mid: 0x8a9a6a,
  near: 0xaa8a6a,
};

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private obstacles: Obstacle[] = [];
  private trackProps: TrackProp[] = [];
  private tracks: readonly DepthTrack[] = [];
  private followTarget!: Phaser.GameObjects.Zone;
  private stage!: StageLayers;
  private finishLabel!: Phaser.GameObjects.Text;
  private worldWidth: number = tuning.worldWidth;
  private finished = false;
  private hud!: Phaser.GameObjects.Text;
  private lastScrollX = 0;

  constructor() {
    super('Game');
  }

  create(): void {
    const path = getSelectedPath(this);
    const { input } = getServices(this);
    input.bind(this);

    this.worldWidth = path.worldWidth;
    this.finished = false;
    this.tracks = createDepthTracks();

    const floorTop = tuning.depthFar - tuning.worldFloorPad;
    const floorBottom = tuning.depthNear + tuning.worldFloorPad;
    this.physics.world.setBounds(0, floorTop, this.worldWidth, floorBottom - floorTop);
    this.physics.world.gravity.y = 0;

    this.cameras.main.setBackgroundColor(tuning.colors.background);

    this.stage = createStageLayers(this);
    this.syncVanishingPoint();
    redrawStage(
      this.stage,
      this.worldWidth,
      Projection.vanishingX,
      this.cameras.main.scrollX,
      getTrack(this.tracks, 'backdrop'),
    );

    const midY = (tuning.depthFar + tuning.depthNear) / 2;
    this.player = new Player(this, playerDef, { floorX: 120, floorY: midY }, {
      depthFar: tuning.depthFar,
      depthNear: tuning.depthNear,
      worldWidth: this.worldWidth,
    });

    this.spawnObstacles(midY);
    this.obstacles.forEach((o) => {
      this.physics.add.collider(this.player.feet, o.feet);
    });
    this.spawnTrackProps();

    this.followTarget = this.add.zone(0, 0, 1, 1);
    const cam = this.cameras.main;
    const horizon = Projection.horizonY();
    const screenNear = Projection.floorYToScreenY(floorBottom);
    const camTop = horizon - tuning.backdropHeight - 20;
    const camBottom = screenNear + 40;
    cam.setBounds(0, camTop, this.worldWidth, camBottom - camTop);
    cam.startFollow(this.followTarget, true, 0.12, 0.12);

    this.hud = this.add
      .text(16, 12, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#c4c4d0',
      })
      .setScrollFactor(0)
      .setDepth(10_000);

    const finishScreen = Projection.toScreen(this.worldWidth - 40, midY);
    this.finishLabel = this.add
      .text(finishScreen.x, finishScreen.y, '→ FINISH', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e8d5a3',
      })
      .setOrigin(1, 0.5)
      .setDepth(0);

    this.refreshHud(path.name);
  }

  update(_time: number, delta: number): void {
    if (this.finished) return;

    const cam = this.cameras.main;
    const scrollX = cam.scrollX;
    const scrollSpeed = ((scrollX - this.lastScrollX) / Math.max(delta, 1)) * 1000;
    this.lastScrollX = scrollX;

    this.syncVanishingPoint();
    redrawStage(
      this.stage,
      this.worldWidth,
      Projection.vanishingX,
      scrollX,
      getTrack(this.tracks, 'backdrop'),
    );

    const { input } = getServices(this);
    this.player.update(input, delta);
    this.obstacles.forEach((o) => o.syncVisual());
    this.trackProps.forEach((p) => p.syncVisual());

    const follow = this.player.getFollowPoint();
    this.followTarget.setPosition(follow.x, follow.y);

    const midY = (tuning.depthFar + tuning.depthNear) / 2;
    const finishScreen = Projection.toScreen(this.worldWidth - 40, midY);
    this.finishLabel.setPosition(finishScreen.x, finishScreen.y);

    this.refreshHudScroll(scrollSpeed);

    if (this.player.floorX >= this.worldWidth - FINISH_MARGIN) {
      this.finished = true;
      this.scene.start('Win');
    }
  }

  private syncVanishingPoint(): void {
    const cam = this.cameras.main;
    Projection.setVanishingX(cam.scrollX + cam.width / 2);
  }

  private refreshHud(pathName: string): void {
    this.hud.setData('pathName', pathName);
    this.refreshHudScroll(0);
  }

  private refreshHudScroll(cameraScrollSpeed: number): void {
    const pathName = (this.hud.getData('pathName') as string) ?? '';
    const far = getTrack(this.tracks, 'far');
    const mid = getTrack(this.tracks, 'mid');
    const near = getTrack(this.tracks, 'near');
    const back = getTrack(this.tracks, 'backdrop');
    const line = (t: DepthTrack) =>
      `${t.id} sf=${t.scrollFactor.toFixed(2)} v=${trackParallaxSpeed(t.scrollFactor, cameraScrollSpeed).toFixed(0)}`;

    this.hud.setText(
      [
        pathName,
        'WASD walk · Shift run · SPACE hop',
        `tracks  ${line(back)}`,
        `        ${line(far)} | ${line(mid)} | ${line(near)}`,
      ].join('\n'),
    );
  }

  private spawnObstacles(midY: number): void {
    const placements: { x: number; y: number }[] = [
      { x: 480, y: tuning.depthFar + 30 },
      { x: 720, y: midY },
      { x: 980, y: tuning.depthNear - 40 },
      { x: 1300, y: tuning.depthFar + 80 },
      { x: 1700, y: midY + 40 },
    ];

    this.obstacles = placements
      .filter((p) => p.x < this.worldWidth - 200)
      .map((p) => new Obstacle(this, p.x, p.y));
  }

  private spawnTrackProps(): void {
    const far = getTrack(this.tracks, 'far');
    const mid = getTrack(this.tracks, 'mid');
    const near = getTrack(this.tracks, 'near');
    const specs: { track: DepthTrack; xs: number[] }[] = [
      { track: far, xs: [200, 600, 1100, 1600, 2100] },
      { track: mid, xs: [350, 800, 1400, 1900] },
      { track: near, xs: [450, 950, 1500, 2000] },
    ];

    this.trackProps = specs.flatMap(({ track, xs }) =>
      xs
        .filter((x) => x < this.worldWidth - 100)
        .map(
          (x) =>
            new TrackProp(
              this,
              track,
              x,
              TRACK_PROP_COLORS[track.id] ?? 0x888888,
              track.id === 'near' ? 32 : 26,
              track.id === 'near' ? 48 : track.id === 'mid' ? 44 : 36,
            ),
        ),
    );
  }
}
