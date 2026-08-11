/** Built-in Dorothy clip library (served from public/models → models). */
export type CatalogClip = {
  id: string;
  label: string;
  url: string;
  kind: 'fbx' | 'glb';
  /** Which character family this clip was baked for. */
  rig: 'mixamo_char' | 'tripo' | 'any';
};

const MIXAMO_BAKED = './models/dorothy/Animations/mixamo_character';
/** Optimized Walk/Run/Jump/Idle for the clip library (masters untouched). */
const MIXAMO_STUDIO = './models/dorothy/Animations/studio';
const TRIPO_BASE = './models/dorothy/Animations';

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
  { file: 'Fighting_stance.glb', label: 'Fighting Stance' },
  { file: 'Traversal_walk.glb', label: 'Walk', base: 'studio' },
  { file: 'Traversal_run.glb', label: 'Run', base: 'studio' },
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
  { file: 'Attack_light4_spinkick.glb', label: 'Spin Kick' },
  { file: 'Attack_heavy1.glb', label: 'Attack Heavy 1' },
  { file: 'Attack_heavy2.glb', label: 'Attack Heavy 2' },
  { file: 'Attack_heavy3.glb', label: 'Attack Heavy 3' },
  { file: 'Attack_ultimate.glb', label: 'Ultimate' },
  { file: 'Pose_braced_for_attack.glb', label: 'Braced Pose' },
  /** Raw Mixamo FBX (same bind as MASTER) — listed so Jump.fbx is visible by name. */
  { file: 'Jump.fbx', label: 'Jump (FBX)', base: 'animations', kind: 'fbx' },
  {
    file: 'Fighting stance.fbx',
    label: 'Fighting Stance (FBX)',
    base: 'animations',
    kind: 'fbx',
  },
};

const TRIPO_FILES: { file: string; label: string }[] = [
  { file: 'Traversal_walk_dorothy.glb', label: 'Walk (Tripo)' },
  { file: 'Traversal_run_dorothy.glb', label: 'Run (Tripo)' },
  { file: 'Traversal_turn_dorothy.glb', label: 'Turn (Tripo)' },
  { file: 'Traversal_idle-to-walk_dorothy.glb', label: 'Idle → Walk' },
];

export type StudioCharacterId = 'rigged' | 'simple' | 'walking' | 'running' | 'tripo';

export type StudioCharacter = {
  id: StudioCharacterId;
  label: string;
  url: string;
  rig: 'mixamo_char' | 'tripo';
  albedoUrl?: string;
};

export const STUDIO_CHARACTERS: StudioCharacter[] = [
  {
    id: 'rigged',
    label: 'Dorothy MASTER',
    url: './models/dorothy/MASTER/Dorothy_rigged.glb',
    rig: 'mixamo_char',
  },
  /**
   * Tripo-skinned Dorothy_simple mesh (Mixamo upload keeps mesh-only Dorothy_simple.glb).
   */
  {
    id: 'simple',
    label: 'Dorothy Simple',
    url: './models/dorothy/MASTER/Dorothy_simple_skinned.glb',
    rig: 'tripo',
  },
  /**
   * Same bind as Walk bake — embedded Walk plays without cross-file remap.
   */
  {
    id: 'walking',
    label: 'Dorothy + Walk (same bake)',
    url: './models/dorothy/Animations/mixamo_character/Traversal_walk.glb',
    rig: 'mixamo_char',
  },
  {
    id: 'running',
    label: 'Dorothy + Run (same bake)',
    url: './models/dorothy/Animations/mixamo_character/Traversal_run.glb',
    rig: 'mixamo_char',
  },
  {
    id: 'tripo',
    label: 'Dorothy Tripo (legacy)',
    url: './models/dorothy/Old/Dorothy_new.glb',
    rig: 'tripo',
    albedoUrl: './models/dorothy/textures/Dorothy_color.jpg',
  },
];

export function builtInClips(characterId: StudioCharacterId = 'rigged'): CatalogClip[] {
  const character = STUDIO_CHARACTERS.find((c) => c.id === characterId) ?? STUDIO_CHARACTERS[0]!;
  if (character.rig === 'mixamo_char') {
    return MIXAMO_CHAR_FILES.map(({ file, label, base, kind }) => {
      const root =
        base === 'animations' ? TRIPO_BASE : base === 'studio' ? MIXAMO_STUDIO : MIXAMO_BAKED;
      return {
        id: file,
        label,
        url: `${root}/${file}`,
        kind: (kind ?? 'glb') as 'glb' | 'fbx',
        rig: 'mixamo_char' as const,
      };
    });
  }
  return TRIPO_FILES.map(({ file, label }) => ({
    id: file,
    label,
    url: `${TRIPO_BASE}/${file}`,
    kind: 'glb' as const,
    rig: 'tripo' as const,
  }));
}
