#!/usr/bin/env python3
"""
Clean Monkey Gargoyle bind axes: feet forward, shoulders untwisted, FBX rolls.

Issues seen in studio skeleton overlay:
  - Ankle bones pointed down (−Z) instead of along the foot (−Y / forward)
  - Tripo clavicle heads sat on a front/back line (same X), twisting shoulder frame
  - align_roll drift left arm/leg secondary axes feeling 'wonky'

Keeps current fitted lengths/wing span. Masters untouched.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/cleanup_monkey_bind_axes.py
"""
from __future__ import annotations

import json
import math
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
REPORT = ROOT / "models/wingedmonkey/Animations/gargoyle/_bind_axis_cleanup.json"


def wh(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def wt(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].tail_local


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def mesh_bbox(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    return (
        Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
        Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))),
    )


def character_forward(arm: bpy.types.Object) -> Vector:
    """Mixamo-style forward = −Y when hips are L/R on X."""
    lt = wh(arm, "GargLLegThigh1")
    rt = wh(arm, "GargRThigh1")
    right = Vector((rt.x - lt.x, rt.y - lt.y, 0.0))
    if right.length < 1e-6:
        return Vector((0.0, -1.0, 0.0))
    right.normalize()
    fwd = Vector((0.0, 0.0, 1.0)).cross(right)
    return fwd.normalized() if fwd.length > 1e-6 else Vector((0.0, -1.0, 0.0))


def foot_landmarks(mesh: bpy.types.Object, side: str) -> tuple[Vector, Vector, Vector]:
    """Return (ankle_approx, heel, toe_tip) from mesh."""
    mn, mx = mesh_bbox(mesh)
    z_cut = mn.z + 0.10 * (mx.z - mn.z)
    pts = []
    for v in mesh.data.vertices:
        p = mesh.matrix_world @ v.co
        if p.z > z_cut:
            continue
        if side == "L" and p.x < 0.02:
            continue
        if side == "R" and p.x > -0.02:
            continue
        pts.append(p)
    if not pts:
        raise RuntimeError(f"No foot verts for {side}")
    heel = max(pts, key=lambda p: p.y)  # +Y = back (Mixamo)
    toe = min(pts, key=lambda p: p.y)  # −Y = forward
    ankle = Vector(
        (
            0.5 * (heel.x + toe.x),
            0.55 * heel.y + 0.45 * toe.y,
            max(p.z for p in pts) + 0.02,
        )
    )
    return ankle, heel, toe


def shoulder_socket(mesh: bpy.types.Object, side: str) -> Vector:
    """Approximate deltoid/socket — not wing tip."""
    mn, mx = mesh_bbox(mesh)
    z_lo = mn.z + 0.68 * (mx.z - mn.z)
    z_hi = mn.z + 0.76 * (mx.z - mn.z)
    best = None
    best_score = -1.0
    for v in mesh.data.vertices:
        p = mesh.matrix_world @ v.co
        if p.z < z_lo or p.z > z_hi:
            continue
        # Prefer moderate |x| (body shoulder), reject wing extremities
        ax = abs(p.x)
        if ax < 0.06 or ax > 0.18:
            continue
        if side == "L" and p.x < 0:
            continue
        if side == "R" and p.x > 0:
            continue
        # Prefer slightly back of centerline of this band
        score = ax - 0.15 * abs(p.y)
        if score > best_score:
            best_score = score
            best = p.copy()
    if best is None:
        # Fallback
        return Vector((0.10 if side == "L" else -0.10, -0.02, mn.z + 0.72 * (mx.z - mn.z)))
    return best


def set_bone(
    arm: bpy.types.Object,
    name: str,
    head_w: Vector,
    tail_w: Vector,
    guide: Vector,
) -> None:
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones[name]
    inv = arm.matrix_world.inverted()
    eb.head = inv @ head_w
    eb.tail = inv @ tail_w
    if (eb.tail - eb.head).length < 1e-5:
        eb.tail = eb.head + Vector((0, 0, 0.01))
    axis = (tail_w - head_w).normalized()
    g = guide - axis * guide.dot(axis)
    if g.length < 1e-6:
        g = Vector((0, 1, 0)) if abs(axis.dot(Vector((0, 1, 0)))) < 0.9 else Vector((1, 0, 0))
        g = g - axis * guide.dot(axis)
    try:
        eb.align_roll(g.normalized())
    except Exception:
        pass
    bpy.ops.object.mode_set(mode="OBJECT")


