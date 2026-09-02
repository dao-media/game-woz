import Phaser from 'phaser';
import { tuning } from '../config/tuning';

export const GROUND_BURST_TEXTURE = 'ground-burst-sheet';
export const GROUND_BURST_ANIM = 'ground-burst-pop';

const FX_BASE = 'fx/ground-burst';

/** One-shot burst duration from played frame count + rate (ms). */
export function groundBurstDurationMs(): number {
  const played = Math.max(
    1,
    tuning.groundBurstFrameCount - tuning.groundBurstAnimStartFrame,
  );
  const scale = Math.max(tuning.groundBurstTimeScale, 0.01);
  return ((played / tuning.groundBurstFrameRate) * 1000) / scale;
}

/** Queue the horizontal 10-frame RGBA ground burst sheet. */
export function preloadGroundBurst(scene: Phaser.Scene): void {
  scene.load.spritesheet(GROUND_BURST_TEXTURE, `${FX_BASE}/ground_burst_sheet.png`, {
    frameWidth: tuning.groundBurstFrameWidth,
    frameHeight: tuning.groundBurstFrameHeight,
  });
}

/** Register the one-shot pop animation after textures load. Returns false if asset missing. */
export function ensureGroundBurstAnim(scene: Phaser.Scene): boolean {
  if (!scene.textures.exists(GROUND_BURST_TEXTURE)) {
    console.warn('[groundBurst] texture missing — burst disabled');
    return false;
  }

  const tex = scene.textures.get(GROUND_BURST_TEXTURE);
  const frameTotal = tex.frameTotal;
  if (frameTotal <= 0) {
    console.warn('[groundBurst] texture has no frames — burst disabled');
    return false;
  }

  const source = tex.getSourceImage() as HTMLImageElement | undefined;
  const expectedW = tuning.groundBurstFrameWidth * tuning.groundBurstFrameCount;
  if (source && (source.width < expectedW || source.height < tuning.groundBurstFrameHeight)) {
    console.warn(
      `[groundBurst] sheet size ${source.width}×${source.height} — expected ≥${expectedW}×${tuning.groundBurstFrameHeight}`,
    );
  }

  const end = Math.min(
    Math.max(0, tuning.groundBurstFrameCount - 1),
    frameTotal - 1,
  );
  const start = Phaser.Math.Clamp(
    tuning.groundBurstAnimStartFrame,
    0,
    end,
  );
  const frames = scene.anims.generateFrameNumbers(GROUND_BURST_TEXTURE, {
    start,
    end,
  });

  if (frames.length === 0) {
    console.warn('[groundBurst] no animation frames — burst disabled');
    return false;
  }

  // Recreate when tuning start/end changes (warmFx may have registered an older range).
  if (scene.anims.exists(GROUND_BURST_ANIM)) {
    scene.anims.remove(GROUND_BURST_ANIM);
  }

  scene.anims.create({
    key: GROUND_BURST_ANIM,
    frames,
    frameRate: tuning.groundBurstFrameRate,
    repeat: 0,
  });

  return true;
}
