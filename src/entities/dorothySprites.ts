import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getMeasuredFeetFrame } from './dorothyFeet';

/**
 * Dorothy sprites — NEW 8-way loco (walk/run/jump) + East/West idle + Light1 attack.
 * Idle: East pack for any *East* facing + South; West pack for any *West* facing + North.
 * Entering idle realigns facing to left (West) or right (East).
 * Masters stay under `masters/dorothy/Sprites/` — never load those at runtime.
 */

/** NEW compass packs: Walk / Run / Jump. */
export const SPRITES_NEW_BASE = 'models/dorothy/Sprites/NEW';

/** 8-way Light 1 attack multi-atlases (512² source, TexturePacker). */
export const SPRITES_LIGHT1_BASE = 'models/dorothy/Sprites/Attacks/Light1';

/** Playback FPS for Dorothy sprite anims (walk / run / jump / idle / light1). */
const DOROTHY_ANIM_FPS = 42;

/** Playback multiplier — 1 = play at DOROTHY_ANIM_FPS with no speedup. */
export const DOROTHY_ANIM_TIME_SCALE = 1;
/** Run uses the same rate as other loco clips. */
export const DOROTHY_RUN_ANIM_TIME_SCALE = 1;
/** Jump plays faster so the clip matches the physics arc. */
export const DOROTHY_JUMP_ANIM_TIME_SCALE = 1.5;

/**
 * NEW packs share a 460² source with transparent pad under the soles (~53px).
 * Origin at 1.0 floats her — pin every clip to this authored sole line in
 * SOURCE space (Phaser adds trim offsets when atlases are auto-trimmed).
 */
const DOROTHY_NEW_FEET_ORIGIN_Y = 407 / 460;

/** 8-way facing (floor: +x east/right, +y toward camera / front). */
export type DorothyWalkDir = 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw' | 's' | 'se';
export type DorothySide = 'left' | 'right';
/** Two idle packs — East (right) / West (left). */
export type DorothyIdleSide = 'e' | 'w';

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

/**
 * Authored idle packs live under East/Idle and West/Idle.
 * TexturePacker frame names still use se/sw prefixes from the export camera.
 */
const IDLE_PACKS: readonly {
  side: DorothyIdleSide;
  folder: string;
  framePrefix: string;
}[] = [
  { side: 'e', folder: 'East', framePrefix: 'dorothy_se_idle_' },
  { side: 'w', folder: 'West', framePrefix: 'dorothy_sw_idle_' },
] as const;

const IDLE_FRAME_RATE = DOROTHY_ANIM_FPS;

const LOCO_ANIMS = ['Walk', 'Run', 'Jump'] as const;
type LocoAnim = (typeof LOCO_ANIMS)[number];

const WALK_FRAME_RATE = DOROTHY_ANIM_FPS;
const RUN_FRAME_RATE = DOROTHY_ANIM_FPS;
const JUMP_FRAME_RATE = DOROTHY_ANIM_FPS;

/**
 * Jump packs still include a crouch lead-in before takeoff. Physics launches on
 * press — start the anim at takeoff so she isn't airborne while crouching.
 * (Not a scale/Y compensation; height comes from engine `z` only.)
 */
export const DOROTHY_JUMP_START_FRAME = 34;

export const DOROTHY_DEFAULT_WALK_DIR: DorothyWalkDir = 'e';
/** First frame of NEW East Idle — spawn pose. */
export const DOROTHY_IDLE_FRAME = 'dorothy_se_idle_0000.png';
/** @deprecated Prefer DOROTHY_IDLE_FRAME; kept for older call sites. */
export const DOROTHY_WALK_IDLE_FRAME = DOROTHY_IDLE_FRAME;
export const DOROTHY_SOURCE_EDGE_PX = 460;
/** Light1 attack packs are authored at 512². */
export const DOROTHY_LIGHT1_SOURCE_EDGE_PX = 512;
/** Light1 frame count (TexturePacker export) — duration = frames / fps. */
export const DOROTHY_LIGHT1_FRAME_COUNT = 69;
export const DOROTHY_LIGHT1_FRAME_RATE = DOROTHY_ANIM_FPS; // 42 — authored export rate
/**
 * Playback speed so the 69-frame @ 42 fps clip lands in `kick1DurationMs` (800 ms).
 * timeScale = (69/42) / 0.8 ≈ 2.054
 */
export const DOROTHY_LIGHT1_ANIM_TIME_SCALE =
  DOROTHY_LIGHT1_FRAME_COUNT / DOROTHY_LIGHT1_FRAME_RATE / 0.8;

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

export function dorothyLight1AtlasKey(dir: DorothyWalkDir): string {
  return `dorothy-light1-${dir}`;
}

export function dorothyLight1AnimKey(dir: DorothyWalkDir): string {
  return `dorothy-light1-${dir}`;
}

