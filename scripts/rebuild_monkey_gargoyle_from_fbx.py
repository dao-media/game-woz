#!/usr/bin/env python3
"""
Rebuild Gargoyle→monkey clips from a FRESH FBX source (never use corrupted blend source).

Why: WingedMonkey_gargoyle.blend's GargoyleSource rest was collapsed to ~origin, so
basis copies baked a jumbled ball. Fresh GargoyleHumanoid.FBX Idle/Fly are upright.

Bake rules:
  - Strip FBX *object* loc/rot/scale keys first — they reset every frame and
    undo the East-align yaw (Walk stays native −Y while bind faces +X → SW stride)
  - Rotation: rest-relative world retarget (src_rest⁻¹ @ src_pose → apply on tgt rest).
    Raw matrix_basis copy only works when rest bone axes match; MVP wings/ribcage
    differ from FBX, so Fly Idle folded (ankles above head, wing spike).
  - No pelvis/limb locations (FBX locs are junk after fit)
  - Export anim-only (no skins)

Also realigns NEW mesh (masters) onto the fitted Gargoyle bind.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/rebuild_monkey_gargoyle_from_fbx.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
CHAR_GLB = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
NEW_MASTER = ROOT / "masters/wingedmonkey/meshes/WingedMonkey_NEW.glb"
GARGOYLE_FBX = (
    ROOT
    / "Unity/Wizard-of-Oz-Game/Assets/Magic Pig Games (Infinity PBR)/Characters/Gargoyle/Models/GargoyleHumanoid.FBX"
)
OUT_CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
OUT_NEW = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.blend"
OUT_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle"

CLIPS: list[tuple[str, int, int]] = [
    ("Tpose", 0, 5),
    ("Idle", 80, 190),
    ("IdleBreak", 200, 340),
    ("Walk", 360, 390),
    ("Attack01", 410, 470),
    ("Cast01", 470, 545),
    ("Cast02", 545, 570),
    ("Cast03", 570, 608),
    ("Sheild01", 610, 630),
    ("Sheild02", 630, 680),
    ("Sheild03", 680, 700),
    ("Attack02", 720, 785),
    ("Hit", 800, 885),
    ("DeathStanding", 900, 940),
    ("Statue01", 964, 966),
    ("Statue02", 984, 987),
    ("Statue03", 1004, 1006),
    ("GroundToFly", 1140, 1179),
    ("FlyForward", 1180, 1210),
    ("FlyToIdle", 1240, 1300),
    ("FlyIdleLoop", 1305, 1335),
    ("IdleToFly", 1330, 1390),
    ("FlyAttack01", 1410, 1490),
    ("FlyAttack02", 1520, 1600),
    ("FlyCast", 1620, 1735),
    ("DieFly", 1750, 1850),
    ("FlyLand", 1870, 1900),
    ("FlyBackward", 1930, 1960),
    ("FlyHit", 1990, 2065),
    ("WalkBackward", 2120, 2160),
]


def action_fcurves(action: bpy.types.Action):
    if hasattr(action, "layers") and action.layers:
        for layer in action.layers:
            for strip in getattr(layer, "strips", []) or []:
                for bag in getattr(strip, "channelbags", []) or []:
                    yield from getattr(bag, "fcurves", []) or []
        return
    yield from getattr(action, "fcurves", []) or []


def _action_channelbags(action: bpy.types.Action):
    """Yield (container, fcurve_list_attr) for Blender 4.x and 5.x actions."""
    if hasattr(action, "layers") and action.layers:
        for layer in action.layers:
            for strip in getattr(layer, "strips", []) or []:
                for bag in getattr(strip, "channelbags", []) or []:
                    yield bag
        return
    yield action


def strip_object_transform_channels(action: bpy.types.Action) -> int:
    """Remove armature-object loc/rot/scale keys so object align survives frame_set."""
    remove_prefixes = (
        "location",
        "rotation_euler",
        "rotation_quaternion",
        "rotation_axis_angle",
        "scale",
        "delta_location",
        "delta_rotation_euler",
        "delta_rotation_quaternion",
        "delta_scale",
    )
    removed = 0
    for bag in _action_channelbags(action):
        fcurves = getattr(bag, "fcurves", None)
        if fcurves is None:
            continue
        doomed = [
            fc
            for fc in list(fcurves)
            if not fc.data_path.startswith("pose.bones")
            and any(fc.data_path == p or fc.data_path.startswith(p + "[") for p in remove_prefixes)
        ]
        for fc in doomed:
            fcurves.remove(fc)
            removed += 1
    return removed


def retime_action_to_zero(action: bpy.types.Action, frame_start: int, frame_end: int) -> None:
    offset = -float(frame_start)
    for fcu in action_fcurves(action):
        for kp in fcu.keyframe_points:
            kp.co[0] += offset
            kp.handle_left[0] += offset
            kp.handle_right[0] += offset
        fcu.update()
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = max(0, frame_end - frame_start)


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def world_bone_head(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def world_pose_head(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.pose.bones[name].matrix.translation


def align_source_object_to_bind(src: bpy.types.Object, bind: bpy.types.Object) -> None:
    """Object-level scale/loc/yaw only — never apply into source bones/action.

    FBX Take keys armature object transforms; strip those first or frame_set
    undoes this yaw and Walk stays native −Y while the bind faces +X.
    """
    if src.animation_data and src.animation_data.action:
        n = strip_object_transform_channels(src.animation_data.action)
        print(f"stripped {n} object transform fcurves from source action")

    # Freeze evaluated object TRS as the new baseline (keeps FBX 0.01 scale).
    bpy.context.view_layer.update()
    src.location = src.matrix_world.to_translation()
    src.rotation_mode = "XYZ"
    src.rotation_euler = src.matrix_world.to_euler("XYZ")
    src.scale = src.matrix_world.to_scale()
    bpy.context.view_layer.update()

    # FBX arrives at ~0.01 scale; multiply, do not replace.
    s_hip = world_bone_head(src, "GargPelvis")
    b_hip = world_bone_head(bind, "GargPelvis")
    factor = abs(b_hip.z) / max(abs(s_hip.z), 1e-6)
    src.scale *= factor
    bpy.context.view_layer.update()

    s_hip = world_bone_head(src, "GargPelvis")
    src.location += b_hip - s_hip
    bpy.context.view_layer.update()

    def flat_fwd(arm: bpy.types.Object, left: str, right: str) -> Vector:
        ls = world_bone_head(arm, left)
        rs = world_bone_head(arm, right)
        right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
        if right_v.length < 1e-8:
            return Vector((0.0, 1.0, 0.0))
        right_v.normalize()
        f = Vector((0.0, 0.0, 1.0)).cross(right_v)
        return f.normalized() if f.length > 1e-8 else Vector((0.0, 1.0, 0.0))

    try:
        g_fwd = flat_fwd(src, "GargLArmCollarbone", "GargRCollarbone")
        b_fwd = flat_fwd(bind, "GargLArmCollarbone", "GargRCollarbone")
        yaw = math.atan2(
            g_fwd.x * b_fwd.y - g_fwd.y * b_fwd.x,
            g_fwd.x * b_fwd.x + g_fwd.y * b_fwd.y,
        )
        src.rotation_euler[2] += yaw
        bpy.context.view_layer.update()
        s_hip = world_bone_head(src, "GargPelvis")
        src.location += b_hip - s_hip
        bpy.context.view_layer.update()
        print(f"align yaw deg={math.degrees(yaw):.1f}")
    except KeyError:
        pass

    # Prove Walk facing survives frame_set after strip+align.
    bpy.context.scene.frame_set(360)
    bpy.context.view_layer.update()
    try:
        ls = world_pose_head(src, "GargLArmCollarbone")
        rs = world_pose_head(src, "GargRCollarbone")
        right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
        if right_v.length > 1e-8:
            right_v.normalize()
            fwd = Vector((0.0, 0.0, 1.0)).cross(right_v).normalized()
            print(
                f"Walk f360 chest yaw after align="
                f"{math.degrees(math.atan2(fwd.x, fwd.y)):.1f} "
                f"(bind rest ~90=East)"
            )
    except KeyError:
        pass

    print(
        f"aligned source scale={tuple(round(c, 5) for c in src.scale)} "
        f"srcHip={[round(c, 3) for c in world_bone_head(src, 'GargPelvis')]} "
        f"srcHeadRest={[round(c, 3) for c in world_bone_head(src, 'GargHead')]}"
    )


def rest_world_matrices(arm: bpy.types.Object) -> dict[str, Matrix]:
    """Armature-space rest → world (independent of current pose)."""
    mw = arm.matrix_world
    return {b.name: (mw @ b.matrix_local).copy() for b in arm.data.bones}


def parent_relative_full_quat(arm: bpy.types.Object, bname: str):
    """Pose bone rotation in parent space (glTF node local / Three.js bone.quaternion)."""
    pb = arm.pose.bones[bname]
    if pb.parent:
        return (pb.parent.matrix.inverted() @ pb.matrix).to_quaternion()
    return pb.matrix.to_quaternion()


def patch_glb_root_bone_rotations(
    path: Path,
    bone_name: str,
    quats_xyzw: list[tuple[float, float, float, float]],
) -> None:
    """Blender glTF export often writes the armature *root* bone near rest.

    Non-root bones export correctly; patch root channels so Studio pass-through
    (full local quats) matches the upright bake pose.
    """
    import struct

    raw = bytearray(path.read_bytes())
    magic, version, length = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise RuntimeError(f"Not a GLB: {path}")
    off = 12
    clen, ctype = struct.unpack_from("<II", raw, off)
    if ctype != 0x4E4F534A:
        raise RuntimeError("GLB missing JSON chunk")
    gltf = json.loads(bytes(raw[off + 8 : off + 8 + clen]))
    bin_off = off + 8 + clen
    blen, btype = struct.unpack_from("<II", raw, bin_off)
    if btype != 0x004E4942:
        raise RuntimeError("GLB missing BIN chunk")
    bin_start = bin_off + 8

    nodes = gltf["nodes"]
    name_of = {i: n.get("name", "") for i, n in enumerate(nodes)}
    patched = 0
    for anim in gltf.get("animations", []):
        for ch in anim["channels"]:
            if name_of.get(ch["target"]["node"]) != bone_name:
                continue
            if ch["target"]["path"] != "rotation":
                continue
            samp = anim["samplers"][ch["sampler"]]
            acc = gltf["accessors"][samp["output"]]
            bv = gltf["bufferViews"][acc["bufferView"]]
            start = bin_start + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            count = acc["count"]
            if count != len(quats_xyzw):
                raise RuntimeError(
                    f"{bone_name} rotation count {count} != bake {len(quats_xyzw)}"
                )
            stride = bv.get("byteStride") or 16
            for i, q in enumerate(quats_xyzw):
                struct.pack_into("<4f", raw, start + i * stride, *q)
            patched += 1
    if not patched:
        raise RuntimeError(f"No {bone_name} rotation channel in {path.name}")
    path.write_bytes(raw)
    print(f"  patched {bone_name} rotations ({patched} channel(s), {len(quats_xyzw)} keys)")


def bake_clip(
    src: bpy.types.Object,
    tgt: bpy.types.Object,
    name: str,
    frame_start: int,
    frame_end: int,
) -> tuple[bpy.types.Action, list[tuple[float, float, float, float]]]:
    """Bake shared bones via rest-relative world retarget.

    For each bone: rel = src_rest⁻¹ @ src_pose_world; tgt_pose = tgt_rest @ rel.
    Keeps Fly Idle upright when MVP rest axes ≠ FBX rest axes. Rotation-only
    keys (locations zeroed) — studio pass-through uses quats + pelvis pos.

    Also returns GargPelvis full-local quats (xyzw) for glTF root-bone patch.
    """
    clear_pose(tgt)
    if not tgt.animation_data:
        tgt.animation_data_create()
    action = bpy.data.actions.new(name=name)
    tgt.animation_data.action = action

    shared_set = {pb.name for pb in tgt.pose.bones if pb.name in src.pose.bones}

    def depth(n: str) -> int:
        d = 0
        b = tgt.data.bones[n]
        while b.parent:
            d += 1
            b = b.parent
        return d

    shared = sorted(shared_set, key=depth)
    src_rest = rest_world_matrices(src)
    tgt_rest = rest_world_matrices(tgt)
    src_mw = src.matrix_world
    tgt_mw_inv = tgt.matrix_world.inverted()
    pelvis_full: list[tuple[float, float, float, float]] = []

    frames = list(range(frame_start, frame_end + 1))
    for fr in frames:
        bpy.context.scene.frame_set(fr)
        bpy.context.view_layer.update()

        for bname in shared:
            sp = src.pose.bones[bname]
            tp = tgt.pose.bones[bname]
            tp.rotation_mode = "QUATERNION"
            src_pose_world = src_mw @ sp.matrix
            rel = src_rest[bname].inverted() @ src_pose_world
            tgt_pose_world = tgt_rest[bname] @ rel
            tp.matrix = tgt_mw_inv @ tgt_pose_world
            bpy.context.view_layer.update()
            _loc, rot, _sca = tp.matrix_basis.decompose()
            tp.rotation_quaternion = rot
            tp.location = Vector((0.0, 0.0, 0.0))
            tp.scale = Vector((1.0, 1.0, 1.0))
            tp.keyframe_insert(data_path="rotation_quaternion", frame=fr)

        bpy.context.view_layer.update()
        pq = parent_relative_full_quat(tgt, "GargPelvis")
        # glTF / Three.js: xyzw
        pelvis_full.append((pq.x, pq.y, pq.z, pq.w))

        if fr == frame_start or fr == frame_end or fr % 40 == 0:
            head = world_pose_head(tgt, "GargHead")
            pel = world_pose_head(tgt, "GargPelvis")
            ank = world_pose_head(tgt, "GargLLegAnkle")
            # Folded bake puts ankles above the head; fly may tuck legs under torso.
            upright = head.z > pel.z + 0.05 and ank.z < head.z
            print(
                f"  {name} f{fr} head_z={head.z:.3f} pel_z={pel.z:.3f} "
                f"ank_z={ank.z:.3f} upright={upright}"
            )

    retime_action_to_zero(action, frame_start, frame_end)
    for fcu in action_fcurves(action):
        for kp in fcu.keyframe_points:
            kp.interpolation = "LINEAR"
    print(f"  baked {name}: frames={len(frames)} bones={len(shared)}")
    return action, pelvis_full


def export_anim_only(
    path: Path,
    arm: bpy.types.Object,
    action: bpy.types.Action,
    f0: int,
    f1: int,
    pelvis_full_xyzw: list[tuple[float, float, float, float]] | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and getattr(action, "slots", None):
        try:
            arm.animation_data.action_slot = action.slots[0]
        except Exception:
            pass
    dur = max(0, f1 - f0)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = dur
    scene.frame_set(0)

    hidden: list[tuple[bpy.types.Object, bool]] = []
    for o in bpy.data.objects:
        if o != arm:
            hidden.append((o, o.hide_get()))
            o.hide_set(True)
    try:
        bpy.ops.object.select_all(action="DESELECT")
        arm.hide_set(False)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.export_scene.gltf(
            filepath=str(path),
            export_format="GLB",
            use_selection=True,
            export_animations=True,
            export_animation_mode="ACTIVE_ACTIONS",
            export_nla_strips=False,
            export_skins=False,
            export_morph=False,
            export_apply=False,
            export_materials="NONE",
            export_texcoords=False,
            export_normals=False,
            export_optimize_animation_size=False,
            export_optimize_animation_keep_anim_armature=True,
        )
    finally:
        for o, h in hidden:
            o.hide_set(h)
    if pelvis_full_xyzw:
        patch_glb_root_bone_rotations(path, "GargPelvis", pelvis_full_xyzw)
    print(f"  wrote {path.name} ({path.stat().st_size} bytes)")


def export_skinned(path: Path, arm: bpy.types.Object, mesh: bpy.types.Object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != mesh and (
            o.name.startswith("Ico") or len(o.data.vertices) < 1000
        ):
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(o in {arm, mesh})
        if o in {arm, mesh}:
            o.hide_set(False)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
    )
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def align_mesh_aabb_to_donor(dst: bpy.types.Object, donor: bpy.types.Object) -> None:
    """Snap NEW mesh into donor bind space (fixes waist-through-floor: NEW was z=-0.5..0.5)."""
    dst.data = dst.data.copy()  # ensure single-user
    # Bake object transform into verts first so local == world
    bpy.ops.object.select_all(action="DESELECT")
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    dcoords = [donor.matrix_world @ v.co for v in donor.data.vertices]
    ncoords = [Vector(v.co) for v in dst.data.vertices]
    dmin = Vector((min(c.x for c in dcoords), min(c.y for c in dcoords), min(c.z for c in dcoords)))
    dmax = Vector((max(c.x for c in dcoords), max(c.y for c in dcoords), max(c.z for c in dcoords)))
    nmin = Vector((min(c.x for c in ncoords), min(c.y for c in ncoords), min(c.z for c in ncoords)))
    nmax = Vector((max(c.x for c in ncoords), max(c.y for c in ncoords), max(c.z for c in ncoords)))
    dsize = dmax - dmin
    nsize_raw = nmax - nmin
    nsize = Vector((max(nsize_raw.x, 1e-6), max(nsize_raw.y, 1e-6), max(nsize_raw.z, 1e-6)))

    for v in dst.data.vertices:
        local = Vector(
            (
                (v.co.x - nmin.x) / nsize.x,
                (v.co.y - nmin.y) / nsize.y,
                (v.co.z - nmin.z) / nsize.z,
            )
        )
        v.co = Vector(
            (
                dmin.x + local.x * dsize.x,
                dmin.y + local.y * dsize.y,
                dmin.z + local.z * dsize.z,
            )
        )
    dst.data.update()
    bpy.context.view_layer.update()
    coords = [Vector(v.co) for v in dst.data.vertices]
    print(
        f"aligned NEW mesh z=[{min(c.z for c in coords):.3f},{max(c.z for c in coords):.3f}] "
        f"(donor z=[{dmin.z:.3f},{dmax.z:.3f}])"
    )


def transfer_weights(dst: bpy.types.Object, src: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.context.view_layer.update()
    bpy.ops.object.data_transfer(
        data_type="VGROUP_WEIGHTS",
        use_auto_transform=False,
        layers_select_src="ALL",
        layers_select_dst="NAME",
        mix_mode="REPLACE",
        mix_factor=1.0,
        vert_mapping="NEAREST",
    )
    print(
        f"weights → {sum(1 for v in dst.data.vertices if v.groups)}/{len(dst.data.vertices)} "
        f"groups={len(dst.vertex_groups)}"
    )


def bind(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            mesh.modifiers.remove(mod)
    if mesh.parent:
        mw = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = mw
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_NAME")
    for mod in mesh.modifiers:
        if mod.type == "ARMATURE":
            mod.object = arm


def main() -> None:
    quick = os.environ.get("REBAKE_QUICK", "").strip() in {"1", "true", "yes"}
    clips = (
        [c for c in CLIPS if c[0] in {"Tpose", "Idle", "Walk", "FlyIdleLoop", "GroundToFly"}]
        if quick
        else CLIPS
    )

    for p in (CHAR_GLB, GARGOYLE_FBX, NEW_MASTER):
        if not p.exists():
            raise SystemExit(f"Missing {p}")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # --- Bind character (fitted Gargoyle + weighted mesh) ---
    bpy.ops.import_scene.gltf(filepath=str(CHAR_GLB))
    bind_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    bind_arm.name = "GargoyleMonkey"
    donor = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    donor.name = "WingedMonkey"
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != donor:
            bpy.data.objects.remove(o, do_unlink=True)
    print(
        f"bind bones={len(bind_arm.data.bones)} mesh_verts={len(donor.data.vertices)} "
        f"head={[round(c,3) for c in world_bone_head(bind_arm,'GargHead')]}"
    )

    # --- Fresh FBX source (do NOT apply transforms) ---
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(GARGOYLE_FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    added = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in added if o.type == "ARMATURE")
    src.name = "GargoyleSource"
    for o in list(added):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if not src.animation_data or not src.animation_data.action:
        raise SystemExit("FBX has no action")
    src_action = src.animation_data.action
    # Kill any leftover FBX empties/icospheres in the scene
    for o in list(bpy.data.objects):
        if o not in {bind_arm, donor, src} and o.type != "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)
    align_source_object_to_bind(src, bind_arm)

    # Sanity: Idle F80 head above pelvis on source
    bpy.context.scene.frame_set(80)
    bpy.context.view_layer.update()
    sh = world_pose_head(src, "GargHead")
    sp = world_pose_head(src, "GargPelvis")
    print(f"source Idle F80 head_z={sh.z:.3f} pel_z={sp.z:.3f}")
    if sh.z < sp.z:
        raise SystemExit("Fresh FBX source still has head below pelvis after align — abort")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    summary = {
        "method": "fresh_fbx_rest_relative_world_retarget_mvp_patch_root_pelvis",
        "bind_bones": len(bind_arm.data.bones),
        "clips": [],
        "quick": quick,
    }

    for clip_name, f0, f1 in clips:
        print(f"bake {clip_name} {f0}..{f1}")
        src.animation_data.action = src_action
        action, pelvis_full = bake_clip(src, bind_arm, clip_name, f0, f1)
        export_anim_only(
            OUT_DIR / f"{clip_name}.glb",
            bind_arm,
            action,
            f0,
            f1,
            pelvis_full_xyzw=pelvis_full,
        )
        summary["clips"].append({"name": clip_name, "frames": [f0, f1], "bytes": (OUT_DIR / f"{clip_name}.glb").stat().st_size})
        if bind_arm.animation_data:
            bind_arm.animation_data.action = None
        bpy.data.actions.remove(action)
        clear_pose(bind_arm)

    # --- NEW mesh skinned to same bind ---
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(NEW_MASTER))
    added = [o for o in bpy.data.objects if o not in before]
    new_mesh = next(o for o in added if o.type == "MESH" and len(o.data.vertices) > 1000)
    new_mesh.name = "WingedMonkeyNEW"
    for o in list(added):
        if o != new_mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    align_mesh_aabb_to_donor(new_mesh, donor)
    transfer_weights(new_mesh, donor)
    # Duplicate armature for NEW export? Same arm — export separately.
    # Bind NEW, export, restore donor bind for character export.
    bind(new_mesh, bind_arm)
    export_skinned(OUT_NEW, bind_arm, new_mesh)

    # Re-bind donor as primary character
    bpy.data.objects.remove(new_mesh, do_unlink=True)
    bind(donor, bind_arm)
    src.hide_viewport = True
    src.hide_render = True
    export_skinned(OUT_CHAR, bind_arm, donor)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    (OUT_DIR / "_bake_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"DONE clips={len(summary['clips'])} char={OUT_CHAR.name} new={OUT_NEW.name}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("REBUILD FAILED:", e, file=sys.stderr)
        raise
