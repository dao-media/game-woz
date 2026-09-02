import Phaser from 'phaser';
import { tuning } from '../config/tuning';

export const ENEMY_SPAWN_TEXTURE = 'enemy-spawn-sheet';
export const ENEMY_SPAWN_ANIM = 'enemy-spawn-rise';

const FX_BASE = 'fx/enemy-spawn';

/** One-shot spawn effect duration from frame count + rate (ms). */
export function enemySpawnDurationMs(): number {
  return (
    (tuning.enemySpawnFrameCount / tuning.enemySpawnFrameRate) * 1000
  );
}

/** Queue the horizontal RGBA enemy spawn sheet (40 × 540×572). */
export function preloadEnemySpawn(scene: Phaser.Scene): void {
  scene.load.spritesheet(ENEMY_SPAWN_TEXTURE, `${FX_BASE}/enemy_spawn_sheet.png`, {
    frameWidth: tuning.enemySpawnFrameWidth,
    frameHeight: tuning.enemySpawnFrameHeight,
  });
}

/** Register the one-shot spawn animation after textures load. */
export function ensureEnemySpawnAnim(scene: Phaser.Scene): boolean {
  if (scene.anims.exists(ENEMY_SPAWN_ANIM)) return true;

  if (!scene.textures.exists(ENEMY_SPAWN_TEXTURE)) {
    console.warn('[enemySpawn] texture missing — spawn FX disabled');
    return false;
  }

  const tex = scene.textures.get(ENEMY_SPAWN_TEXTURE);
  const frameTotal = tex.frameTotal;
  if (frameTotal <= 0) {
    console.warn('[enemySpawn] texture has no frames — spawn FX disabled');
    return false;
  }

  const source = tex.getSourceImage() as HTMLImageElement | undefined;
  const expectedW = tuning.enemySpawnFrameWidth * tuning.enemySpawnFrameCount;
  if (source && (source.width < expectedW || source.height < tuning.enemySpawnFrameHeight)) {
    console.warn(
      `[enemySpawn] sheet size ${source.width}×${source.height} — expected ≥${expectedW}×${tuning.enemySpawnFrameHeight}`,
    );
  }

  const end = Math.min(
    Math.max(0, tuning.enemySpawnFrameCount - 1),
    frameTotal - 1,
  );
  const frames = scene.anims.generateFrameNumbers(ENEMY_SPAWN_TEXTURE, {
    start: 0,
    end,
  });

  if (frames.length === 0) {
    console.warn('[enemySpawn] no animation frames — spawn FX disabled');
    return false;
  }

  scene.anims.create({
    key: ENEMY_SPAWN_ANIM,
    frames,
    frameRate: tuning.enemySpawnFrameRate,
    repeat: 0,
  });

  return true;
}
