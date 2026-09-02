import * as THREE from 'three';
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  detectClipBoneStyle,
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
  const clipLeaves = clip.tracks.map((t) => {
    const d = t.name.lastIndexOf('.');
    const path = d >= 0 ? t.name.slice(0, d) : t.name;
    return path.split('/').pop()?.split('|').pop() ?? path;
  });
  const clipStyle = detectClipBoneStyle(clipLeaves);
  // Full baked locals only when mesh is Mixamo-named MASTER. Alt/Simple are
  // Tripo-named (even with Mixamo-like axes) — keep hip position + quats only,
  // never Mixamo Hips.scale (~0.01) or limb bind positions (causes jelly/squash).
  const isBakedMaster =
    clipStyle === 'mixamo_char' &&
    kind === 'mixamo_char' &&
    clip.tracks.some((t) => /^(Hips|LeftUpLeg|Spine02)\.(position|quaternion)/.test(t.name.split('|').pop() ?? t.name));

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const bonePath = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const leaf = bonePath.split('/').pop()?.split('|').pop() ?? bonePath;
    const bone =
      remapBoneName(leaf, kind, clipStyle) ??
      (kind === 'mixamo_char' &&
      (/^(Hips|Spine|Left|Right|neck|Head|Dress_|Hair_)/.test(leaf) ||
        /cloth|skirt|ponytail|bang/i.test(leaf))
        ? leaf
        : null);
    if (!bone) continue;
    if (isLockedBone(bone, kind)) continue;

    const isCloth = /^(Dress_|Hair_)/.test(bone);

    if (prop === 'quaternion') {
      const cloned = track.clone();
      cloned.name = `${bone}.${prop}`;
      tracks.push(cloned);
      continue;
    }
    if (prop === 'position') {
      // Cloth/hair chains are rotation-driven; keep hip (and baked body) positions only.
      if (!isCloth && (isBakedMaster || posBones.has(bone))) {
        const cloned = track.clone();
        cloned.name = `${bone}.${prop}`;
        tracks.push(cloned);
      }
      continue;
    }
    if (prop === 'scale' && isBakedMaster && !isCloth) {
      const cloned = track.clone();
      cloned.name = `${bone}.${prop}`;
      tracks.push(cloned);
    }
  }
  return new THREE.AnimationClip(name ?? clip.name, clip.duration, tracks);
}

const HIP_BONES = new Set(['Hips', 'Pelvis', 'Hip', 'GargPelvis']);

/** Horizontal unit vector from a world-space direction (Y up). */
function flatForward(v: THREE.Vector3): THREE.Vector3 | null {
  const flat = new THREE.Vector3(v.x, 0, v.z);
  if (flat.lengthSq() < 1e-10) return null;
  return flat.normalize();
}

/** Signed yaw (rad) from `from` → `to` about world +Y. */
function signedYawBetween(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(
    from.x * to.z - from.z * to.x,
    from.x * to.x + from.z * to.z,
  );
}

function findFacingProbeBone(root: THREE.Object3D): THREE.Bone | null {
  return (
    findBone(root, ['Hips', 'Pelvis', 'Hip', 'GargPelvis', 'mixamorigHips', 'mixamorig:Hips']) ??
    findBone(root, ['Spine2', 'Spine02', 'GargRibcage', 'GargSpine3', 'mixamorigSpine2', 'mixamorig:Spine2']) ??
    findBone(root, ['Spine1', 'Spine01', 'GargSpine2', 'mixamorigSpine1', 'mixamorig:Spine1']) ??
    findBone(root, ['Head', 'GargHead', 'mixamorigHead', 'mixamorig:Head'])
  );
}

