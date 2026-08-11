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

function findSkinnedMeshIn(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.SkinnedMesh).isSkinnedMesh) {
      found = obj as THREE.SkinnedMesh;
    }
  });
  return found;
}

/**
 * Sample character forward at bind or after applying a clip.
 * Mixamo Dorothy: local +X on spine/hips ≈ mesh forward after studio MODEL_YAW.
 */
function sampleFlatForward(
  root: THREE.Object3D,
  clip: THREE.AnimationClip | null,
  timeSec = 0,
): THREE.Vector3 | null {
  const skinned = findSkinnedMeshIn(root);
  skinned?.skeleton.pose();
  root.updateMatrixWorld(true);

  let mixer: THREE.AnimationMixer | null = null;
  if (clip) {
    mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime(Math.max(0, Math.min(timeSec, Math.max(clip.duration - 1e-4, 0))));
    root.updateMatrixWorld(true);
  }

  const probe = findFacingProbeBone(root);
  if (!probe) {
    mixer?.stopAllAction();
    return null;
  }
  const worldX = new THREE.Vector3(1, 0, 0).applyQuaternion(
    probe.getWorldQuaternion(new THREE.Quaternion()),
  );
  const fwd = flatForward(worldX);
  mixer?.stopAllAction();
  skinned?.skeleton.pose();
  root.updateMatrixWorld(true);
  return fwd;
}

/** Max horizontal hip travel over the clip (world XZ), for pad/facing heuristics. */
function sampleHipTravel(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  hips: THREE.Bone,
): THREE.Vector3 {
  const skinned = findSkinnedMeshIn(root);
  skinned?.skeleton.pose();
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  let start: THREE.Vector3 | null = null;
  const max = new THREE.Vector3();
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    mixer.setTime((clip.duration * i) / steps);
    root.updateMatrixWorld(true);
    const p = hips.getWorldPosition(new THREE.Vector3());
    if (!start) start = p.clone();
    const d = p.clone().sub(start);
    d.y = 0;
    if (d.lengthSq() > max.lengthSq()) max.copy(d);
  }
  mixer.stopAllAction();
  skinned?.skeleton.pose();
  root.updateMatrixWorld(true);
  return max;
}

/**
 * Some MASTER bakes (Run / Idle / Jump) face ~90° off Walk/rest while hip travel
 * already matches studio East. Rotate Hips keys about world +Y so facing matches
 * rest; only rotate hip positions when travel itself is also misaligned.
 */
function alignClipFacingToRest(
  clip: THREE.AnimationClip,
  targetSkinned: THREE.SkinnedMesh,
): THREE.AnimationClip {
  // Studio applies MODEL_YAW on the character root (mixer root), not the skinned mesh.
  let alignRoot: THREE.Object3D = targetSkinned;
  for (let cur: THREE.Object3D | null = targetSkinned; cur && cur.type !== 'Scene'; cur = cur.parent) {
    alignRoot = cur;
  }

  const hips =
    findBone(alignRoot, ['Hips', 'Pelvis', 'Hip']) ??
    findBone(targetSkinned, ['Hips', 'Pelvis', 'Hip']);
  if (!hips) return clip;

  const restFwd = sampleFlatForward(alignRoot, null);
  // Prefer t≈0 — mid-clip attack poses are not facing signals.
  const clipFwd = sampleFlatForward(alignRoot, clip, 0);
  if (!restFwd || !clipFwd) return clip;

  // Three.js +Y rotation is opposite the (x,z) cross used by signedYawBetween(from,to).
  const rawDelta = -signedYawBetween(clipFwd, restFwd);
  if (!Number.isFinite(rawDelta)) return clip;

  // MASTER bake errors are ~±90° (Run/Idle/Jump). Ignore small pose noise / windups.
  const quarter = Math.PI / 2;
  const snapped = Math.round(rawDelta / quarter) * quarter;
  if (Math.abs(snapped) < quarter - 1e-3) return clip;
  if (Math.abs(rawDelta - snapped) > THREE.MathUtils.degToRad(25)) return clip;
  const deltaYaw = snapped;

  const travel = sampleHipTravel(alignRoot, clip, hips);
  const travelLen = travel.length();
  let rotatePositions = false;
  if (travelLen > 0.02) {
    const travelFwd = travel.clone().normalize();
    const errVsRest = Math.abs(signedYawBetween(travelFwd, restFwd));
    const errVsClip = Math.abs(signedYawBetween(travelFwd, clipFwd));
    // Travel already matches rest (Run): fix facing only. Travel matches wrong
    // facing: rotate positions with the body.
    rotatePositions = errVsClip + THREE.MathUtils.degToRad(15) < errVsRest;
  }

  const parent = hips.parent;
  parent?.updateWorldMatrix(true, false);
  const parentWorld = parent?.matrixWorld.clone() ?? new THREE.Matrix4();
  const parentInv = parentWorld.clone().invert();
  const parentQ = new THREE.Quaternion().setFromRotationMatrix(parentWorld);
  const parentQInv = parentQ.clone().invert();
  const qWorld = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deltaYaw);
  const qDeltaLocal = parentQInv.clone().multiply(qWorld).multiply(parentQ);

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

    if (
      rotatePositions &&
      track instanceof THREE.VectorKeyframeTrack &&
      track.name.endsWith('.position')
    ) {
      const values = track.values.slice();
      const local = new THREE.Vector3();
      const world = new THREE.Vector3();
      local.fromArray(values, 0);
      const pivot = local.clone().applyMatrix4(parentWorld);
      for (let i = 0; i < values.length; i += 3) {
        local.fromArray(values, i);
        world.copy(local).applyMatrix4(parentWorld);
        world.sub(pivot).applyQuaternion(qWorld).add(pivot);
        local.copy(world).applyMatrix4(parentInv);
        local.toArray(values, i);
      }
      return new THREE.VectorKeyframeTrack(track.name, track.times.slice(), values);
    }

    return track.clone();
  });

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
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
