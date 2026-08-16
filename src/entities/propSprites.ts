import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { plantOnGround } from '../core/Placement';

/**
 * Runtime prop pack (derived). Masters stay under `masters/` — never load those.
 * Drop a rendered post here and it replaces the procedural wood without
 * touching placement/sort.
 *
 * - Atlas: `models/props/game/props.png` + `props.json`, frame `post` or `post.png`
 * - Or a single image: `models/props/game/post.png`
 */
export const PROP_ATLAS_KEY = 'props';
export const PROP_POST_FRAME = 'post';
export const PROP_POST_IMAGE_KEY = 'prop-post';

const PROP_GAME_DIR = 'models/props/game';

export function preloadPropSprites(scene: Phaser.Scene): void {
  scene.load.atlas(
    PROP_ATLAS_KEY,
    `${PROP_GAME_DIR}/props.png`,
    `${PROP_GAME_DIR}/props.json`,
  );
  scene.load.image(PROP_POST_IMAGE_KEY, `${PROP_GAME_DIR}/post.png`);
}

/**
 * Roadside post: authored atlas/image if present, else a greybox.
 * Does not use procedural fence wood — YBR fence tiles come only from
 * photos/Environment/Fencing.
 */
export function createPostVisual(
  scene: Phaser.Scene,
  greyboxColor: number,
): Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle {
  const key = postSpriteKey(scene);
  if (key) {
    const sprite =
      key.frame !== undefined
        ? scene.add.sprite(0, 0, key.texture, key.frame)
        : scene.add.sprite(0, 0, key.texture);
    plantOnGround(sprite);
    return sprite;
  }

  const rect = scene.add.rectangle(
    0,
    0,
    tuning.postGreyboxWidth,
    tuning.postGreyboxHeight,
    greyboxColor,
  );
  plantOnGround(rect);
  return rect;
}

function postSpriteKey(
  scene: Phaser.Scene,
): { texture: string; frame?: string } | null {
  if (scene.textures.exists(PROP_ATLAS_KEY)) {
    const atlas = scene.textures.get(PROP_ATLAS_KEY);
    if (atlas.has(PROP_POST_FRAME)) {
      return { texture: PROP_ATLAS_KEY, frame: PROP_POST_FRAME };
    }
    const pngFrame = `${PROP_POST_FRAME}.png`;
    if (atlas.has(pngFrame)) {
      return { texture: PROP_ATLAS_KEY, frame: pngFrame };
    }
  }
  if (scene.textures.exists(PROP_POST_IMAGE_KEY)) {
    return { texture: PROP_POST_IMAGE_KEY };
  }
  return null;
}
