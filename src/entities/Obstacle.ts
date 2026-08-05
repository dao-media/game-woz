import Phaser from 'phaser';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';

/**
 * Static greybox obstacle: feet box in floor space + projected body sprite.
 */
export class Obstacle {
  readonly feet: Phaser.Physics.Arcade.Image;
  readonly bodySprite: Phaser.GameObjects.Image;
  readonly floorX: number;
  readonly floorY: number;

  constructor(scene: Phaser.Scene, floorX: number, floorY: number) {
    this.floorX = floorX;
    this.floorY = floorY;

    this.feet = scene.physics.add.staticImage(floorX, floorY, 'obstacle-feet');
    this.feet.refreshBody();
    this.feet.setVisible(false);

    this.bodySprite = scene.add.image(0, 0, 'obstacle-body');
    this.bodySprite.setOrigin(0.5, 1);
    this.syncVisual();
  }

  /** Re-project when the vanishing point moves with the camera. */
  syncVisual(): void {
    const screen = Projection.toScreen(this.floorX, this.floorY, 0);
    this.bodySprite.setPosition(screen.x, screen.y);
    applyDepth(this.bodySprite, this.floorY);
  }
}
