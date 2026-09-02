import Phaser from 'phaser';
import { tuning } from '../config/tuning';

export const GROUND_RADIAL_TEXTURE = 'ground-radial-sheet';
export const GROUND_RADIAL_ANIM = 'ground-radial-pop';
export const RADIAL_POWERUP_TEXTURE = 'radial-powerup-sheet';
export const RADIAL_POWERUP_ANIM = 'radial-powerup-loop';

export const OPTIONAL_FX_TEXTURES = [
  GROUND_RADIAL_TEXTURE,
  RADIAL_POWERUP_TEXTURE,
] as const;

/** Queue optional radial sheets (preloaded + warmed; not wired to gameplay yet). */
export function preloadOptionalFx(scene: Phaser.Scene): void {
  scene.load.spritesheet(
    GROUND_RADIAL_TEXTURE,
    'fx/ground-radial/ground_radial_sheet.png',
    {
      frameWidth: tuning.groundRadialFrameWidth,
      frameHeight: tuning.groundRadialFrameHeight,
    },
  );
  scene.load.spritesheet(
    RADIAL_POWERUP_TEXTURE,
    'fx/radial-powerup/radial_powerup_sheet.png',
    {
      frameWidth: tuning.radialPowerupFrameWidth,
      frameHeight: tuning.radialPowerupFrameHeight,
    },
  );
}

export function ensureOptionalFxAnims(scene: Phaser.Scene): void {
  registerStripAnim(
    scene,
    GROUND_RADIAL_TEXTURE,
    GROUND_RADIAL_ANIM,
    tuning.groundRadialFrameCount,
    tuning.groundRadialFrameRate,
  );
  registerStripAnim(
    scene,
    RADIAL_POWERUP_TEXTURE,
    RADIAL_POWERUP_ANIM,
    tuning.radialPowerupFrameCount,
    tuning.radialPowerupFrameRate,
  );
}

function registerStripAnim(
  scene: Phaser.Scene,
  textureKey: string,
  animKey: string,
  frameCount: number,
  frameRate: number,
): void {
  if (scene.anims.exists(animKey)) return;
  if (!scene.textures.exists(textureKey)) return;

  const tex = scene.textures.get(textureKey);
  const end = Math.min(Math.max(0, frameCount - 1), tex.frameTotal - 1);
  const frames = scene.anims.generateFrameNumbers(textureKey, { start: 0, end });
  if (frames.length === 0) return;

  scene.anims.create({ key: animKey, frames, frameRate, repeat: 0 });
}
