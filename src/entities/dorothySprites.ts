import Phaser from 'phaser';
import { tuning } from '../config/tuning';

/**
 * Dorothy sprites — NEW 8-way locomotion packs for walk/run/jump.
 * Idle uses frame 0 of the matching NEW Walk atlas (no separate NEW idle yet).
 * Masters stay under `masters/dorothy/Sprites/` — never load those at runtime.
 */

/** NEW compass packs: Walk / Run / Jump. */
export const SPRITES_NEW_BASE = 'models/dorothy/Sprites/NEW';

/** NEW packs authored/exported at this FPS in 3D Studio. */
const DOROTHY_SOURCE_FPS = 30;

/** Playback multiplier on top of source FPS (walk / idle / jump). */
export const DOROTHY_ANIM_TIME_SCALE = 1.75;
/** Run plays a bit slower than other loco clips. */
export const DOROTHY_RUN_ANIM_TIME_SCALE = 1.5;

/**
 * NEW packs are untrimmed 460² with transparent pad under the soles (~53px).
 * Origin at 1.0 floats her — pin every ground/jump frame to this authored sole line.
 * Do NOT chase per-frame opaque bounds: N/S perspective makes soles bounce and
 * looks like a size pulse.
 */
const DOROTHY_NEW_FEET_ORIGIN_Y = 407 / 460;

/** Jump silhouettes fill more of the 460² box — constant shrink only. */
const DOROTHY_JUMP_SCALE_NORM = 0.86;

/** N/S walk silhouettes read tall in the shared 460² box. */
const ATLAS_SIZE_MUL: Readonly<Record<string, number>> = {
  'dorothy-walk-n': 0.93,
  'dorothy-walk-s': 0.93,
};

/** 8-way facing (floor: +x east/right, +y toward camera / front). */
export type DorothyWalkDir = 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw' | 's' | 'se';
export type DorothySide = 'left' | 'right';

const COMPASS: readonly { dir: DorothyWalkDir; folder: string }[] = [
  { dir: 'e', folder: 'East' },
  { dir: 'se', folder: 'Southeast' },
  { dir: 's', folder: 'South' },
  { dir: 'sw', folder: 'Southwest' },
  { dir: 'w', folder: 'West' },
  { dir: 'nw', folder: 'Northwest' },
  { dir: 'n', folder: 'North' },
  { dir: 'ne', folder: 'Northeast' },
] as const;

const LOCO_ANIMS = ['Walk', 'Run', 'Jump'] as const;
type LocoAnim = (typeof LOCO_ANIMS)[number];

const WALK_FRAME_RATE = DOROTHY_SOURCE_FPS;
const RUN_FRAME_RATE = DOROTHY_SOURCE_FPS;
const JUMP_FRAME_RATE = DOROTHY_SOURCE_FPS;

/**
 * NEW Jump clips include a crouch anticipation (~34 frames) before feet leave
 * the ground. Physics launches on button press — start the anim at takeoff so
 * she isn't airborne while still crouching on-screen.
 */
export const DOROTHY_JUMP_START_FRAME = 34;

export const DOROTHY_DEFAULT_WALK_DIR: DorothyWalkDir = 'e';
/** First frame of NEW East Walk — used as spawn / idle pose. */
export const DOROTHY_WALK_IDLE_FRAME = 'dorothy_e_walk_0000.png';
export const DOROTHY_SOURCE_EDGE_PX = 460;

const OCTANTS: readonly DorothyWalkDir[] = [
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
  'n',
  'ne',
];

export function dorothyWalkAtlasKey(dir: DorothyWalkDir): string {
  return `dorothy-walk-${dir}`;
}

export function dorothyWalkAnimKey(dir: DorothyWalkDir): string {
  return `dorothy-walk-${dir}`;
}

export function dorothyRunAtlasKey(dir: DorothyWalkDir): string {
  return `dorothy-run-${dir}`;
}

export function dorothyRunAnimKey(dir: DorothyWalkDir): string {
  return `dorothy-run-${dir}`;
}

export function dorothyJumpAtlasKey(dir: DorothyWalkDir): string {
  return `dorothy-jump-${dir}`;
}

