import type Phaser from 'phaser';

/** Render order from floor depth — nearer (higher floorY) draws on top. */
export function applyDepth(
  obj: Phaser.GameObjects.Components.Depth,
  floorY: number,
  tieBreak = 0,
): void {
  obj.setDepth(floorY * 10 + tieBreak);
}
