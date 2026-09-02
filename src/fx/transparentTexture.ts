import Phaser from 'phaser';

/** Shared fully-transparent quad for shader-driven FX (sparkle, ray, etc.). */
export const FX_TRANSPARENT_QUAD_KEY = 'fx-transparent-quad';

/**
 * Canvas texture with alpha=0 everywhere. If a custom pipeline fails to bind,
 * the fallback draw shows nothing — never a white/black box.
 */
export function ensureTransparentQuadTexture(
  scene: Phaser.Scene,
  key = FX_TRANSPARENT_QUAD_KEY,
): string {
  if (scene.textures.exists(key)) {
    return key;
  }

  const size = 4;
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) {
    throw new Error(`[fx] failed to create transparent quad texture: ${key}`);
  }

  const ctx = tex.getContext();
  ctx.clearRect(0, 0, size, size);
  const blank = ctx.createImageData(size, size);
  ctx.putImageData(blank, 0, 0);
  tex.refresh();
  return key;
}
