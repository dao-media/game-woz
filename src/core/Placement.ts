import type Phaser from 'phaser';
import { applyDepth } from './DepthSort';
import { Projection } from './Projection';

/** Game object that can be planted on the floor plane. */
export type GroundObject = Phaser.GameObjects.Components.Transform &
  Phaser.GameObjects.Components.Origin &
  Phaser.GameObjects.Components.ScrollFactor &
  Phaser.GameObjects.Components.Depth;

/**
 * Plant décor on the floor: feet origin (0.5, 1.0), world-locked scroll.
 * Call once at spawn; `placeOnGround` re-applies it so callers can't drift.
 */
export function plantOnGround(obj: GroundObject): void {
  obj.setOrigin(0.5, 1.0);
  obj.setScrollFactor(1);
}

/**
 * Shared décor placement — same path for roadside props and fence posts.
 *
 * - Origin at the base so the feet sit on the ground line at `floorY`
 * - Screen position from Projection (perspective X + foreshortened Y)
 * - Visual size from full `depthScale(floorY)` (not entityDepthScale)
 * - Render order from `applyDepth(floorY)` — one sort space with characters
 */
export function placeOnGround(
  obj: GroundObject,
  floorX: number,
  floorY: number,
  baseScale = 1,
  tieBreak = 0,
): void {
  plantOnGround(obj);
  const screen = Projection.toScreen(floorX, floorY, 0);
  const scale = Projection.depthScale(floorY) * baseScale;
  obj.setPosition(screen.x, screen.y);
  obj.setScale(scale, scale);
  applyDepth(obj, floorY, tieBreak);
}

/**
 * Same as placeOnGround, but origin at the left feet (0, 1) so tiles can
 * stack horizontally: next floorX = current + sourceWidth × baseScale.
 */
export function placeOnGroundLeft(
  obj: GroundObject,
  floorX: number,
  floorY: number,
  baseScale = 1,
  tieBreak = 0,
): void {
  obj.setOrigin(0, 1.0);
  obj.setScrollFactor(1);
  const screen = Projection.toScreen(floorX, floorY, 0);
  const scale = Projection.depthScale(floorY) * baseScale;
  obj.setPosition(screen.x, screen.y);
  obj.setScale(scale, scale);
  applyDepth(obj, floorY, tieBreak);
}