def snapshot_fbx_guides(src: bpy.types.Object) -> dict[str, Vector]:
    guides: dict[str, Vector] = {}
    for b in src.data.bones:
        x = (src.matrix_world @ b.matrix_local).to_3x3() @ Vector((1, 0, 0))
        if x.length > 1e-8:
            guides[b.name] = x.normalized()
    return guides


def align_fbx_to_bind(src: bpy.types.Object, bind: bpy.types.Object) -> None:
    bpy.context.view_layer.update()
    src.location = src.matrix_world.to_translation()
    src.rotation_mode = "XYZ"
    src.rotation_euler = src.matrix_world.to_euler("XYZ")
    src.scale = src.matrix_world.to_scale()
    bpy.context.view_layer.update()
    s_hip = wh(src, "GargPelvis")
    t_hip = wh(bind, "GargPelvis")
    factor = abs(t_hip.z) / max(abs(s_hip.z), 1e-6)
    src.scale *= factor
    bpy.context.view_layer.update()
    s_hip = wh(src, "GargPelvis")
    src.location.z += t_hip.z - s_hip.z
    src.location.x -= s_hip.x
    src.location.y -= wh(src, "GargPelvis").y
    bpy.context.view_layer.update()
    # Yaw so FBX hip L→R matches bind hip L→R
    def hip_right(arm: bpy.types.Object) -> Vector:
        d = wh(arm, "GargRThigh1") - wh(arm, "GargLLegThigh1")
        d.z = 0
        return d.normalized() if d.length > 1e-8 else Vector((1, 0, 0))

    br, sr = hip_right(bind), hip_right(src)
    yaw = math.atan2(sr.x * br.y - sr.y * br.x, sr.x * br.x + sr.y * br.y)
    src.rotation_euler[2] += yaw
    bpy.context.view_layer.update()
    s_hip = wh(src, "GargPelvis")
    src.location.z += t_hip.z - s_hip.z
    src.location.x -= s_hip.x
    src.location.y -= wh(src, "GargPelvis").y
    bpy.context.view_layer.update()


def reapply_rolls(arm: bpy.types.Object, guides: dict[str, Vector]) -> int:
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    n = 0
    for b in arm.data.bones:
        if b.name not in eb or b.name not in guides:
            continue
        e = eb[b.name]
        h_w = arm.matrix_world @ e.head
        t_w = arm.matrix_world @ e.tail
        axis = (t_w - h_w).normalized() if (t_w - h_w).length > 1e-8 else Vector((0, 0, 1))
        g = guides[b.name] - axis * guides[b.name].dot(axis)
        if g.length < 1e-6:
            continue
        try:
            e.align_roll(g.normalized())
            n += 1
        except Exception:
            pass
    bpy.ops.object.mode_set(mode="OBJECT")
    return n


def fix_feet(arm: bpy.types.Object, mesh: bpy.types.Object, guides: dict[str, Vector]) -> dict:
    fwd = character_forward(arm)
    out = {}
    for side, ankle_n, toe_n, calf_n in (
        ("L", "GargLLegAnkle", "GargLLegToe1", "GargLLegCalf2"),
        ("R", "GargRAnkle", "GargRToe1", "GargRCalf2"),
    ):
        ankle_m, heel, toe = foot_landmarks(mesh, side)
        # Keep ankle near current calf end height/position but aim toward toe
        calf_tail = wt(arm, calf_n) if calf_n in arm.data.bones else ankle_m
        ankle_head = Vector((ankle_m.x, ankle_m.y, calf_tail.z * 0.35 + ankle_m.z * 0.65))
        # Ball of foot ≈ 70% heel→toe
        ball = heel.lerp(toe, 0.70)
        ball.z = min(ball.z, ankle_head.z - 0.01)
        guide = guides.get(ankle_n, Vector((1, 0, 0) if side == "L" else (-1, 0, 0)))
        set_bone(arm, ankle_n, ankle_head, ball, guide)
        # Toe: ball → tip, slightly above ground
        tip = toe.copy()
        tip.z = max(toe.z, 0.01)
        set_bone(arm, toe_n, ball, tip, guides.get(toe_n, guide))
        y = (wt(arm, toe_n) - wh(arm, toe_n)).normalized()
        out[side] = {
            "toe_dir": [round(c, 3) for c in y],
            "fwd_dot": round(y.dot(fwd), 3),
            "mesh_toe": [round(c, 3) for c in toe],
        }
    return out


