import * as THREE from 'three';
import {
  detectRigKind,
  mixamoMapFor,
  positionBonesFor,
  remapBoneName,
  stripMixamoPrefix,
  type DorothyRigKind,
} from './boneMap';

export type RestPoseMap = Map<string, THREE.Quaternion>;

export function captureRestQuaternions(root: THREE.Object3D): RestPoseMap {
  root.updateMatrixWorld(true);
  const map: RestPoseMap = new Map();
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    map.set(obj.name, obj.quaternion.clone());
  });
  return map;
}

function clipLooksMixamo(clip: THREE.AnimationClip): boolean {
  return clip.tracks.some((t) => /mixamorig/i.test(t.name));
}

function findBone(
  root: THREE.Object3D | THREE.SkinnedMesh,
  names: string[],
): THREE.Bone | null {
  const set = new Set(names);
  const skinned = root as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh && skinned.skeleton) {
    for (const b of skinned.skeleton.bones) {
      if (set.has(b.name)) return b;
    }
  }
  let found: THREE.Bone | null = null;
  root.traverse((obj) => {
    if (found) return;
    if ((obj as THREE.Bone).isBone && set.has(obj.name)) found = obj as THREE.Bone;
  });
  return found;
}

function isLockedBone(bone: string, kind: DorothyRigKind): boolean {
  if (bone.includes('Toe')) return true;
  // Head/neck joints sit too low on this Mixamo bind for Dorothy's skull —
  // animated Head.location/scale stretches the face. Keep rest-pose head;
  // body motion still drives from Spine.
  if (bone === 'Head' || bone === 'head_end' || bone === 'head_tip' || bone === 'neck') {
    return true;
  }
  if (kind === 'tripo') {
    return bone === 'Head' || bone.startsWith('Neck');
  }
  return false;
}

/**
 * Sanitize a MASTER-baked clip.
 * Blender visual bake keys location+rotation(+scale) on every bone — those
 * locations are part of the bind-compatible pose. Stripping non-hip positions
 * (correct for cross-rig retarget) dislocates limbs on same-rig baked clips.
 */
function sanitizeClip(
  clip: THREE.AnimationClip,
  kind: DorothyRigKind,
  name?: string,
): THREE.AnimationClip {
  const posBones = positionBonesFor(kind);
  const tracks: THREE.KeyframeTrack[] = [];
  const isBakedMaster =
    kind === 'mixamo_char' &&
    clip.tracks.some((t) => /^(Hips|LeftUpLeg|Spine02)\.(position|quaternion)/.test(t.name.split('|').pop() ?? t.name));

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const bonePath = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const leaf = bonePath.split('/').pop()?.split('|').pop() ?? bonePath;
    const bone =
      remapBoneName(leaf, kind) ??
      (kind === 'mixamo_char' && /^(Hips|Spine|Left|Right|neck|Head)/.test(leaf) ? leaf : null);
    if (!bone) continue;
    if (isLockedBone(bone, kind)) continue;

    if (prop === 'quaternion') {
      const cloned = track.clone();
      cloned.name = `${bone}.${prop}`;
      tracks.push(cloned);
      continue;
    }
    if (prop === 'position') {
      if (isBakedMaster || posBones.has(bone)) {
        const cloned = track.clone();
        cloned.name = `${bone}.${prop}`;
        tracks.push(cloned);
      }
      continue;
    }
    if (prop === 'scale' && isBakedMaster) {
      const cloned = track.clone();
      cloned.name = `${bone}.${prop}`;
      tracks.push(cloned);
    }
  }
  return new THREE.AnimationClip(name ?? clip.name, clip.duration, tracks);
}

const HIP_BONES = new Set(['Hips', 'Pelvis', 'Hip']);

export type RootMotionMode = 'inplace' | 'travel';

export type RootMotionOptions = {
  /**
   * Hips bone (or any object whose `.position` the clip drives).
   * Required for correct in-place on Mixamo→glTF rigs where vertical hop
   * lives on local Z after the Armature +90° X, not local Y.
   */
  hips?: THREE.Object3D | null;
};

/**
 * In place: lock world-space horizontal travel; keep world vertical (jump hop).
 * Travel: pass through root motion unchanged.
 *
 * Bone-local XZ lock is wrong for MASTER clips — jump height is often on local Z.
 */
