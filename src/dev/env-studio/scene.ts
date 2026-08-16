/**
 * In-context preview: the game's StageView + Projection.depthScale + placeOnGround.
 */
import Phaser from 'phaser';
import { tuning } from '../../config/tuning';
import {
  createDepthTracks,
  getTrack,
  type DepthTrack,
} from '../../core/DepthTracks';
import { placeOnGround } from '../../core/Placement';
import { Projection } from '../../core/Projection';
import { createStageLayers, redrawStage, type StageLayers } from '../../render/StageView';
import { preloadYbr, YellowBrickRoad } from '../../entities/YellowBrickRoad';
import { ybrSegmentSpan } from '../../data/ybr';

export const ELEMENT_TEX = 'env-studio-element';

export type EnvPreviewApi = {
  setCanvas: (canvas: HTMLCanvasElement) => void;
  setFloorY: (floorY: number) => void;
  getFloorY: () => number;
  getTracks: () => readonly DepthTrack[];
};

type ReadyFn = (api: EnvPreviewApi) => void;

let readyFn: ReadyFn | null = null;

class EnvPreviewScene extends Phaser.Scene {
  private tracks: readonly DepthTrack[] = [];
  private stage!: StageLayers;
  private ybr: YellowBrickRoad | null = null;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private feet!: Phaser.GameObjects.Graphics;
  private floorY: number = tuning.depthNear;
  private readonly worldWidth = tuning.gameWidth;
  private readonly floorX = tuning.gameWidth / 2;

  constructor() {
    super('EnvPreview');
  }

  preload(): void {
    preloadYbr(this);
  }

  create(): void {
    this.tracks = createDepthTracks();
    this.floorY = getTrack(this.tracks, 'near').floorY;
    this.cameras.main.setBackgroundColor(tuning.colors.background);

    const horizon = Projection.horizonY();
    const floorBottom = tuning.depthNear + tuning.worldFloorPad;
    const screenNear = Projection.floorYToScreenY(floorBottom);
    const camTop = horizon - tuning.backdropHeight - 20;
    const camBottom = screenNear + 40;
    this.cameras.main.setBounds(0, camTop, this.worldWidth, camBottom - camTop);

    this.stage = createStageLayers(this);
    this.ybr = new YellowBrickRoad(
      this,
      Math.ceil(this.worldWidth / ybrSegmentSpan()) + 1,
    );
    this.feet = this.add.graphics().setDepth(10000);

    this.syncCameraAndStage();

    readyFn?.({
      setCanvas: (canvas) => this.applyCanvas(canvas),
      setFloorY: (floorY) => {
        this.floorY = floorY;
        this.syncCameraAndStage();
      },
      getFloorY: () => this.floorY,
      getTracks: () => this.tracks,
    });
  }

  private applyCanvas(canvas: HTMLCanvasElement): void {
    this.sprite?.destroy();
    this.sprite = null;
    if (this.textures.exists(ELEMENT_TEX)) {
      this.textures.remove(ELEMENT_TEX);
    }
    this.textures.addCanvas(ELEMENT_TEX, canvas);
    this.sprite = this.add.sprite(0, 0, ELEMENT_TEX);
    this.syncCameraAndStage();
  }

  private syncCameraAndStage(): void {
    const cam = this.cameras.main;
    cam.scrollX = this.floorX - tuning.gameWidth / 2;
    cam.scrollY = Projection.horizonY() - tuning.backdropHeight * 0.35;

    redrawStage(
      this.stage,
      this.worldWidth,
      cam.scrollX + tuning.gameWidth / 2,
      cam.scrollX,
      getTrack(this.tracks, 'backdrop'),
    );

    this.ybr?.syncVisual();

    if (this.sprite) {
      placeOnGround(this.sprite, this.floorX, this.floorY, 1);
    }

    const screen = Projection.toScreen(this.floorX, this.floorY, 0);
    const s = Projection.depthScale(this.floorY);
    this.feet.clear();
    this.feet.lineStyle(1, 0xffffff, 0.7);
    this.feet.lineBetween(screen.x - 10 * s, screen.y, screen.x + 10 * s, screen.y);
    this.feet.fillStyle(0xffffff, 0.9);
    this.feet.fillCircle(screen.x, screen.y, 2);
    this.feet.setDepth(this.floorY * 10 + 1);
  }
}

export function bootPreview(parent: HTMLElement, onReady: ReadyFn): void {
  readyFn = onReady;
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: tuning.colors.background,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: tuning.gameWidth,
      height: tuning.gameHeight,
    },
    scene: EnvPreviewScene,
    render: {
      antialias: true,
      pixelArt: false,
    },
  });
}