/** Floor-space aim angle for an 8-way attack (matches dorothyWalkDirFromMove). */
export function dorothyAimRadFromDir(dir: DorothyWalkDir): number {
  const idx = OCTANTS.indexOf(dir);
  return ((idx >= 0 ? idx : 0) * Math.PI) / 4;
}

export function dorothyJumpShouldMirror(_dir: DorothyWalkDir): boolean {
  return false;
}

export function dorothyIdleAtlasKey(side: DorothyIdleSide = 'e'): string {
  return `dorothy-idle-${side}`;
}

export function dorothyIdleAnimKey(side: DorothyIdleSide = 'e'): string {
  return `dorothy-idle-${side}`;
}

/**
 * East idle: any facing whose name contains East, plus South.
 * West idle: any facing whose name contains West, plus North.
 */
export function dorothyIdleSideFromDir(dir: DorothyWalkDir): DorothyIdleSide {
  if (dir === 'e' || dir === 'ne' || dir === 'se' || dir === 's') return 'e';
  return 'w';
}

/** After idle starts, snap loco facing to pure East or West. */
export function dorothyIdleRealignDir(side: DorothyIdleSide): DorothyWalkDir {
  return side;
}

export function dorothyIdleFacing(side: DorothyIdleSide): 1 | -1 {
  return side === 'e' ? 1 : -1;
}

