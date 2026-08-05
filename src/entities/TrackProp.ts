import Phaser from 'phaser';
import { applyDepth } from '../core/DepthSort';
import type { DepthTrack } from '../core/DepthTracks';
import { Projection } from '../core/Projection';

/**
 * Non-colliding greybox prop on a depth track.
 * Scroll factor comes from the track (depth-derived) so camera motion
 * shows clear parallax between far / mid / near layers.
 */
export class TrackProp {
  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly track: DepthTrack;
  readonly floorX: number;

  constructor(
    scene: Phaser.Scene,
    track: DepthTrack,
    floorX: number,
    color: number,
    width = 28,
    height = 40,
  ) {
    this.track = track;
    this.floorX = floorX;

    this.sprite = scene.add.rectangle(floorX, 0, width, height, color);
    this.sprite.setOrigin(0.5, 1);
    this.sprite.setScrollFactor(track.scrollFactor);
    this.syncVisual();
  }

  syncVisual(): void {
    // Y sits on the perspective floor; X uses track scrollFactor for parallax.
    const y = Projection.floorYToScreenY(this.track.floorY);
    this.sprite.setPosition(this.floorX, y);
    this.sprite.setScrollFactor(this.track.scrollFactor);
    applyDepth(this.sprite, this.track.floorY);
  }
}