export function dorothyJumpAnimKey(dir: DorothyWalkDir): string {
  return `dorothy-jump-${dir}`;
}

export function dorothyJumpShouldMirror(_dir: DorothyWalkDir): boolean {
  return false;
}

export function dorothyIdleAnimKey(dir: DorothyWalkDir = DOROTHY_DEFAULT_WALK_DIR): string {
  return `dorothy-idle-${dir}`;
}

/** Idle uses 8-way NEW walk frame 0 — never mirror. */
export function dorothyIdleShouldMirror(_dir: DorothyWalkDir): boolean {
  return false;
}

export function dorothyIdleFrameName(dir: DorothyWalkDir): string {
  return `dorothy_${dir}_walk_0000.png`;
}

export function dorothyWalkDirFromMove(x: number, y: number): DorothyWalkDir {
  if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) return DOROTHY_DEFAULT_WALK_DIR;
  const step = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  const idx = ((step % 8) + 8) % 8;
  return OCTANTS[idx]!;
}

export function dorothySideFromDir(
  dir: DorothyWalkDir,
  fallbackFacing: 1 | -1,
): DorothySide {
  if (dir === 'e' || dir === 'ne' || dir === 'se') return 'right';
  if (dir === 'w' || dir === 'nw' || dir === 'sw') return 'left';
  return fallbackFacing < 0 ? 'left' : 'right';
}

/**
 * Canvas → world scale. Most walk/run at 1×; N/S walk slightly shrunk.
 * Jump uses a constant shrink only.
 */
export function dorothyWorldScale(atlasKey: string): number {
  const base = tuning.playerSpriteHeight / DOROTHY_SOURCE_EDGE_PX;
  const sizeMul = ATLAS_SIZE_MUL[atlasKey] ?? 1;
  const jumpMul = atlasKey.startsWith('dorothy-jump-') ? DOROTHY_JUMP_SCALE_NORM : 1;
  return base * sizeMul * jumpMul;
}

export function applyDorothyAnimTimeScale(
  sprite: Phaser.GameObjects.Sprite,
  timeScale: number = DOROTHY_ANIM_TIME_SCALE,
): void {
  sprite.anims.timeScale = timeScale;
}

function timeScaleForAnimKey(key: string): number {
  return key.startsWith('dorothy-run-')
    ? DOROTHY_RUN_ANIM_TIME_SCALE
    : DOROTHY_ANIM_TIME_SCALE;
}

/** Play a Dorothy anim and apply the correct timeScale (play can reset it). */
export function playDorothyAnim(
  sprite: Phaser.GameObjects.Sprite,
  key: string,
  ignoreIfPlaying = true,
): void {
  sprite.play(key, ignoreIfPlaying);
  applyDorothyAnimTimeScale(sprite, timeScaleForAnimKey(key));
}

/** Jump: skip crouch lead-in so takeoff matches physics launch. */
export function playDorothyJumpAnim(sprite: Phaser.GameObjects.Sprite, key: string): void {
  sprite.play({ key, startFrame: DOROTHY_JUMP_START_FRAME });
  applyDorothyAnimTimeScale(sprite, DOROTHY_ANIM_TIME_SCALE);
}

function newLocoUrl(compass: string, anim: LocoAnim): string {
  return `${SPRITES_NEW_BASE}/${encodeURIComponent(compass)}/Traversal/${anim}/${encodeURIComponent(`${anim}.json`)}`;
}

function newLocoPath(compass: string, anim: LocoAnim): string {
  return `${SPRITES_NEW_BASE}/${encodeURIComponent(compass)}/Traversal/${anim}/`;
}

function atlasKeyFor(anim: LocoAnim, dir: DorothyWalkDir): string {
  return `dorothy-${anim.toLowerCase()}-${dir}`;
}

function framePrefixFor(anim: LocoAnim, dir: DorothyWalkDir): string {
  return `dorothy_${dir}_${anim.toLowerCase()}_`;
}

