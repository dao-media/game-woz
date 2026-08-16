import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { placeOnGroundLeft } from '../core/Placement';
import {
  allFenceVariants,
  createFence,
  FENCE_GAME_DIR,
  fenceTextureKey,
  type FenceDef,
  type FenceSegmentDef,
} from '../data/fence';

export function preloadFenceTiles(scene: Phaser.Scene): void {
  for (const v of allFenceVariants()) {
    scene.load.image(fenceTextureKey(v.id), `${FENCE_GAME_DIR}/${v.id}.png`);
  }
}

/**
 * One authored tile. Décor only — no collision, hitbox, or AI.
 * Left-origin so neighbors stack end-to-end in floor-X.
 */
export class FenceTile {
  readonly img: Phaser.GameObjects.Image;
  readonly def: FenceSegmentDef;

  constructor(scene: Phaser.Scene, def: FenceSegmentDef) {
    this.def = def;
    this.img = scene.add.image(0, 0, fenceTextureKey(def.variant.id));
    this.syncVisual();
  }

  syncVisual(): void {
    const scale = tuning.fenceTileScale;
    placeOnGroundLeft(
      this.img,
      this.def.floorX - this.def.variant.insetL * scale,
      this.def.floorY,
      scale,
    );
  }

  setAlpha(alpha: number): void {
    this.img.setAlpha(alpha);
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.img];
  }
}

/**
 * Near + far fence runs. Sequence is data:
 * Up/Start → (down, up)* → Down/End, variations picked per slot.
 */
export class Fence {
  readonly def: FenceDef;
  readonly tiles: FenceTile[];
  readonly group: Phaser.GameObjects.Group;

  constructor(scene: Phaser.Scene, roadLength: number) {
    this.def = createFence(roadLength);
    this.group = scene.add.group();
    this.tiles = this.def.segments.map((seg) => {
      const tile = new FenceTile(scene, seg);
      this.group.add(tile.img);
      return tile;
    });
  }

  syncVisual(): void {
    for (const tile of this.tiles) tile.syncVisual();
  }

  setAlpha(alpha: number): void {
    for (const tile of this.tiles) tile.setAlpha(alpha);
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.tiles.flatMap((t) => t.displayObjects);
  }

  get tileCount(): number {
    return this.tiles.length;
  }
}
