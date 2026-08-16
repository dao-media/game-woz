import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';
import {
  PLANT_GAME_DIR,
  PLANT_VARIANTS,
  createPlantField,
  plantTextureKey,
  plantWind,
  type PlantTuftDef,
} from '../data/plants';

export function preloadPlants(scene: Phaser.Scene): void {
  for (const v of Object.values(PLANT_VARIANTS)) {
    scene.load.image(plantTextureKey(v.id), `${PLANT_GAME_DIR}/${v.file}`);
  }
}

/**
 * Crest grass + wheat on the rear hill.
 * Sprites only — sliced meshes shear the texture into jagged shards.
 * Breeze is a small lean from the feet.
 */
export class PlantField {
  readonly grass: GroundTuft[];
  readonly wheat: GroundTuft[];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, roadLength: number) {
    this.scene = scene;
    const field = createPlantField(roadLength);
    this.grass = field.grass.map((def) => new GroundTuft(scene, def, tuning.plantGrassLean));
    this.wheat = field.wheat.map((def) => new GroundTuft(scene, def, tuning.plantWheatLean));

    for (const id of Object.keys(PLANT_VARIANTS) as Array<keyof typeof PLANT_VARIANTS>) {
      scene.textures.get(plantTextureKey(id)).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    this.syncVisual();
  }

  syncVisual(): void {
    const tSec = this.scene.time.now * 0.001;
    const lookX = Projection.vanishingX;
    for (const tuft of this.grass) tuft.syncVisual(tSec, lookX);
    for (const tuft of this.wheat) tuft.syncVisual(tSec, lookX);
  }

  setAlpha(alpha: number): void {
    for (const tuft of this.grass) tuft.img.setAlpha(alpha);
    for (const tuft of this.wheat) tuft.img.setAlpha(alpha);
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.grass.map((t) => t.img), ...this.wheat.map((t) => t.img)];
  }
}

class GroundTuft {
  readonly img: Phaser.GameObjects.Image;
  readonly def: PlantTuftDef;
  private readonly lean: number;

  constructor(scene: Phaser.Scene, def: PlantTuftDef, lean: number) {
    this.def = def;
    this.lean = lean;
    this.img = scene.add.image(0, 0, plantTextureKey(def.variant));
    this.img.setOrigin(0.5, 1);
    this.img.setScrollFactor(1);
    this.img.setFlipX(def.flipX);
    this.img.setScale(Projection.depthScale(def.floorY) * def.baseScale);
    applyDepth(this.img, def.floorY);
  }

  syncVisual(tSec: number, lookX: number): void {
    const s = Projection.toScreen(this.def.floorX, this.def.floorY, this.def.hillZ);
    const half = tuning.gameWidth * 0.5 + 160;
    if (s.x < lookX - half || s.x > lookX + half) {
      if (this.img.visible) this.img.setVisible(false);
      return;
    }
    if (!this.img.visible) this.img.setVisible(true);
    this.img.setPosition(s.x, s.y);
    this.img.setRotation(plantWind(tSec, this.def.floorX, this.def.phase) * this.lean);
  }
}
