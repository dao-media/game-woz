import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';
import type { Enemy } from '../entities/Enemy';
import {
  ensureEnemySpawnAnim,
  ENEMY_SPAWN_ANIM,
  ENEMY_SPAWN_TEXTURE,
} from './enemySpawnAssets';

/**
 * One-shot spawn burst at an enemy's floor anchor (Stage 1: single back layer).
 * RGBA sheet + NORMAL blend — no opaque fallback boxes.
 */
export class EnemySpawnFx {
  private readonly sprite: Phaser.GameObjects.Sprite | null;
  private readonly animReady: boolean;
  private anchorFloorX = 0;
  private anchorFloorY = 0;
  private enemyDepth = 1;
  private playing = false;

  private constructor(sprite: Phaser.GameObjects.Sprite | null, animReady: boolean) {
    this.sprite = sprite;
    this.animReady = animReady;
  }

  /** Create and play spawn FX at the enemy's ground point. Returns null if assets missing. */
  static playAt(scene: Phaser.Scene, enemy: Enemy): EnemySpawnFx | null {
    const animReady = ensureEnemySpawnAnim(scene);
    if (!animReady || !scene.textures.exists(ENEMY_SPAWN_TEXTURE)) {
      return null;
    }

    const sprite = scene.add
      .sprite(0, 0, ENEMY_SPAWN_TEXTURE, 0)
      .setOrigin(0.5, 1)
      .setScrollFactor(1)
      .setBlendMode(tuning.enemySpawnBlendMode)
      .setVisible(false);

    const fx = new EnemySpawnFx(sprite, animReady);
    fx.start(enemy);
    return fx;
  }

  get active(): boolean {
    return this.playing;
  }

  private start(enemy: Enemy): void {
    if (!this.sprite || !this.animReady) return;

    this.anchorFloorX = enemy.floorX;
    this.anchorFloorY = enemy.floorY;
    this.enemyDepth = enemy.body.depth;
    this.playing = true;

    this.sync();
    this.sprite.setVisible(true);
    this.sprite.play({
      key: ENEMY_SPAWN_ANIM,
      timeScale: tuning.enemySpawnFxTimeScale,
    });
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.sprite?.setVisible(false);
      this.sprite?.stop();
      this.playing = false;
    });
  }

  /** Re-sort if depth changed (enemy body depth updates with floorY). */
  sync(enemy?: Enemy): void {
    if (!this.sprite || !this.playing) return;

    if (enemy) {
      this.enemyDepth = enemy.body.depth;
    }

    const ground = Projection.toScreen(this.anchorFloorX, this.anchorFloorY, 0);
    const entityScale = Projection.entityDepthScale(
      this.anchorFloorY,
      tuning.playerDepthScaleStrength,
    );
    const displayH = tuning.enemySpawnFxDisplayHeight * entityScale;
    const scale =
      (displayH / tuning.enemySpawnFrameHeight) * tuning.enemySpawnScale;

    this.sprite.setPosition(ground.x, ground.y);
    this.sprite.setScale(scale);

    applyDepth(this.sprite, this.anchorFloorY, tuning.enemySpawnDepthTieBreak);
    this.sprite.setDepth(
      Math.min(this.sprite.depth, this.enemyDepth - tuning.enemySpawnDepthBehind),
    );
  }

  destroy(): void {
    this.sprite?.destroy();
    this.playing = false;
  }
}