function createAnimFromAtlasFrames(
  scene: Phaser.Scene,
  key: string,
  atlas: string,
  prefix: string,
  frameRate: number,
  repeat: number,
): void {
  if (!scene.textures.exists(atlas) || scene.anims.exists(key)) return;
  const names = scene.textures
    .get(atlas)
    .getFrameNames()
    .filter((n) => n.startsWith(prefix) && n.endsWith('.png'))
    .sort();
  if (names.length === 0) return;
  scene.anims.create({
    key,
    frames: names.map((frame) => ({ key: atlas, frame })),
    frameRate,
    repeat,
  });
}

/**
 * Incomplete NEW loco packs skipped at preload (empty = all present).
 * Previously: North Walk / South Walk pending re-export.
 */
const MISSING_NEW_LOCO: ReadonlySet<string> = new Set();

/** Queue NEW walk/run/jump (8-way). Idle = walk frame 0 per dir. */
export function preloadDorothySprites(scene: Phaser.Scene): void {
  for (const { dir, folder } of COMPASS) {
    for (const anim of LOCO_ANIMS) {
      if (MISSING_NEW_LOCO.has(`${dir}:${anim}`)) continue;
      scene.load.multiatlas(
        atlasKeyFor(anim, dir),
        newLocoUrl(folder, anim),
        newLocoPath(folder, anim),
      );
    }
  }
}

/** Register animations once textures exist. */
export function ensureDorothyAnims(scene: Phaser.Scene): void {
  for (const { dir } of COMPASS) {
    const walkAtlas = dorothyWalkAtlasKey(dir);
    const runAtlas = dorothyRunAtlasKey(dir);
    const jumpAtlas = dorothyJumpAtlasKey(dir);

    createAnimFromAtlasFrames(
      scene,
      dorothyWalkAnimKey(dir),
      walkAtlas,
      framePrefixFor('Walk', dir),
      WALK_FRAME_RATE,
      -1,
    );
    createAnimFromAtlasFrames(
      scene,
      dorothyRunAnimKey(dir),
      runAtlas,
      framePrefixFor('Run', dir),
      RUN_FRAME_RATE,
      -1,
    );
    createAnimFromAtlasFrames(
      scene,
      dorothyJumpAnimKey(dir),
      jumpAtlas,
      framePrefixFor('Jump', dir),
      JUMP_FRAME_RATE,
      0,
    );

    // Idle hold: first NEW Walk frame for this facing (matches outline style).
    const idleKey = dorothyIdleAnimKey(dir);
    const idleFrame = dorothyIdleFrameName(dir);
    if (
      scene.textures.exists(walkAtlas) &&
      scene.textures.get(walkAtlas).has(idleFrame) &&
      !scene.anims.exists(idleKey)
    ) {
      scene.anims.create({
        key: idleKey,
        frames: [{ key: walkAtlas, frame: idleFrame }],
        frameRate: 1,
        repeat: -1,
      });
    }
  }
}

export function dorothySpritesReady(scene: Phaser.Scene): boolean {
  // East Walk is the spawn/idle atlas; other dirs may still be pending re-export.
  return scene.textures.exists(dorothyWalkAtlasKey(DOROTHY_DEFAULT_WALK_DIR));
}

export function dorothyAnimExists(scene: Phaser.Scene, key: string): boolean {
  return scene.anims.exists(key);
}

/**
 * TexturePacker keeps transparent pad in the source square. Phaser origins use
 * that full box, so originY=1 floats Dorothy. Fixed pad origin for every anim —
 * no per-frame opaque chase (that reads as bob/pulse on N/S).
 */
export function applyDorothyFeetOrigin(sprite: Phaser.GameObjects.Sprite): void {
  const frame = sprite.frame;
  const realH = Math.max(1, frame.realHeight || frame.height);
  const fillsSource = frame.y <= 1 && frame.height >= realH - 1;
  const feetFromTop = fillsSource
    ? realH * DOROTHY_NEW_FEET_ORIGIN_Y
    : frame.y + frame.height;
  sprite.setOrigin(0.5, Phaser.Math.Clamp(feetFromTop / realH, 0.55, 1));
}

export const DOROTHY_WALK_ATLAS = dorothyWalkAtlasKey(DOROTHY_DEFAULT_WALK_DIR);
export const DOROTHY_WALK_ANIM = dorothyWalkAnimKey(DOROTHY_DEFAULT_WALK_DIR);