/** Mesh facing from the shoulder line (Mixamo hips local +X is sideways, not forward). */
function sampleChestFlatForward(root: THREE.Object3D): THREE.Vector3 | null {
  // Prefer upper arms: Gargoyle MVP clavicle *heads* sit on the same sternum
  // point, so Left/Right collarbone origins give a near-zero / noisy shoulder
  // axis and alignClipFacingToRest yaws every clip ~90–180° wrong.
  const left =
    findBone(root, [
      'LeftArm',
      'LeftUpperArm',
      'L_Upperarm',
      'GargLArmUpperarm1',
      'mixamorigLeftArm',
      'mixamorig:LeftArm',
      'LeftShoulder',
      'L_Clavicle',
      'GargLArmCollarbone',
      'mixamorigLeftShoulder',
      'mixamorig:LeftShoulder',
    ]);
  const right =
    findBone(root, [
      'RightArm',
      'RightUpperArm',
      'R_Upperarm',
      'GargRUpperarm1',
      'mixamorigRightArm',
      'mixamorig:RightArm',
      'RightShoulder',
      'R_Clavicle',
      'GargRCollarbone',
      'mixamorigRightShoulder',
      'mixamorig:RightShoulder',
    ]);
  if (!left || !right) return null;
  const ls = left.getWorldPosition(new THREE.Vector3());
  const rs = right.getWorldPosition(new THREE.Vector3());
  const shoulder = new THREE.Vector3().subVectors(rs, ls);
  shoulder.y = 0;
  if (shoulder.lengthSq() < 1e-10) return null;
  shoulder.normalize();
  // character-right ≈ (Right − Left); facing = up × right
  return flatForward(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), shoulder));
}

/** Snapshot / restore bone locals — never call skeleton.pose() on the live studio rig. */
function captureLocalsForAlign(
  root: THREE.Object3D,
): Map<string, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }> {
  const map = new Map<string, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    map.set(obj.name, {
      p: obj.position.clone(),
      q: obj.quaternion.clone(),
      s: obj.scale.clone(),
    });
  });
  return map;
}

function restoreLocalsForAlign(
  root: THREE.Object3D,
  map: Map<string, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>,
): void {
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    const r = map.get(obj.name);
    if (!r) return;
    obj.position.copy(r.p);
    obj.quaternion.copy(r.q);
    obj.scale.copy(r.s);
  });
  root.updateMatrixWorld(true);
}

/**
 * Sample character forward at the current pose or after applying a clip.
 * Always restores the incoming bone locals afterward (no skeleton.pose()).
 */
function sampleFlatForward(
  root: THREE.Object3D,
  clip: THREE.AnimationClip | null,
  timeSec = 0,
): THREE.Vector3 | null {
  const saved = captureLocalsForAlign(root);
  let mixer: THREE.AnimationMixer | null = null;
  try {
    if (clip) {
      mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(clip);
      action.play();
      mixer.setTime(Math.max(0, Math.min(timeSec, Math.max(clip.duration - 1e-4, 0))));
      root.updateMatrixWorld(true);
    } else {
      root.updateMatrixWorld(true);
    }

    const chest = sampleChestFlatForward(root);
    if (chest) return chest;

    // Fallback: hips local +Z then +X (Tripo / odd binds).
    const probe = findFacingProbeBone(root);
    if (!probe) return null;
    const q = probe.getWorldQuaternion(new THREE.Quaternion());
    return (
      flatForward(new THREE.Vector3(0, 0, 1).applyQuaternion(q)) ??
      flatForward(new THREE.Vector3(1, 0, 0).applyQuaternion(q))
    );
  } finally {
    mixer?.stopAllAction();
    restoreLocalsForAlign(root, saved);
  }
}

/**
 * Apply a constant world-+Y yaw to quaternion keys on the given bone names.
 * Axis is derived from `axisParent`'s world quaternion (scale-free).
 * Returns null if the parent axis is unsafe (would tip into a wall-run).
 */
