/** Built-in clip libraries for 3D Studio character families. */

export type StudioFamilyId = 'dorothy' | 'wingedmonkey';

export type CatalogClip = {
  id: string;
  label: string;
  url: string;
  kind: 'fbx' | 'glb';
  /** Character family this clip belongs to — never cross-load. */
  family: StudioFamilyId;
  /** Which bind/remap path to use when loading. */
  rig: 'mixamo_char' | 'tripo' | 'any' | 'wingedmonkey';
};

const MIXAMO_BAKED = './models/dorothy/Animations/mixamo_character';
/** Optimized Walk/Run/Jump/Idle for the clip library (masters untouched). */
const MIXAMO_STUDIO = './models/dorothy/Animations/studio';
const TRIPO_BASE = './models/dorothy/Animations';
const MONKEY_GARGOYLE = './models/wingedmonkey/Animations/gargoyle';

/**
 * Clips baked onto MASTER in Blender (Copy Rotation + visual keying).
 * These share MASTER's bind/Armature space — no runtime SkeletonUtils needed.
 */
type MixamoCatalogEntry = {
  file: string;
  label: string;
  /** Defaults to mixamo_character/. Use studio/ for optimized locomotion. */
  base?: 'mixamo' | 'studio' | 'animations';
  kind?: 'fbx' | 'glb';
};

const MIXAMO_CHAR_FILES: MixamoCatalogEntry[] = [
  { file: 'Jump.glb', label: 'Jump', base: 'studio' },
  { file: 'Idle.glb', label: 'Idle', base: 'studio' },
  { file: 'Wave.glb', label: 'Wave' },
  { file: 'Fighting_stance.glb', label: 'Fighting Stance' },
  { file: 'Traversal_walk.glb', label: 'Walk', base: 'studio' },
  { file: 'Traversal_run.glb', label: 'Run', base: 'studio' },
  { file: 'Traversal_skip.glb', label: 'Skip', base: 'studio' },
  { file: 'Traversal_turn.glb', label: 'Turn' },
  { file: 'Traversal_idle_to_walk.glb', label: 'Idle → Walk' },
  {
    file: 'Traversal_idle-to-walk_dorothy.glb',
    label: 'Idle → Walk (Dorothy)',
    base: 'animations',
  },
  { file: 'Attack_light1.glb', label: 'Attack Light 1' },
  { file: 'Attack_light2.glb', label: 'Attack Light 2' },
  { file: 'Attack_light3.glb', label: 'Attack Light 3' },
  { file: 'Attack_light4.glb', label: 'Attack Light 4' },
  { file: 'Attack_light4_spinkick.glb', label: 'Spin Kick' },
  { file: 'Attack_side_kick.glb', label: 'Side Kick' },
  { file: 'Attack_heavy1.glb', label: 'Attack Heavy 1' },
  { file: 'Attack_heavy2.glb', label: 'Attack Heavy 2' },
  { file: 'Attack_heavy3.glb', label: 'Attack Heavy 3' },
  { file: 'Attack_ultimate.glb', label: 'Ultimate' },
  { file: 'Attack_powerful_spell.glb', label: 'Powerful Spell' },
  { file: 'Pose_braced_for_attack.glb', label: 'Braced Pose' },
  /** Raw Mixamo FBX (same bind as MASTER) — listed so Jump.fbx is visible by name. */
  { file: 'Jump.fbx', label: 'Jump (FBX)', base: 'animations', kind: 'fbx' },
  {
    file: 'Fighting stance.fbx',
    label: 'Fighting Stance (FBX)',
    base: 'animations',
    kind: 'fbx',
  },
];

const TRIPO_FILES: { file: string; label: string }[] = [
  { file: 'Traversal_walk_dorothy.glb', label: 'Walk (Tripo)' },
  { file: 'Traversal_run_dorothy.glb', label: 'Run (Tripo)' },
  { file: 'Traversal_turn_dorothy.glb', label: 'Turn (Tripo)' },
  { file: 'Traversal_idle-to-walk_dorothy.glb', label: 'Idle → Walk' },
];

