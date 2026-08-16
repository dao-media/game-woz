import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { Projection } from '../core/Projection';
import {
  YBR_DEPTH,
  YBR_FILE,
  YBR_GAME_DIR,
  YBR_TEX,
  buildYbrGeometry,
  ybrGrassTipWeight,
  ybrRoadLength,
  type YbrFloorVert,
} from '../data/ybr';

export function preloadYbr(scene: Phaser.Scene): void {
  scene.load.image(YBR_TEX, `${YBR_GAME_DIR}/${YBR_FILE}`);
}

/**
 * Authored YBR blocks laid on the floor plane (near fence → far fence),
 * repeated along floor-X. Décor only. Each block is a perspective quad,
 * not a screen-aligned billboard. Grass tips get a light traveling breeze;
 * bricks stay planted.
 */
export class YellowBrickRoad {
  readonly segments: number;
  readonly roadLength: number;
  readonly mesh: Phaser.GameObjects.Mesh;
  private readonly scene: Phaser.Scene;
  private readonly floorOfVert: YbrFloorVert[];

  constructor(scene: Phaser.Scene, segments: number) {
    this.scene = scene;
    this.segments = Math.max(0, Math.floor(segments));
    this.roadLength = ybrRoadLength(this.segments);

    const geom = buildYbrGeometry(this.segments);
    this.mesh = scene.add.mesh(0, 0, YBR_TEX);
    this.mesh.addVertices(geom.vertices, geom.uvs, geom.indices);
    this.mesh.hideCCW = false;
    this.mesh.setOrtho(this.mesh.width, this.mesh.height);
    this.mesh.setDepth(YBR_DEPTH);
    this.mesh.setScrollFactor(1);
    this.mesh.ignoreDirtyCache = true;

    this.floorOfVert = geom.indices.map((idx) => geom.uniqueFloor[idx]!);
    this.syncVisual();
  }

  syncVisual(): void {
    const tSec = this.scene.time.now * 0.001;
    const verts = this.mesh.vertices;
    const n = Math.min(verts.length, this.floorOfVert.length);
    for (let i = 0; i < n; i++) {
      const p = this.floorOfVert[i]!;
      const w = ybrGrassTipWeight(p.t);
      let floorX = p.floorX;
      if (w > 0) {
        const gust =
          Math.sin(tSec * tuning.ybrGrassSwaySpeed + p.floorX * tuning.ybrGrassSwayTravel + p.t * 2.2) *
            0.7 +
          Math.sin(tSec * tuning.ybrGrassGustSpeed + p.floorX * 0.011 + 0.8) * 0.3;
        floorX += gust * tuning.ybrGrassSway * w * w;
      }
      const s = Projection.toScreen(floorX, p.floorY);
      const v = verts[i]!;
      v.x = s.x;
      v.y = -s.y;
    }
  }

  setAlpha(alpha: number): void {
    this.mesh.setAlpha(alpha);
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.mesh];
  }

  get tileCount(): number {
    return this.segments;
  }
}
