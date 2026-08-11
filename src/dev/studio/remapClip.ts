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
  // Prefer spine/hips — Head tracks are stripped on MASTER (locked), so Head local
  // stays bind while the body yaws underneath; spine tracks the clip facing.
  return (
    findBone(root, ['Spine2', 'Spine02', 'mixamorigSpine2', 'mixamorig:Spine2']) ??
    findBone(root, ['Spine1', 'Spine01', 'mixamorigSpine1', 'mixamorig:Spine1']) ??
    findBone(root, ['Hips', 'Pelvis', 'Hip', 'mixamorigHips', 'mixamorig:Hips']) ??
    findBone(root, ['Head', 'mixamorigHead', 'mixamorig:Head'])
  );
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

    const probe = findFacingProbeBone(root);
    if (!probe) return null;
    const worldX = new THREE.Vector3(1, 0, 0).applyQuaternion(
      probe.getWorldQuaternion(new THREE.Quaternion()),
    );
    return flatForward(worldX);
  } finally {
    mixer?.stopAllAction();
    restoreLocalsForAlign(root, saved);
  }
}

/**
 * Some MASTER bakes (Run / Idle / Jump) face ~90° off Walk/rest while hip travel
 * already matches studio East. Apply a yaw-only world correction to Hips keys.
 *
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
    findBone(alignRoot, ['Hips', 'Pelvis', 'Hip']) ??
    findBone(targetSkinned, ['Hips', 'Pelvis', 'Hip']);
  if (!hips) return clip;

  const restFwd = sampleFlatForward(alignRoot, null);
  const clipFwd = sampleFlatForward(alignRoot, clip, 0);
  if (!restFwd || !clipFwd) return clip;

  // Rotate clip facing → rest facing about world +Y (sign matches Three.js Yaw).
  const rawYaw = -signedYawBetween(clipFwd, restFwd);
  if (!Number.isFinite(rawYaw)) return clip;

  // Only correct near ±90°/±180° bake errors — keep the measured angle (don't
  // snap to exactly 90° or a ~13° residual stays in the run).
  const quarter = Math.PI / 2;
  const nearest = Math.round(rawYaw / quarter) * quarter;
  if (Math.abs(nearest) < quarter - 1e-3) return clip;
  if (Math.abs(rawYaw - nearest) > THREE.MathUtils.degToRad(40)) return clip;
  const deltaYaw = rawYaw;

  // Travel already matches studio East on Run — only yaw the hips orientation.
  // (Rotating positions when travel is already correct re-introduces crabbing.)
  const parent = hips.parent;
  parent?.updateWorldMatrix(true, false);
  // IMPORTANT: do NOT setFromRotationMatrix(matrixWorld) — studio roots are
  // uniformly scaled (~×2), and that pollutes the extracted rotation into a
  // tipped "up" axis (wall-run). Use world quaternion (scale-free).
  const parentQ = new THREE.Quaternion();
  if (parent) parent.getWorldQuaternion(parentQ);
  const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(parentQ.clone().invert()).normalize();
  if (localUp.lengthSq() < 1e-8) return clip;
  // Guard: world +Y in parent space must be near a horizontal local axis
  // (glTF Armature +90°X → ±Z). A dominant local Y means parent orientation
  // wasn't resolved — yawing about it tips the character onto the wall.
  if (Math.abs(localUp.y) > 0.5) return clip;
  const qDeltaLocal = new THREE.Quaternion().setFromAxisAngle(localUp, deltaYaw);

  const tracks = clip.tracks.map((track) => {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) return track.clone();
    const bone = track.name.slice(0, dot).split('/').pop()?.split('|').pop() ?? '';
    if (!HIP_BONES.has(bone)) return track.clone();

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

    // Leave hip position tracks untouched — preserves upright travel that already
    // matches studio East on the mis-faced Run bake.
    return track.clone();
  });

  const aligned = new THREE.AnimationClip(clip.name, clip.duration, tracks);

  // Safety rail: if the correction tips her (head–foot upY collapses), keep original.
  const beforeUp = sampleHeadFootUpY(alignRoot, clip, 0.05);
  const afterUp = sampleHeadFootUpY(alignRoot, aligned, 0.05);
  if (beforeUp != null && afterUp != null && afterUp < beforeUp * 0.9) {
    return clip;
  }
  return aligned;
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
    const head = findBone(root, ['Head', 'mixamorigHead', 'mixamorig:Head']);
    const foot =
      findBone(root, ['LeftFoot', 'mixamorigLeftFoot', 'mixamorig:LeftFoot']) ??
      findBone(root, ['RightFoot', 'mixamorigRightFoot', 'mixamorig:RightFoot']);
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