def fix_shoulders(arm: bpy.types.Object, mesh: bpy.types.Object, guides: dict[str, Vector]) -> dict:
    """Untwist clavicles: sternum → L/R sockets on ±X."""
    mn, mx = mesh_bbox(mesh)
    sternum = Vector((0.0, -0.02, mn.z + 0.72 * (mx.z - mn.z)))
    # Prefer current ribcage/neck for sternum Z
    if "GargRibcage" in arm.data.bones:
        sternum = wh(arm, "GargRibcage").copy()
        sternum.x = 0.0
        sternum.y = min(sternum.y, -0.01)

    l_sock = shoulder_socket(mesh, "L")
    r_sock = shoulder_socket(mesh, "R")
    # If detection failed wide, fall back to current upperarm heads
    if abs(l_sock.x) > 0.2:
        l_sock = wh(arm, "GargLArmUpperarm1")
    if abs(r_sock.x) > 0.2:
        r_sock = wh(arm, "GargRUpperarm1")

    # Force L/R separation on X about sternum
    l_sock = Vector((max(0.08, abs(l_sock.x)), l_sock.y, l_sock.z))
    r_sock = Vector((-max(0.08, abs(r_sock.x)), r_sock.y, r_sock.z))
    # Keep similar depth (Y) so they aren't stacked front/back
    mid_y = 0.5 * (l_sock.y + r_sock.y)
    l_sock.y = mid_y
    r_sock.y = mid_y

    set_bone(
        arm,
        "GargLArmCollarbone",
        sternum,
        l_sock,
        guides.get("GargLArmCollarbone", Vector((0, 1, 0))),
    )
    set_bone(
        arm,
        "GargRCollarbone",
        sternum,
        r_sock,
        guides.get("GargRCollarbone", Vector((0, 1, 0))),
    )

    # Snap upperarm heads to sockets; keep existing tails direction scaled
    for clav, upper in (
        ("GargLArmCollarbone", "GargLArmUpperarm1"),
        ("GargRCollarbone", "GargRUpperarm1"),
    ):
        sock = wt(arm, clav)
        old_h, old_t = wh(arm, upper), wt(arm, upper)
        direction = old_t - old_h
        length = max(direction.length, 0.05)
        direction.normalize()
        # Prefer downward component for upperarm
        if direction.z > -0.3:
            direction = (direction + Vector((0, 0, -0.5))).normalized()
        set_bone(
            arm,
            upper,
            sock,
            sock + direction * length,
            guides.get(upper, Vector((0, 1, 0))),
        )

    ls, rs = wh(arm, "GargLArmCollarbone"), wh(arm, "GargRCollarbone")
    lt, rt = wt(arm, "GargLArmCollarbone"), wt(arm, "GargRCollarbone")
    return {
        "sternum": [round(c, 3) for c in sternum],
        "L_head": [round(c, 3) for c in ls],
        "R_head": [round(c, 3) for c in rs],
        "L_tail": [round(c, 3) for c in lt],
        "R_tail": [round(c, 3) for c in rt],
        "head_dx": round(rs.x - ls.x, 3),
        "head_dy": round(rs.y - ls.y, 3),
        "tail_dx": round(rt.x - lt.x, 3),
    }


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