function yawOrientationTracks(
  clip: THREE.AnimationClip,
  axisParent: THREE.Object3D,
  boneNames: Set<string>,
  deltaYaw: number,
): THREE.AnimationClip | null {
  axisParent.updateWorldMatrix(true, false);
  // IMPORTANT: do NOT setFromRotationMatrix(matrixWorld) — studio roots are
  // uniformly scaled (~×2), and that pollutes the extracted rotation into a
  // tipped "up" axis (wall-run). Use world quaternion (scale-free).
  const parentQ = new THREE.Quaternion();
  axisParent.getWorldQuaternion(parentQ);
  const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(parentQ.clone().invert()).normalize();
  if (localUp.lengthSq() < 1e-8) return null;
  // Guard: world +Y in parent space must be near a horizontal local axis
  // (glTF Armature +90°X → ±Z). A dominant local Y means parent orientation
  // wasn't resolved — yawing about it tips the character onto the wall.
  if (Math.abs(localUp.y) > 0.5) return null;
  const qDeltaLocal = new THREE.Quaternion().setFromAxisAngle(localUp, deltaYaw);

  const tracks = clip.tracks.map((track) => {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) return track.clone();
    const bone = track.name.slice(0, dot).split('/').pop()?.split('|').pop() ?? '';
    if (!boneNames.has(bone)) return track.clone();

    if (track instanceof THREE.QuaternionKeyframeTrack && track.name.endsWith('.quaternion')) {
      const values = track.values.slice();
      const q = new THREE.Quaternion();
      for (let i = 0; i < values.length; i += 4) {
        q.set(values[i]!, values[i + 1]!, values[i + 2]!, values[i + 3]!);
        q.premultiply(qDeltaLocal);
        values[i] = q.x;
        values[i + 1] = q.y;
        values[i + 2] = q.z;
        values[i + 3] = q.w;
      }
      return new THREE.QuaternionKeyframeTrack(track.name, track.times.slice(), values);
    }

    return track.clone();
  });

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function yawHipOrientationTracks(
  clip: THREE.AnimationClip,
  hips: THREE.Bone,
  deltaYaw: number,
): THREE.AnimationClip | null {
  const axisParent = hips.parent ?? hips;
  return yawOrientationTracks(clip, axisParent, HIP_BONES, deltaYaw);
}

/**
 * Yaw quaternion tracks on `boneNames` about world +Y, assuming a constant
 * rest-pose parent world quaternion (thighs under Hips at bind).
 * Avoids the localUp wall-run guard, which false-rejects when Hips isn't at rest.
 */
function yawTracksAroundWorldY(
  clip: THREE.AnimationClip,
  parentWorldQ: THREE.Quaternion,
  boneNames: Set<string>,
  deltaYaw: number,
): THREE.AnimationClip {
  const yawWorld = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deltaYaw);
  const parentInv = parentWorldQ.clone().invert();

  const tracks = clip.tracks.map((track) => {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) return track.clone();
    const bone = track.name.slice(0, dot).split('/').pop()?.split('|').pop() ?? '';
    if (!boneNames.has(bone)) return track.clone();
    if (!(track instanceof THREE.QuaternionKeyframeTrack) || !track.name.endsWith('.quaternion')) {
      return track.clone();
    }
    const values = track.values.slice();
    const q = new THREE.Quaternion();
    for (let i = 0; i < values.length; i += 4) {
      q.set(values[i]!, values[i + 1]!, values[i + 2]!, values[i + 3]!);
      // q_local' = parentInv * yaw * parent * q_local
      q.premultiply(parentWorldQ).premultiply(yawWorld).premultiply(parentInv);
      values[i] = q.x;
      values[i + 1] = q.y;
      values[i + 2] = q.z;
      values[i + 3] = q.w;
    }
    return new THREE.QuaternionKeyframeTrack(track.name, track.times.slice(), values);
  });

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const THIGH_BONES = new Set([
  'LeftUpLeg',
  'RightUpLeg',
  'L_Thigh',
  'R_Thigh',
  'GargLLegThigh1',
  'GargRThigh1',
  'mixamorigLeftUpLeg',
  'mixamorigRightUpLeg',
]);

/** Mean horizontal facing over the clip (average of unit forwards). */
function sampleMeanFlatForward(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  samples = 16,
): THREE.Vector3 | null {
  const acc = new THREE.Vector3();
  let n = 0;
  const dur = Math.max(clip.duration, 1e-4);
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * dur;
    const fwd = sampleFlatForward(root, clip, t);
    if (!fwd) continue;
    acc.add(fwd);
    n++;
  }
  if (n === 0 || acc.lengthSq() < 1e-10) return null;
  return acc.normalize();
}

/**
 * Principal swing skew (rad) of feet relative to mean chest facing.
 * Positive = swing plane CCW of facing about world +Y.
 */
