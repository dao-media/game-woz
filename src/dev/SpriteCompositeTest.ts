import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';
import type { Player } from '../entities/Player';

export const DOROTHY_TEST_KEY = 'dorothy_test';
export const CUBE_TEST_KEY = 'cube_test';

const DOROTHY_PATH = 'assets/test/dorothy_test.png';
const CUBE_PATH = 'assets/test/cube_test.png';

/**
 * Dev harness: plant Blender test sprites on the real floor plane.
 * Does not touch createPlayer — GameScene attaches this after spawn.
 * No-op whenever `tuning.devSpriteTest` is false.
 */
export function preloadSpriteCompositeTest(scene: Phaser.Scene): void {
  if (!tuning.devSpriteTest) return;

  scene.load.image(DOROTHY_TEST_KEY, DOROTHY_PATH);
  scene.load.image(CUBE_TEST_KEY, CUBE_PATH);

  const onError = (file: Phaser.Loader.File) => {
    if (file.key === CUBE_TEST_KEY || file.key === DOROTHY_TEST_KEY) {
      console.warn(
        `[devSpriteTest] optional/missing asset skipped: ${file.key} (${file.url})`,
      );
    }
  };
  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
  });
}

export class SpriteCompositeTest {
  private readonly dorothy: Phaser.GameObjects.Image;
  private readonly cube: Phaser.GameObjects.Image | null;
  private readonly cubeFloorX: number;
  private readonly cubeFloorY: number;

  private constructor(
    dorothy: Phaser.GameObjects.Image,
    cube: Phaser.GameObjects.Image | null,
    cubeFloorX: number,
    cubeFloorY: number,
  ) {
    this.dorothy = dorothy;
    this.cube = cube;
    this.cubeFloorX = cubeFloorX;
    this.cubeFloorY = cubeFloorY;
  }

  /**
   * Visual-only swap: hide greybox rect, show dorothy_test at feet origin.
   * Movement / combat / collision stay on Player as-is.
   */
  static tryAttach(
    scene: Phaser.Scene,
    player: Player,
  ): SpriteCompositeTest | null {
    if (!tuning.devSpriteTest) return null;
    if (!scene.textures.exists(DOROTHY_TEST_KEY)) {
      console.warn(
        `[devSpriteTest] ${DOROTHY_TEST_KEY} not loaded — drop PNG at ${DOROTHY_PATH}`,
      );
      return null;
    }

    player.body.setVisible(false);

    const dorothy = scene.add.image(0, 0, DOROTHY_TEST_KEY);
    dorothy.setOrigin(0.5, 1);
    dorothy.setScrollFactor(1);

    let cube: Phaser.GameObjects.Image | null = null;
    const cubeFloorX = player.floorX + tuning.devSpriteTestCubeFloorXOffset;
    const cubeFloorY = player.floorY;
    if (scene.textures.exists(CUBE_TEST_KEY)) {
      cube = scene.add.image(0, 0, CUBE_TEST_KEY);
      cube.setOrigin(0.5, 1);
      cube.setScrollFactor(1);
    }

    const harness = new SpriteCompositeTest(dorothy, cube, cubeFloorX, cubeFloorY);
    harness.sync(player);
    return harness;
  }

  /** Current on-screen pixel height of the Dorothy test sprite (after depth scale). */
  get spritePixelHeight(): number {
    return this.dorothy.displayHeight;
  }

  sync(player: Player): void {
    const screen = Projection.toScreen(player.floorX, player.floorY, player.z);
    const scale = Projection.entityDepthScale(
      player.floorY,
      tuning.playerDepthScaleStrength,
    );
    const facing = player.facing < 0 ? -1 : 1;

    // Keep greybox rect hidden (setHeld may re-show it).
    player.body.setVisible(false);
    this.dorothy.setPosition(screen.x, screen.y);
    this.dorothy.setScale(facing * scale, scale);
    this.dorothy.setVisible(player.shadow.visible);
    applyDepth(this.dorothy, player.floorY, 1);

    if (this.cube) {
      const c = Projection.toScreen(this.cubeFloorX, this.cubeFloorY, 0);
      const cScale = Projection.entityDepthScale(
        this.cubeFloorY,
        tuning.playerDepthScaleStrength,
      );
      this.cube.setPosition(c.x, c.y);
      this.cube.setScale(cScale);
      applyDepth(this.cube, this.cubeFloorY, 1);
    }
  }

  destroy(): void {
    this.dorothy.destroy();
    this.cube?.destroy();
  }
}
