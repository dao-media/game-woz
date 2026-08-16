import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import type { DepthTrack } from '../core/DepthTracks';
import { placeOnGround, plantOnGround } from '../core/Placement';
import { Projection } from '../core/Projection';
import type { SceneryDef, SceneryKind } from '../data/scenery';
import { createPostVisual } from './propSprites';

const KIND_SIZE: Record<SceneryKind, { w: number; h: number; color: number }> = {
  post: { w: tuning.postGreyboxWidth, h: tuning.postGreyboxHeight, color: tuning.colors.divider },
  tree: { w: 40, h: 72, color: 0x4a6a3a },
  marker: { w: 28, h: 40, color: tuning.colors.forkMarker },
  crate: { w: 36, h: 36, color: 0x8a7040 },
};

const TRACK_TINT: Record<string, number> = {
  beyond: tuning.colors.trackBeyond,
  far: tuning.colors.trackFar,
  midFar: tuning.colors.trackMidFar,
  mid: tuning.colors.trackMid,
  near: tuning.colors.trackNear,
};

/**
 * Décor prop on a depth track. Planted via placeOnGround (scrollFactor 1) so it
 * stays on the perspective grid; apparent lag = depthScale × camera scroll.
 */
export class StageProp {
  readonly body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  readonly label?: Phaser.GameObjects.Text;
  readonly floorX: number;
  readonly track: DepthTrack;
  private readonly kind: SceneryKind;

  constructor(scene: Phaser.Scene, def: SceneryDef, track: DepthTrack) {
    this.floorX = def.floorX;
    this.track = track;
    this.kind = def.kind;
    const size = KIND_SIZE[def.kind];
    const color = TRACK_TINT[track.id] ?? size.color;

    this.body =
      def.kind === 'post'
        ? createPostVisual(scene, color)
        : scene.add.rectangle(0, 0, size.w, size.h, color);
    plantOnGround(this.body);

    if (def.label) {
      this.label = scene.add
        .text(0, 0, def.label, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#e8d5a3',
        })
        .setOrigin(0.5, 1)
        .setScrollFactor(1);
    }

    this.syncVisual();
  }

  syncVisual(): void {
    const baseScale = this.kind === 'post' ? tuning.postBaseScale : 1;
    placeOnGround(this.body, this.floorX, this.track.floorY, baseScale);

    if (this.label) {
      const screen = Projection.toScreen(this.floorX, this.track.floorY, 0);
      const s = Projection.depthScale(this.track.floorY) * baseScale;
      this.label.setPosition(screen.x, screen.y - 44 * s);
      this.label.setScale(s);
      applyDepth(this.label, this.track.floorY, 0.1);
    }
  }

  setAlpha(alpha: number): void {
    this.body.setAlpha(alpha);
    this.label?.setAlpha(alpha);
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.label ? [this.body, this.label] : [this.body];
  }
}
