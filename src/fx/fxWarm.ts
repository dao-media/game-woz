import Phaser from 'phaser';
import { ensureGroundBurstAnim, GROUND_BURST_TEXTURE } from './groundBurstAssets';
import { ensureEnemySpawnAnim, ENEMY_SPAWN_TEXTURE } from './enemySpawnAssets';
import {
  ensureOptionalFxAnims,
  OPTIONAL_FX_TEXTURES,
} from './optionalFxAssets';
import { tuning } from '../config/tuning';
import { registerSlipperSparklePipeline } from './SlipperSparklePipeline';
import { ensureTransparentQuadTexture } from './transparentTexture';

let warmed = false;

/**
 * Decode/upload FX textures, register anims, and compile shader pipelines during
 * Preload — not on Munchkinland→Game fork (avoids main-thread freeze).
 */
export function warmFx(scene: Phaser.Scene): void {
  if (warmed) return;
  warmed = true;

  const t0 = performance.now();

  ensureTransparentQuadTexture(scene);

  ensureGroundBurstAnim(scene);
  ensureEnemySpawnAnim(scene);
  ensureOptionalFxAnims(scene);

  // Legacy ExteriorRim only — active path is duplicate sprite + postFX glow.
  if (tuning.slipperSparkleLegacyRim) {
    const renderer = scene.game.renderer;
    if (renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      try {
        registerSlipperSparklePipeline(scene.game);
      } catch (err) {
        console.warn('[fxWarm] SlipperSparkle pipeline failed', err);
      }
    }
  }

  uploadTextureToGpu(scene, GROUND_BURST_TEXTURE);
  uploadTextureToGpu(scene, ENEMY_SPAWN_TEXTURE);
  for (const key of OPTIONAL_FX_TEXTURES) {
    uploadTextureToGpu(scene, key);
  }

  const ms = Math.round(performance.now() - t0);
  console.info(`[fxWarm] FX warmed in ${ms}ms (textures + anims)`);
}

/** Force first GPU upload for a spritesheet while still on the loading screen. */
function uploadTextureToGpu(scene: Phaser.Scene, textureKey: string): void {
  if (!scene.textures.exists(textureKey)) return;

  const probe = scene.add
    .image(-4096, -4096, textureKey, 0)
    .setVisible(false)
    .setActive(false);

  scene.game.renderer.preRender();
  probe.destroy();
}