function measureFootSwingSkew(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  samples = 24,
): number | null {
  const hips =
    findBone(root, ['Hips', 'Pelvis', 'Hip', 'GargPelvis']) ??
    findBone(root, ['mixamorigHips', 'mixamorig:Hips']);
  const footL =
    findBone(root, ['LeftFoot', 'L_Foot', 'GargLLegAnkle', 'mixamorigLeftFoot', 'mixamorig:LeftFoot']);
  const footR =
    findBone(root, ['RightFoot', 'R_Foot', 'GargRAnkle', 'mixamorigRightFoot', 'mixamorig:RightFoot']);
  if (!hips || (!footL && !footR)) return null;

  const meanChest = sampleMeanFlatForward(root, clip, samples);
  if (!meanChest) return null;
  const rightAxis = new THREE.Vector3().crossVectors(meanChest, new THREE.Vector3(0, 1, 0));
  if (rightAxis.lengthSq() < 1e-10) return null;
  rightAxis.normalize();

  const skews: number[] = [];
  for (const foot of [footL, footR]) {
    if (!foot) continue;
    const rel: THREE.Vector3[] = [];
    const saved = captureLocalsForAlign(root);
    let mixer: THREE.AnimationMixer | null = null;
    try {
      mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      const dur = Math.max(clip.duration, 1e-4);
      for (let i = 0; i < samples; i++) {
        mixer.setTime((i / samples) * dur);
        root.updateMatrixWorld(true);
        rel.push(
          foot.getWorldPosition(new THREE.Vector3()).sub(hips.getWorldPosition(new THREE.Vector3())),
        );
      }
    } finally {
      mixer?.stopAllAction();
      restoreLocalsForAlign(root, saved);
    }
    if (rel.length < 4) continue;
    const fs = rel.map((p) => p.dot(meanChest));
    const rs = rel.map((p) => p.dot(rightAxis));
    const mf = fs.reduce((a, b) => a + b, 0) / fs.length;
    const mr = rs.reduce((a, b) => a + b, 0) / rs.length;
    let cff = 0;
    let crr = 0;
    let cfr = 0;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i]! - mf;
      const r = rs[i]! - mr;
      cff += f * f;
      crr += r * r;
      cfr += f * r;
    }
    // Ignore near-circular / lateral-dominated noise.
    if (cff + crr < 1e-8) continue;
    skews.push(0.5 * Math.atan2(2 * cfr, cff - crr));
  }
  if (skews.length === 0) return null;
  return skews.reduce((a, b) => a + b, 0) / skews.length;
}

/**
 * Some MASTER bakes (Run / Idle / Jump) face ~90° off Walk/rest.
 * 1) Correct large quarter-turn bake errors using t=0 chest facing.
 * 2) Cancel leftover *mean* facing bias over the cycle.
 * 3) Yaw thighs only so foot swing plane matches chest (hip yaw alone can't —
 *    it rotates torso and legs together; Run left ~6° leg skew vs upper body).
 *
 * Hip position stays put: studio Run is in-place (cm-scale bob).
 * Never call skeleton.pose() on the live rig — Mixamo bind is flat + Hips.scale=0.01.
 */