export function applyRootMotionMode(
  clip: THREE.AnimationClip,
  mode: RootMotionMode,
  opts: RootMotionOptions = {},
): THREE.AnimationClip {
  if (mode === 'travel') {
    return clip.clone();
  }

  const hips = opts.hips ?? null;
  const parent = hips?.parent ?? null;
  if (parent) {
    parent.updateWorldMatrix(true, false);
  }
  const parentWorld = parent?.matrixWorld.clone() ?? new THREE.Matrix4();
  const parentInv = parentWorld.clone().invert();
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();

  const tracks = clip.tracks.map((track) => {
    if (!(track instanceof THREE.VectorKeyframeTrack)) return track.clone();
    if (!track.name.endsWith('.position')) return track.clone();
    const bone = track.name.slice(0, track.name.lastIndexOf('.')).split('/').pop() ?? '';
    if (!HIP_BONES.has(bone)) return track.clone();

    const values = track.values.slice();
    if (values.length < 3) return track.clone();

    // First key → world anchor (lock XZ, keep Y free per frame).
    local.fromArray(values, 0);
    world.copy(local).applyMatrix4(parentWorld);
    const anchorX = world.x;
    const anchorZ = world.z;

    for (let i = 0; i < values.length; i += 3) {
      local.fromArray(values, i);
      world.copy(local).applyMatrix4(parentWorld);
      world.x = anchorX;
      world.z = anchorZ;
      local.copy(world).applyMatrix4(parentInv);
      local.toArray(values, i);
    }
    return new THREE.VectorKeyframeTrack(track.name, track.times.slice(), values);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Fallback: name-map Mixamo FBX tracks onto MASTER (rotation-only + scaled hips).
 * Prefer Blender-baked MASTER clips — raw FBX fights the glTF Armature +90° X.
 */
function retargetMixamoRenameOnly(
  clip: THREE.AnimationClip,
  opts: {
    name?: string;
    sourceRoot: THREE.Object3D;
    targetSkinned: THREE.SkinnedMesh;
    kind: DorothyRigKind;
    inPlace?: boolean;
  },
): THREE.AnimationClip {
  const map = mixamoMapFor(opts.kind);
  const posBones = positionBonesFor(opts.kind);
  // Always keep travel in the remapped clip; studio applies in-place via applyRootMotionMode.
  const inPlace = false;
  void opts.inPlace;

  opts.targetSkinned.skeleton.pose();
  opts.targetSkinned.updateMatrixWorld(true);
  opts.sourceRoot.updateMatrixWorld(true);

  const hipsTgt = [...Object.values(map)].find((n) => posBones.has(n)) ?? 'Hips';
  const srcHips = findBone(opts.sourceRoot, ['mixamorig:Hips', 'mixamorigHips', 'Hips']);
  const tgtHips = findBone(opts.targetSkinned, [hipsTgt]);
  const restHip = tgtHips?.position.clone() ?? new THREE.Vector3();
  const srcHipY = srcHips ? Math.abs(srcHips.position.y) : 1;
  const tgtHipY = tgtHips ? Math.abs(tgtHips.position.y) : 1;
  const hipScale = srcHipY > 1e-6 ? tgtHipY / srcHipY : 0.01;

  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const [rawName, prop] = track.name.split('.');
    if (!rawName || !prop) continue;
    const srcName = stripMixamoPrefix(rawName);
    const tgtName = map[srcName];
    if (!tgtName || isLockedBone(tgtName, opts.kind)) continue;

    if (track instanceof THREE.QuaternionKeyframeTrack && prop === 'quaternion') {
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${tgtName}.quaternion`,
          track.times.slice(),
          track.values.slice(),
        ),
      );
    } else if (
      track instanceof THREE.VectorKeyframeTrack &&
      prop === 'position' &&
      posBones.has(tgtName)
    ) {
      const values = track.values.slice();
      const y0 = track.values[1] ?? 0;
      for (let i = 0; i < values.length; i += 3) {
        if (inPlace) {
          values[i] = restHip.x;
          values[i + 1] = restHip.y + ((values[i + 1] ?? 0) - y0) * hipScale;
          values[i + 2] = restHip.z;
        } else {
          values[i] = (values[i] ?? 0) * hipScale;
          values[i + 1] = (values[i + 1] ?? 0) * hipScale;
          values[i + 2] = (values[i + 2] ?? 0) * hipScale;
        }
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${tgtName}.position`, track.times.slice(), values));
    }
  }

  return new THREE.AnimationClip(opts.name ?? clip.name, clip.duration, tracks);
}

/**
 * Remap a clip onto the active Dorothy rig.
 * - MASTER-baked GLB: sanitize channel names only (already in MASTER bind space)
 * - Mixamo FBX fallback: rename + rotation-only (prefer baked clips)
 */
export function remapClipToDorothy(
  clip: THREE.AnimationClip,
  opts: {
    name?: string;
    targetSkinned: THREE.SkinnedMesh;
    sourceRoot?: THREE.Object3D;
    kind?: DorothyRigKind;
    inPlace?: boolean;
  },
): THREE.AnimationClip {
  const kind = opts.kind ?? detectRigKind(opts.targetSkinned);

  if (!clipLooksMixamo(clip)) {
    return sanitizeClip(clip, kind, opts.name);
  }

  const sourceRoot = opts.sourceRoot;
  if (!sourceRoot) {
    throw new Error('Mixamo remapping requires the source FBX scene graph');
  }

  return retargetMixamoRenameOnly(clip, {
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    sourceRoot,
    targetSkinned: opts.targetSkinned,
    kind,
    ...(opts.inPlace !== undefined ? { inPlace: opts.inPlace } : {}),
  });
}

/** @deprecated Use remapClipToDorothy */
export function remapClipToTripo(
  clip: THREE.AnimationClip,
  opts: {
    name?: string;
    targetSkinned: THREE.SkinnedMesh;
    sourceRoot?: THREE.Object3D;
  },
): THREE.AnimationClip {
  return remapClipToDorothy(clip, opts);
}

export { stripMixamoPrefix, detectRigKind };
export type { DorothyRigKind };