/** Gargoyle → winged monkey bake (scripts/bake_gargoyle_to_winged_monkey.py). */
const MONKEY_GARGOYLE_FILES: { file: string; label: string }[] = [
  { file: 'Idle.glb', label: 'Idle' },
  { file: 'IdleBreak.glb', label: 'Idle Break' },
  { file: 'Walk.glb', label: 'Walk' },
  { file: 'WalkBackward.glb', label: 'Walk Backward' },
  { file: 'Attack01.glb', label: 'Attack 01' },
  { file: 'Attack02.glb', label: 'Attack 02' },
  { file: 'Cast01.glb', label: 'Cast 01' },
  { file: 'Cast02.glb', label: 'Cast 02' },
  { file: 'Cast03.glb', label: 'Cast 03' },
  { file: 'Sheild01.glb', label: 'Shield 01' },
  { file: 'Sheild02.glb', label: 'Shield 02' },
  { file: 'Sheild03.glb', label: 'Shield 03' },
  { file: 'Hit.glb', label: 'Hit' },
  { file: 'DeathStanding.glb', label: 'Death (Standing)' },
  { file: 'Statue01.glb', label: 'Statue 01' },
  { file: 'Statue02.glb', label: 'Statue 02' },
  { file: 'Statue03.glb', label: 'Statue 03' },
  { file: 'GroundToFly.glb', label: 'Ground → Fly' },
  { file: 'IdleToFly.glb', label: 'Idle → Fly' },
  { file: 'FlyIdleLoop.glb', label: 'Fly Idle' },
  { file: 'FlyForward.glb', label: 'Fly Forward' },
  { file: 'FlyBackward.glb', label: 'Fly Backward' },
  { file: 'FlyToIdle.glb', label: 'Fly → Idle' },
  { file: 'FlyLand.glb', label: 'Fly Land' },
  { file: 'FlyAttack01.glb', label: 'Fly Attack 01' },
  { file: 'FlyAttack02.glb', label: 'Fly Attack 02' },
  { file: 'FlyCast.glb', label: 'Fly Cast' },
  { file: 'FlyHit.glb', label: 'Fly Hit' },
  { file: 'DieFly.glb', label: 'Die (Fly)' },
  { file: 'Tpose.glb', label: 'T-Pose' },
];

export type StudioCharacterId =
  | 'rigged'
  | 'alt'
  | 'simple'
  | 'walking'
  | 'running'
  | 'tripo'
  | 'monkey_rigged'
  | 'monkey_new_wings'
  | 'monkey_source'
  | 'monkey_tripo_wings';

export type StudioCharacter = {
  id: StudioCharacterId;
  family: StudioFamilyId;
  label: string;
  url: string;
  rig: 'mixamo_char' | 'tripo' | 'wingedmonkey';
  albedoUrl?: string;
  /**
   * When set, Tripo-named clips are SkeletonUtils-retargeted from this skinned
   * mesh (same bone names, different bind) onto the character.
   */
  retargetFromUrl?: string;
  /** Clip library id for this character (defaults by family). */
  clipSet?: 'dorothy_mixamo' | 'dorothy_tripo' | 'gargoyle' | 'none';
};

export type StudioFamily = {
  id: StudioFamilyId;
  label: string;
  defaultCharacterId: StudioCharacterId;
};

export const STUDIO_FAMILIES: StudioFamily[] = [
  { id: 'dorothy', label: 'Dorothy', defaultCharacterId: 'rigged' },
  { id: 'wingedmonkey', label: 'Winged Monkey', defaultCharacterId: 'monkey_new_wings' },
];