/** East/West idle atlases are already sided — never mirror. */
export function dorothyIdleShouldMirror(_dir: DorothyWalkDir): boolean {
  return false;
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
 * Shared canvas → world base scale. Loco packs are 460²; Light1 canvases are
 * 512² but the figure is authored at the same visual size as loco — always
 * scale from the 460 reference so kick matches idle height.
 */
export function dorothyBaseScale(sourceEdgePx: number = DOROTHY_SOURCE_EDGE_PX): number {
  return tuning.playerSpriteHeight / Math.max(1, sourceEdgePx);
}

export function dorothyBaseScaleForSprite(
  sprite: Phaser.GameObjects.Sprite | null | undefined,
): number {
  // Light1 512² packs: keep loco on-screen height (114/460), not 114/512.
  if (sprite?.texture.key.startsWith('dorothy-light1-')) {
    return dorothyBaseScale(DOROTHY_SOURCE_EDGE_PX);
  }
  if (!sprite?.frame) return dorothyBaseScale();
  const h = Math.max(1, sprite.frame.realHeight || sprite.frame.height);
  return dorothyBaseScale(h);
}

/** @deprecated Prefer dorothyBaseScale — atlas key no longer affects scale. */
export function dorothyWorldScale(_atlasKey?: string): number {
  return dorothyBaseScale();
}

export function applyDorothyAnimTimeScale(
  sprite: Phaser.GameObjects.Sprite,
  timeScale: number = DOROTHY_ANIM_TIME_SCALE,
): void {
  sprite.anims.timeScale = timeScale;
}

function timeScaleForAnimKey(key: string): number {
  if (key.startsWith('dorothy-light1-')) return DOROTHY_LIGHT1_ANIM_TIME_SCALE;
  if (key.startsWith('dorothy-run-')) return DOROTHY_RUN_ANIM_TIME_SCALE;
  return DOROTHY_ANIM_TIME_SCALE;
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

/** Light1 attack — always 42 fps (frameRate + timeScale 1). */
export function playDorothyLight1Anim(
  sprite: Phaser.GameObjects.Sprite,
  key: string,
): void {
  if (sprite.anims.currentAnim?.key !== key) {
    sprite.play(key, false);
  }
  applyDorothyAnimTimeScale(sprite, DOROTHY_LIGHT1_ANIM_TIME_SCALE);
}

/** Jump: skip crouch lead-in so takeoff matches physics launch. */
export function playDorothyJumpAnim(sprite: Phaser.GameObjects.Sprite, key: string): void {
  sprite.play({ key, startFrame: DOROTHY_JUMP_START_FRAME });
  applyDorothyAnimTimeScale(sprite, DOROTHY_JUMP_ANIM_TIME_SCALE);
}

function newLocoUrl(compass: string, anim: LocoAnim): string {
  return `${SPRITES_NEW_BASE}/${encodeURIComponent(compass)}/Traversal/${anim}/${encodeURIComponent(`${anim}.json`)}`;
}

function newLocoPath(compass: string, anim: LocoAnim): string {
  return `${SPRITES_NEW_BASE}/${encodeURIComponent(compass)}/Traversal/${anim}/`;
}

function newIdleUrl(compass: string): string {
  return `${SPRITES_NEW_BASE}/${encodeURIComponent(compass)}/Idle/${encodeURIComponent('Idle.json')}`;
}

function newIdlePath(compass: string): string {
  return `${SPRITES_NEW_BASE}/${encodeURIComponent(compass)}/Idle/`;
}

/**
 * Light1 TexturePacker exports keep a “skip” stem from the exporter template —
 * frame filenames inside are `dorothy_{dir}_attack_light_1_####.png`.
 */
const LIGHT1_PACKS: readonly {
  dir: DorothyWalkDir;
  folder: string;
  stem: string;
}[] = [
  { dir: 'e', folder: 'e', stem: 'dorothy_e_skip_512px_42fps' },
  { dir: 'se', folder: 'se', stem: 'dorothy_se_skip_512px_42fps' },
  { dir: 's', folder: 's', stem: 'dorothy_s_skip_512px_42fps' },
  { dir: 'sw', folder: 'sw', stem: 'dorothy_sw_skip_512px_42fps' },
  { dir: 'w', folder: 'w', stem: 'dorothy_w_skip_512px_42fps' },
  { dir: 'nw', folder: 'nw', stem: 'dorothy_nw_skip_512px_42fps' },
  { dir: 'n', folder: 'n', stem: 'dorothy_n_skip_512px_42fps' },
  { dir: 'ne', folder: 'ne', stem: 'dorothy_ne_skip_512px_42fps' },
] as const;

function light1Url(folder: string, stem: string): string {
  return `${SPRITES_LIGHT1_BASE}/${folder}/${stem}.json`;
}

function light1Path(folder: string): string {
  return `${SPRITES_LIGHT1_BASE}/${folder}/`;
}

function light1FramePrefix(dir: DorothyWalkDir): string {
  return `dorothy_${dir}_attack_light_1_`;
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
 */
const MISSING_NEW_LOCO: ReadonlySet<string> = new Set();

/** Queue NEW walk/run/jump (8-way) + East/West idle + Light1 (8-way). */
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
  for (const { side, folder } of IDLE_PACKS) {
    scene.load.multiatlas(
      dorothyIdleAtlasKey(side),
      newIdleUrl(folder),
      newIdlePath(folder),
    );
  }
  for (const { dir, folder, stem } of LIGHT1_PACKS) {
    scene.load.multiatlas(
      dorothyLight1AtlasKey(dir),
      light1Url(folder, stem),
      light1Path(folder),
    );
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
  }

  for (const { side, framePrefix } of IDLE_PACKS) {
    createAnimFromAtlasFrames(
      scene,
      dorothyIdleAnimKey(side),
      dorothyIdleAtlasKey(side),
      framePrefix,
      IDLE_FRAME_RATE,
      -1,
    );
  }

  for (const { dir } of LIGHT1_PACKS) {
    createAnimFromAtlasFrames(
      scene,
      dorothyLight1AnimKey(dir),
      dorothyLight1AtlasKey(dir),
      light1FramePrefix(dir),
      DOROTHY_LIGHT1_FRAME_RATE,
      0,
    );
  }
}

export function dorothySpritesReady(scene: Phaser.Scene): boolean {
  return (
    scene.textures.exists(dorothyWalkAtlasKey(DOROTHY_DEFAULT_WALK_DIR)) &&
    scene.textures.exists(dorothyIdleAtlasKey('e'))
  );
}

export function dorothyAnimExists(scene: Phaser.Scene, key: string): boolean {
  return scene.anims.exists(key);
}

/**
 * Feet pivot for every frame.
 *
 * Phaser displayOrigin uses realHeight (sourceSize). The renderer then offsets
 * by frame.y/x (spriteSourceSize) for auto-trimmed atlases — so the sole line
 * must stay in SOURCE space for both trimmed and untrimmed 460² packs.
 *
 * Idle E/W packs are SE/SW camera poses: body mass sits slightly toward the
 * facing side of the frame. Plant on measured bodyNx so she doesn't look
 * leaned off the floor contact; sole FX still use measured feet nx.
 */
export function applyDorothyFeetOrigin(sprite: Phaser.GameObjects.Sprite): void {
  const frame = sprite.frame;
  const sourceH = Math.max(1, frame.realHeight || frame.height);
  const isIdle = sprite.texture.key.startsWith('dorothy-idle-');
  const isLight1 = sprite.texture.key.startsWith('dorothy-light1-');
  const originX = isIdle
    ? Phaser.Math.Clamp(getMeasuredFeetFrame(sprite).bodyNx, 0.3, 0.7)
    : 0.5;

  // Light1 is 512² but shares the NEW sole ratio — plant like loco, not trim-bottom.
  if (isLight1 || Math.abs(sourceH - DOROTHY_SOURCE_EDGE_PX) < 2) {
    sprite.setOrigin(originX, DOROTHY_NEW_FEET_ORIGIN_Y);
    return;
  }

  // Non-standard source: plant at bottom of opaque (trim bottom) or canvas.
  if (frame.trimmed) {
    const soleInSource = (frame.y || 0) + (frame.cutHeight || frame.height);
    sprite.setOrigin(originX, Phaser.Math.Clamp(soleInSource / sourceH, 0.55, 1));
    return;
  }
  sprite.setOrigin(originX, 1);
}

export const DOROTHY_WALK_ATLAS = dorothyWalkAtlasKey(DOROTHY_DEFAULT_WALK_DIR);
export const DOROTHY_WALK_ANIM = dorothyWalkAnimKey(DOROTHY_DEFAULT_WALK_DIR);