function alignClipFacingToRest(
  clip: THREE.AnimationClip,
  targetSkinned: THREE.SkinnedMesh,
): THREE.AnimationClip {
  let alignRoot: THREE.Object3D = targetSkinned;
  for (let cur: THREE.Object3D | null = targetSkinned; cur && cur.type !== 'Scene'; cur = cur.parent) {
    alignRoot = cur;
  }

  const hips =
    findBone(alignRoot, ['Hips', 'Pelvis', 'Hip', 'GargPelvis']) ??
    findBone(targetSkinned, ['Hips', 'Pelvis', 'Hip', 'GargPelvis']);
  if (!hips) return clip;

  const restFwd = sampleFlatForward(alignRoot, null);
  if (!restFwd) return clip;

  // Snapshot bind locals so yaw-axis extraction isn't poisoned by a leftover
  // mixer sample (Hips mid-run has local Y ≈ world up → false wall-run reject).
  const restLocals = captureLocalsForAlign(alignRoot);

  let result = clip;

  // Pass 1: large ~90°/180° bake errors (t=0 chest vs rest).
  const clipFwd = sampleFlatForward(alignRoot, result, 0);
  if (clipFwd) {
    const rawYaw = -signedYawBetween(clipFwd, restFwd);
    if (Number.isFinite(rawYaw)) {
      const quarter = Math.PI / 2;
      const nearest = Math.round(rawYaw / quarter) * quarter;
      const nearQuarter =
        Math.abs(nearest) >= quarter - 1e-3 &&
        Math.abs(rawYaw - nearest) <= THREE.MathUtils.degToRad(40);
      if (nearQuarter) {
        const yawed = yawHipOrientationTracks(result, hips, rawYaw);
        if (yawed) {
          const beforeUp = sampleHeadFootUpY(alignRoot, result, 0.05);
          const afterUp = sampleHeadFootUpY(alignRoot, yawed, 0.05);
          if (!(beforeUp != null && afterUp != null && afterUp < beforeUp * 0.9)) {
            result = yawed;
          }
        }
      }
    }
  }

  // Pass 2: zero mean facing bias (keeps stride oscillation, removes crook).
  const meanFwd = sampleMeanFlatForward(alignRoot, result);
  if (meanFwd) {
    const biasYaw = -signedYawBetween(meanFwd, restFwd);
    if (
      Number.isFinite(biasYaw) &&
      Math.abs(biasYaw) >= THREE.MathUtils.degToRad(1.5) &&
      Math.abs(biasYaw) <= THREE.MathUtils.degToRad(35)
    ) {
      const yawed = yawHipOrientationTracks(result, hips, biasYaw);
      if (yawed) {
        const beforeUp = sampleHeadFootUpY(alignRoot, result, 0.05);
        const afterUp = sampleHeadFootUpY(alignRoot, yawed, 0.05);
        if (!(beforeUp != null && afterUp != null && afterUp < beforeUp * 0.9)) {
          result = yawed;
        }
      }
    }
  }

  // Pass 3: legs vs torso — yaw thighs so foot swing matches chest facing.
  restoreLocalsForAlign(alignRoot, restLocals);
  const skew = measureFootSwingSkew(alignRoot, result);
  restoreLocalsForAlign(alignRoot, restLocals);
  if (
    skew != null &&
    Number.isFinite(skew) &&
    Math.abs(skew) >= THREE.MathUtils.degToRad(1.5) &&
    Math.abs(skew) <= THREE.MathUtils.degToRad(45)
  ) {
    const hipsWorldQ = new THREE.Quaternion();
    hips.getWorldQuaternion(hipsWorldQ);
    const yawed = yawTracksAroundWorldY(result, hipsWorldQ, THIGH_BONES, skew);
    const beforeUp = sampleHeadFootUpY(alignRoot, result, 0.05);
    restoreLocalsForAlign(alignRoot, restLocals);
    const afterUp = sampleHeadFootUpY(alignRoot, yawed, 0.05);
    restoreLocalsForAlign(alignRoot, restLocals);
    if (!(beforeUp != null && afterUp != null && afterUp < beforeUp * 0.9)) {
      result = yawed;
    }
  }

  restoreLocalsForAlign(alignRoot, restLocals);
  return result;
}

function sampleHeadFootUpY(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  timeSec: number,
): number | null {
  const saved = captureLocalsForAlign(root);
  let mixer: THREE.AnimationMixer | null = null;
  try {
    mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime(Math.max(0, Math.min(timeSec, Math.max(clip.duration - 1e-4, 0))));
    root.updateMatrixWorld(true);
    const head = findBone(root, ['Head', 'GargHead', 'mixamorigHead', 'mixamorig:Head']);
    const foot =
      findBone(root, ['LeftFoot', 'GargLLegAnkle', 'mixamorigLeftFoot', 'mixamorig:LeftFoot']) ??
      findBone(root, ['RightFoot', 'GargRAnkle', 'mixamorigRightFoot', 'mixamorig:RightFoot']);
    if (!head || !foot) return null;
    const up = head
      .getWorldPosition(new THREE.Vector3())
      .sub(foot.getWorldPosition(new THREE.Vector3()));
    const len = up.length();
    if (len < 1e-6) return null;
    return Math.abs(up.y) / len;
  } finally {
    mixer?.stopAllAction();
    restoreLocalsForAlign(root, saved);
  }
}

export type RootMotionMode = 'inplace' | 'travel';

export type RootMotionOptions = {
  /**
   * Hips bone (or any object whose `.position` the clip drives).
   * Required for correct in-place on Mixamo→glTF rigs where vertical hop
   * lives on local Z after the Armature +90° X, not local Y.
   */
  hips?: THREE.Object3D | null;
  /**
   * When true (default for Jump clips), also lock world Y so the hop is
   * removed — game code owns up/down. Walk/run keep hip bob unless set.
   */
  lockVertical?: boolean;
};