def transfer_weights(dst: bpy.types.Object, src: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.data_transfer(
        data_type="VGROUP_WEIGHTS",
        use_auto_transform=False,
        layers_select_src="ALL",
        layers_select_dst="NAME",
        mix_mode="REPLACE",
        mix_factor=1.0,
        vert_mapping="NEAREST",
    )


def align_mesh_uniform_to_donor(dst: bpy.types.Object, donor: bpy.types.Object) -> None:
    dst.data = dst.data.copy()
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
    scale = (dmax.z - dmin.z) / max(nmax.z - nmin.z, 1e-6)
    dcenter = (dmin + dmax) * 0.5
    ncenter = (nmin + nmax) * 0.5
    for v in dst.data.vertices:
        v.co = dcenter + (v.co - ncenter) * scale
    z0 = min(v.co.z for v in dst.data.vertices)
    for v in dst.data.vertices:
        v.co.z += dmin.z - z0
    dst.data.update()


def export_skinned(path: Path, arm: bpy.types.Object, mesh: bpy.types.Object) -> None:
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


def bone_ydir(arm: bpy.types.Object, name: str) -> list[float]:
    d = (wt(arm, name) - wh(arm, name)).normalized()
    return [round(c, 3) for c in d]


def main() -> None:
    for p in (CHAR_GLB, NEW_MASTER, GARGOYLE_FBX):
        if not p.exists():
            raise SystemExit(f"Missing {p}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(CHAR_GLB))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    arm.name = "GargoyleMonkey"
    mesh = max(
        (o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 1000),
        key=lambda o: len(o.data.vertices),
    )
    mesh.name = "WingedMonkey"
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    if arm.animation_data:
        arm.animation_data_clear()
    clear_pose(arm)

    before = {
        "fwd": [round(c, 3) for c in character_forward(arm)],
        "L_ankle_y": bone_ydir(arm, "GargLLegAnkle"),
        "L_toe_y": bone_ydir(arm, "GargLLegToe1"),
        "clav_head_dy": round(wh(arm, "GargRCollarbone").y - wh(arm, "GargLArmCollarbone").y, 3),
        "clav_tail_dx": round(wt(arm, "GargRCollarbone").x - wt(arm, "GargLArmCollarbone").x, 3),
    }
    print("BEFORE", json.dumps(before))

    # FBX guides for rolls
    before_objs = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(GARGOYLE_FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    added = [o for o in bpy.data.objects if o not in before_objs]
    src = next(o for o in added if o.type == "ARMATURE")
    src.name = "GargoyleSourceRest"
    for o in list(added):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if src.animation_data:
        src.animation_data_clear()
    align_fbx_to_bind(src, arm)
    guides = snapshot_fbx_guides(src)

    shoulders = fix_shoulders(arm, mesh, guides)
    feet = fix_feet(arm, mesh, guides)
    n_rolls = reapply_rolls(arm, guides)
    clear_pose(arm)
    bpy.context.view_layer.update()

    after = {
        "fwd": [round(c, 3) for c in character_forward(arm)],
        "L_ankle_y": bone_ydir(arm, "GargLLegAnkle"),
        "L_toe_y": bone_ydir(arm, "GargLLegToe1"),
        "clav_head_dy": round(wh(arm, "GargRCollarbone").y - wh(arm, "GargLArmCollarbone").y, 3),
        "clav_tail_dx": round(wt(arm, "GargRCollarbone").x - wt(arm, "GargLArmCollarbone").x, 3),
        "shoulders": shoulders,
        "feet": feet,
        "rolls_applied": n_rolls,
    }
    print("AFTER", json.dumps(after))

    # Sanity: toes should align with character forward (−Y)
    fwd = character_forward(arm)
    toe_dot = (wt(arm, "GargLLegToe1") - wh(arm, "GargLLegToe1")).normalized().dot(fwd)
    if toe_dot < 0.5:
        raise SystemExit(f"Toe still not forward (dot={toe_dot:.2f})")
    if abs(after["clav_head_dy"]) > 0.03:
        raise SystemExit(f"Clavicles still stacked on Y: dy={after['clav_head_dy']}")

    bind(mesh, arm)
    src.hide_viewport = True
    src.hide_render = True

    before_objs = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(NEW_MASTER))
    added = [o for o in bpy.data.objects if o not in before_objs]
    new_mesh = next(o for o in added if o.type == "MESH" and len(o.data.vertices) > 1000)
    new_mesh.name = "WingedMonkeyNEW"
    for o in list(added):
        if o != new_mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    align_mesh_uniform_to_donor(new_mesh, mesh)
    transfer_weights(new_mesh, mesh)
    bind(new_mesh, arm)
    export_skinned(OUT_NEW, arm, new_mesh)

    bpy.data.objects.remove(new_mesh, do_unlink=True)
    bind(mesh, arm)
    export_skinned(OUT_CHAR, arm, mesh)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({"before": before, "after": after}, indent=2) + "\n")
    print(f"DONE report={REPORT}")


if __name__ == "__main__":
    main()
