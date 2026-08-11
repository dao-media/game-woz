/**
 * Bone name maps for Dorothy studio remapping.
 *
 * Two character families:
 * - Tripo (`Dorothy_new`): L_/R_ bones, Pelvis/Waist
 * - Mixamo-character (`Dorothy_walking` / `Dorothy_running`): Hips/LeftArm/Spine02…
 */

/** Mixamo → Tripo Dorothy (Dorothy_new). */
export const MIXAMO_TO_TRIPO: Record<string, string> = {
  Hips: 'Pelvis',
  Spine: 'Waist',
  Spine1: 'Spine01',
  Spine2: 'Spine02',
  LeftShoulder: 'L_Clavicle',
  LeftArm: 'L_Upperarm',
  LeftForeArm: 'L_Forearm',
  LeftHand: 'L_Hand',
  RightShoulder: 'R_Clavicle',
  RightArm: 'R_Upperarm',
  RightForeArm: 'R_Forearm',
  RightHand: 'R_Hand',
  LeftUpLeg: 'L_Thigh',
  LeftLeg: 'L_Calf',
  LeftFoot: 'L_Foot',
  RightUpLeg: 'R_Thigh',
  RightLeg: 'R_Calf',
  RightFoot: 'R_Foot',
};

/** Tripo → Mixamo-character MASTER (for Dorothy_*_dorothy.glb clips on MASTER). */
export const TRIPO_TO_MIXAMO_CHAR: Record<string, string> = {
  Pelvis: 'Hips',
  Hip: 'Hips',
  Waist: 'Spine02',
  Spine01: 'Spine01',
  Spine02: 'Spine',
  L_Clavicle: 'LeftShoulder',
  L_Upperarm: 'LeftArm',
  L_Forearm: 'LeftForeArm',
  L_Hand: 'LeftHand',
  R_Clavicle: 'RightShoulder',
  R_Upperarm: 'RightArm',
  R_Forearm: 'RightForeArm',
  R_Hand: 'RightHand',
  L_Thigh: 'LeftUpLeg',
  L_Calf: 'LeftLeg',
  L_Foot: 'LeftFoot',
  R_Thigh: 'RightUpLeg',
  R_Calf: 'RightLeg',
  R_Foot: 'RightFoot',
};

/**
 * Mixamo → Dorothy_walking / Dorothy_running.
 * Spine chain is inverted vs Mixamo naming (Hips→Spine02→Spine01→Spine).
 */
export const MIXAMO_TO_MIXAMO_CHAR: Record<string, string> = {
  Hips: 'Hips',
  Spine: 'Spine02',
  Spine1: 'Spine01',
  Spine2: 'Spine',
  LeftShoulder: 'LeftShoulder',
  LeftArm: 'LeftArm',
  LeftForeArm: 'LeftForeArm',
  LeftHand: 'LeftHand',
  RightShoulder: 'RightShoulder',
  RightArm: 'RightArm',
  RightForeArm: 'RightForeArm',
  RightHand: 'RightHand',
  LeftUpLeg: 'LeftUpLeg',
  LeftLeg: 'LeftLeg',
  LeftFoot: 'LeftFoot',
  RightUpLeg: 'RightUpLeg',
  RightLeg: 'RightLeg',
  RightFoot: 'RightFoot',
};

export type DorothyRigKind = 'tripo' | 'mixamo_char';

export function detectRigKind(root: { traverse: (fn: (o: { name: string; isBone?: boolean }) => void) => void } | { skeleton?: { bones: { name: string }[] } }): DorothyRigKind {
  const names = new Set<string>();
  const skinned = root as { skeleton?: { bones: { name: string }[] }; isSkinnedMesh?: boolean };
  if (skinned.skeleton?.bones) {
    for (const b of skinned.skeleton.bones) names.add(b.name);
  } else {
    (root as { traverse: (fn: (o: { name: string; isBone?: boolean }) => void) => void }).traverse((obj) => {
      if ((obj as { isBone?: boolean }).isBone) names.add(obj.name);
    });
  }
  if (names.has('Hips') && names.has('LeftArm')) return 'mixamo_char';
  if (names.has('Pelvis') || names.has('L_Upperarm') || names.has('Hip')) return 'tripo';
  return 'tripo';
}

/** Bones that may receive position tracks (root motion / hip bob). */
export function positionBonesFor(kind: DorothyRigKind): Set<string> {
  return kind === 'mixamo_char' ? new Set(['Hips']) : new Set(['Pelvis', 'Hip', 'Hips']);
}

export const POSITION_BONES = new Set(['Pelvis', 'Hip', 'Hips']);

export function stripMixamoPrefix(bone: string): string {
  return bone.replace(/^mixamorig:?/i, '');
}

export function mixamoMapFor(kind: DorothyRigKind): Record<string, string> {
  return kind === 'mixamo_char' ? MIXAMO_TO_MIXAMO_CHAR : MIXAMO_TO_TRIPO;
}

export function remapBoneName(raw: string, kind: DorothyRigKind = 'tripo'): string | null {
  const leaf = raw.split('/').pop() ?? raw;
  const stripped = stripMixamoPrefix(leaf);
  const map = mixamoMapFor(kind);
  if (map[stripped]) return map[stripped];

  if (/^(Root)$/i.test(stripped)) return null;
  if (kind === 'mixamo_char') {
    // Tripo-baked Dorothy_*_dorothy.glb clips → MASTER Mixamo names.
    if (TRIPO_TO_MIXAMO_CHAR[stripped]) return TRIPO_TO_MIXAMO_CHAR[stripped];
    if (/^(Hips|Spine\d*|Left|Right|neck|Head)/.test(stripped)) return stripped;
    return null;
  }
  if (/^(L_|R_|Hip|Pelvis|Waist|Spine\d*|Neck|Head)/.test(stripped)) return stripped;
  return null;
}