/**
 * In place: lock world-space horizontal travel.
 * Jump clips (or `lockVertical`) also lock world Y — static hips for sprite export.
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

  const lockVertical = opts.lockVertical ?? /jump/i.test(clip.name);
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

    // First key → world anchor (lock XZ; optionally Y for jumps).
    local.fromArray(values, 0);
    world.copy(local).applyMatrix4(parentWorld);
    const anchorX = world.x;
    const anchorY = world.y;
    const anchorZ = world.z;

    for (let i = 0; i < values.length; i += 3) {
      local.fromArray(values, i);
      world.copy(local).applyMatrix4(parentWorld);
      world.x = anchorX;
      world.z = anchorZ;
      if (lockVertical) world.y = anchorY;
      local.copy(world).applyMatrix4(parentInv);
      local.toArray(values, i);
    }
    return new THREE.VectorKeyframeTrack(track.name, track.times.slice(), values);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Left↔right mirror of a remapped clip (sagittal / YZ plane).
 * Swaps L/R bone tracks and reflects local position + quaternion keys.
 */
export function mirrorAnimationClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) {
      tracks.push(track.clone());
      continue;
    }
    const bonePath = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const leaf = bonePath.split('/').pop()?.split('|').pop() ?? bonePath;
    const mirroredBone = mirrorBoneName(leaf);
    const name = `${mirroredBone}.${prop}`;

    if (prop === 'position' && track instanceof THREE.VectorKeyframeTrack) {
      const values = track.values.slice();
      for (let i = 0; i < values.length; i += 3) {
        values[i] = -(values[i] ?? 0); // reflect lateral X
      }
      tracks.push(new THREE.VectorKeyframeTrack(name, track.times.slice(), values));
      continue;
    }

    if (prop === 'quaternion' && track instanceof THREE.QuaternionKeyframeTrack) {
      // Unity/Mixamo humanoid mirror across YZ: (x, -y, -z, w)
      const values = track.values.slice();
      for (let i = 0; i < values.length; i += 4) {
        values[i + 1] = -(values[i + 1] ?? 0);
        values[i + 2] = -(values[i + 2] ?? 0);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(name, track.times.slice(), values));
      continue;
    }

    // Scale / other channels: swap side, keep values.
    const cloned = track.clone();
    cloned.name = name;
    tracks.push(cloned);
  }

  const out = new THREE.AnimationClip(`${clip.name}_mirrored`, clip.duration, tracks);
  out.resetDuration();
  return out;
}