export const STUDIO_CHARACTERS: StudioCharacter[] = [
  {
    id: 'rigged',
    family: 'dorothy',
    label: 'Dorothy MASTER',
    url: './models/dorothy/Dorothy_rigged.glb',
    rig: 'mixamo_char',
  },
  /**
   * Dorothy Alt — Tripo names, but bind ≠ legacy Dorothy_new (clips jelly if applied raw).
   * Retarget Tripo library clips through Dorothy_new at load time.
   * Masters: masters/dorothy/meshes/Dorothy_alt.glb
   */
  {
    id: 'alt',
    family: 'dorothy',
    label: 'Dorothy Alt',
    url: './models/dorothy/Dorothy_alt.glb',
    rig: 'tripo',
    retargetFromUrl: './models/dorothy/Old/Dorothy_new.glb',
  },
  /**
   * Same bind family as Alt — retarget Tripo clips via Dorothy_new.
   */
  {
    id: 'simple',
    family: 'dorothy',
    label: 'Dorothy Simple',
    url: './models/dorothy/MASTER/Dorothy_simple_skinned.glb',
    rig: 'tripo',
    retargetFromUrl: './models/dorothy/Old/Dorothy_new.glb',
  },
  /**
   * Same bind as Walk bake — embedded Walk plays without cross-file remap.
   */
  {
    id: 'walking',
    family: 'dorothy',
    label: 'Dorothy + Walk (same bake)',
    url: './models/dorothy/Animations/mixamo_character/Traversal_walk.glb',
    rig: 'mixamo_char',
  },
  {
    id: 'running',
    family: 'dorothy',
    label: 'Dorothy + Run (same bake)',
    url: './models/dorothy/Animations/mixamo_character/Traversal_run.glb',
    rig: 'mixamo_char',
  },
  {
    id: 'tripo',
    family: 'dorothy',
    label: 'Dorothy Tripo (legacy)',
    url: './models/dorothy/Old/Dorothy_new.glb',
    rig: 'tripo',
    albedoUrl: './models/dorothy/textures/Dorothy_color.jpg',
  },
  {
    id: 'monkey_rigged',
    family: 'wingedmonkey',
    label: 'Winged Monkey (Gargoyle armature)',
    url: './models/wingedmonkey/WingedMonkey_gargoyle_studio.glb',
    rig: 'wingedmonkey',
    clipSet: 'gargoyle',
  },
  {
    id: 'monkey_new_wings',
    family: 'wingedmonkey',
    label: 'Winged Monkey (NEW mesh + Gargoyle armature)',
    url: './models/wingedmonkey/WingedMonkey_new_wings_studio.glb',
    rig: 'wingedmonkey',
    clipSet: 'gargoyle',
  },
  {
    id: 'monkey_source',
    family: 'wingedmonkey',
    label: 'Winged Monkey (source Tripo)',
    url: './models/wingedmonkey/WingedMonkey.glb',
    rig: 'wingedmonkey',
    clipSet: 'none',
  },
  {
    id: 'monkey_tripo_wings',
    family: 'wingedmonkey',
    label: 'Winged Monkey (legacy Tripo+wings)',
    url: './models/wingedmonkey/WingedMonkey_rigged.glb',
    rig: 'wingedmonkey',
    clipSet: 'none',
  },
];

export function charactersForFamily(familyId: StudioFamilyId): StudioCharacter[] {
  return STUDIO_CHARACTERS.filter((c) => c.family === familyId);
}

export function resolveStudioSelection(
  familyParam: string | null,
  charParam: string | null,
): { family: StudioFamily; character: StudioCharacter } {
  const byId = new Map(STUDIO_CHARACTERS.map((c) => [c.id, c]));
  const char = charParam ? byId.get(charParam as StudioCharacterId) : undefined;
  if (char) {
    const family =
      STUDIO_FAMILIES.find((f) => f.id === char.family) ?? STUDIO_FAMILIES[0]!;
    return { family, character: char };
  }
  const family =
    STUDIO_FAMILIES.find((f) => f.id === familyParam) ?? STUDIO_FAMILIES[0]!;
  const fallback =
    byId.get(family.defaultCharacterId) ??
    charactersForFamily(family.id)[0] ??
    STUDIO_CHARACTERS[0]!;
  return { family, character: fallback };
}

/**
 * Built-in clips for the active character — strictly scoped to that character's family.
 * Dorothy never sees Gargoyle clips; Winged Monkey never sees Dorothy/Mixamo clips.
 */
export function builtInClips(characterId: StudioCharacterId = 'rigged'): CatalogClip[] {
  const character = STUDIO_CHARACTERS.find((c) => c.id === characterId) ?? STUDIO_CHARACTERS[0]!;

  if (character.family === 'wingedmonkey') {
    if (character.clipSet === 'none') return [];
    return MONKEY_GARGOYLE_FILES.map(({ file, label }) => ({
      id: file,
      label,
      url: `${MONKEY_GARGOYLE}/${file}`,
      kind: 'glb' as const,
      family: 'wingedmonkey' as const,
      rig: 'wingedmonkey' as const,
    }));
  }

  // Dorothy family
  if (character.rig === 'mixamo_char') {
    return MIXAMO_CHAR_FILES.map(({ file, label, base, kind }) => {
      const root =
        base === 'animations' ? TRIPO_BASE : base === 'studio' ? MIXAMO_STUDIO : MIXAMO_BAKED;
      return {
        id: file,
        label,
        url: `${root}/${file}`,
        kind: (kind ?? 'glb') as 'glb' | 'fbx',
        family: 'dorothy' as const,
        rig: 'mixamo_char' as const,
      };
    });
  }

  return TRIPO_FILES.map(({ file, label }) => ({
    id: file,
    label,
    url: `${TRIPO_BASE}/${file}`,
    kind: 'glb' as const,
    family: 'dorothy' as const,
    rig: 'tripo' as const,
  }));
}
