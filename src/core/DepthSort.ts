import type Phaser from 'phaser';

/**
 * Beat-em-up depth: nearer entities (higher floorY) draw on top.
 */
export function applyDepth(
  gameObject: Phaser.GameObjects.Components.Depth,
  floorY: number,
): void {
  gameObject.setDepth(floorY);
}