/** Swap Left/Right or L_/R_ in a bone leaf name; midline bones unchanged. */
export function mirrorBoneName(bone: string): string {
  if (/^Left/.test(bone)) return `Right${bone.slice(4)}`;
  if (/^Right/.test(bone)) return `Left${bone.slice(5)}`;
  if (/^L_/.test(bone)) return `R_${bone.slice(2)}`;
  if (/^R_/.test(bone)) return `L_${bone.slice(2)}`;
  // mixamorig:LeftArm / mixamorigLeftArm
  const mixamo = bone.match(/^(mixamorig:?|)(Left|Right)(.+)$/i);
  if (mixamo) {
    const prefix = mixamo[1] ?? '';
    const side = mixamo[2]!;
    const rest = mixamo[3]!;
    const flip = /^left$/i.test(side) ? 'Right' : 'Left';
    return `${prefix}${flip}${rest}`;
  }
  return bone;
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
 * SkeletonUtils writes `.bones[Name].quaternion` — flatten for scene mixers.
 */
function flattenBoneTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((t) => {
    const m = t.name.match(/\.bones\[([^\]]+)\]\.(.+)$/);
    if (!m) return t.clone();
    const cloned = t.clone();
    cloned.name = `${m[1]}.${m[2]}`;
    return cloned;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Retarget a same-named Tripo clip from a bake-source skin onto a different bind
 * (Alt / Simple ← Dorothy_new).
 */
export function retargetTripoClipBetweenSkins(
  clip: THREE.AnimationClip,
  target: THREE.SkinnedMesh,
  source: THREE.SkinnedMesh,
): THREE.AnimationClip {
  const names: Record<string, string> = {};
  const sourceNames = new Set(source.skeleton.bones.map((b) => b.name));
  for (const b of target.skeleton.bones) {
    if (sourceNames.has(b.name)) names[b.name] = b.name;
  }
  source.skeleton.pose();
  target.skeleton.pose();
  source.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const raw = retargetClip(target, source, clip, {
    hip: 'Pelvis',
    names,
    // Runtime SkeletonUtils uses preserveBonePositions; @types lag behind.
    preserveBonePositions: true,
  } as Parameters<typeof retargetClip>[3]);
  // retargetClip leaves both skins on the last sampled frame — restore binds.
  source.skeleton.pose();
  target.skeleton.pose();
  source.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  return flattenBoneTracks(raw);
}

/**
 * Same-skeleton pass-through (Gargoyle bones on winged monkey).
 * Quaternions only — Gargoyle FBX location channels are in pre-scale units and
 * will launch bones hundreds of units if applied raw.
 *
 * Facing offsets stay on the studio root (do not invent a second root yaw here).
 * Do NOT run alignClipFacingToRest here: MVP bind clavicles share a sternum head,
 * and fly poses make shoulder-line facing noisy — hip yaw then folds the mesh
 * (Fly Idle stretch / inverted torso). Clips are baked to the bind facing.
 */
export function passThroughClipForSkeleton(
  clip: THREE.AnimationClip,
  targetSkinned: THREE.SkinnedMesh,
  name?: string,
): THREE.AnimationClip {
  const boneNames = new Set(targetSkinned.skeleton.bones.map((b) => b.name));
  /** Root / pelvis only — fly height & hip bob. Limb positions smash fitted binds. */
  const positionBones = new Set(['GargPelvis', 'Pelvis', 'Hip', 'Hips']);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const bonePath = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const leaf = bonePath.split('/').pop()?.split('|').pop() ?? bonePath;
    if (!boneNames.has(leaf)) continue;
    if (prop === 'quaternion') {
      const cloned = track.clone();
      cloned.name = `${leaf}.${prop}`;
      tracks.push(cloned);
      continue;
    }
    if (prop === 'position' && positionBones.has(leaf)) {
      const cloned = track.clone();
      cloned.name = `${leaf}.${prop}`;
      tracks.push(cloned);
    }
  }

  return new THREE.AnimationClip(name ?? clip.name, clip.duration, tracks);
}

/**
 * Remap a clip onto the active Dorothy rig.
 * - MASTER-baked GLB: sanitize channel names only (already in MASTER bind space)
 * - Mixamo FBX fallback: rename + rotation-only (prefer baked clips)
 * - Optional retargetSource: SkeletonUtils when target bind ≠ clip bake bind
 */
export function remapClipToDorothy(
  clip: THREE.AnimationClip,
  opts: {
    name?: string;
    targetSkinned: THREE.SkinnedMesh;
    sourceRoot?: THREE.Object3D;
    kind?: DorothyRigKind;
    inPlace?: boolean;
    /** Skinned mesh whose bind matches the clip (e.g. Dorothy_new for Tripo bakes). */
    retargetSource?: THREE.SkinnedMesh;
    /**
     * Skip hip/thigh facing align. Use for Dorothy CC retargets that twist under
     * align (Skip / Ultimate / Wave / attacks). Do NOT skip Walk/Run/Idle/Jump —
     * those MASTER Mixamo bakes face ~90° off rest without align.
     */
    skipFacingAlign?: boolean;
  },
): THREE.AnimationClip {
  const kind = opts.kind ?? detectRigKind(opts.targetSkinned);

  let remapped: THREE.AnimationClip;
  if (!clipLooksMixamo(clip)) {
    remapped = sanitizeClip(clip, kind, opts.name);
  } else {
    const sourceRoot = opts.sourceRoot;
    if (!sourceRoot) {
      throw new Error('Mixamo remapping requires the source FBX scene graph');
    }
    remapped = retargetMixamoRenameOnly(clip, {
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      sourceRoot,
      targetSkinned: opts.targetSkinned,
      kind,
      ...(opts.inPlace !== undefined ? { inPlace: opts.inPlace } : {}),
    });
  }

  if (opts.retargetSource && kind === 'tripo') {
    remapped = retargetTripoClipBetweenSkins(remapped, opts.targetSkinned, opts.retargetSource);
  }

  if (opts.skipFacingAlign) {
    return remapped;
  }
  return alignClipFacingToRest(remapped, opts.targetSkinned);
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
