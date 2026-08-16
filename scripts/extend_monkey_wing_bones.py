#!/usr/bin/env python3
"""
Extend Gargoyle wing bones through the full Winged Monkey wing mesh.

Problem: tip heuristic preferred high-Z + |X|, so bones pointed UP near the
shoulder while feathers hang OUT+DOWN. Coverage along true wing axis ~12%,
so flap animations stretch wing skin unnaturally.

Fix (derived only; masters untouched):
  - Tip = farthest mesh point from wing root in the wing volume
  - Equalize clav→digit chain along root→tip
  - Fan membrane digits (Middle/Pink) toward the same tip
  - Re-skin NEW mesh onto the updated bind

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/extend_monkey_wing_bones.py
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
OUT_CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
OUT_NEW = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.blend"
REPORT = ROOT / "models/wingedmonkey/Animations/gargoyle/_wing_extend.json"

L_WING = [
    "GargLWingWCollarbone",
    "GargLWing1",
    "GargLWing2",
    "GargLWingLWingPalm",
    "GargLWingLDigit1",
]
R_WING = [
    "GargRWingWCollarbone",
    "GargRWing1",
    "GargRWing2",
    "GargRWingRWingPalm",
    "GargRWingRDigit1",
]


def world_head(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def world_tail(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].tail_local


def mesh_bbox(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    return (
        Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
        Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))),
    )


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def snapshot_guides(arm: bpy.types.Object) -> dict[str, Vector]:
    guides: dict[str, Vector] = {}
    for b in arm.data.bones:
        x = (arm.matrix_world @ b.matrix_local).to_3x3() @ Vector((1, 0, 0))
        if x.length > 1e-8:
            guides[b.name] = x.normalized()
    return guides


def wing_tip(mesh: bpy.types.Object, side: str, root: Vector) -> Vector:
    mn, mx = mesh_bbox(mesh)
    z_lo = mn.z + 0.28 * (mx.z - mn.z)
    z_hi = mn.z + 0.92 * (mx.z - mn.z)
    best: Vector | None = None
    best_score = -1.0
    for v in mesh.data.vertices:
        p = mesh.matrix_world @ v.co
        if p.z < z_lo or p.z > z_hi:
            continue
        if side == "L" and p.x < 0.04:
            continue
        if side == "R" and p.x > -0.04:
            continue
        lateral = abs(p.x) - abs(root.x)
        if lateral < 0.02:
            continue
        score = (p - root).length + 0.35 * lateral
        if score > best_score:
            best_score = score
            best = p.copy()
    if best is None:
        raise RuntimeError(f"No wing tip for {side}")
    return best


def coverage(arm: bpy.types.Object, mesh: bpy.types.Object, side: str, clav: str, tip_bone: str) -> dict:
    root = world_head(arm, clav)
    tip_m = wing_tip(mesh, side, root)
    tip_b = world_tail(arm, tip_bone)
    d2 = tip_bone.replace("Digit1", "Digit2")
    if d2 in arm.data.bones:
        tip_b = world_tail(arm, d2)
    axis = tip_m - root
    span = max(axis.length, 1e-6)
    axis_n = axis.normalized()
    proj = (tip_b - root).dot(axis_n)
    return {
        "mesh_tip": [round(c, 4) for c in tip_m],
        "bone_tip": [round(c, 4) for c in tip_b],
        "delta": round((tip_b - tip_m).length, 4),
        "span": round(span, 4),
        "coverage": round(proj / span, 3),
    }


def polyline_equal(
    arm: bpy.types.Object,
    chain: list[str],
    waypoints: list[Vector],
    guides: dict[str, Vector],
) -> None:
    if len(waypoints) != len(chain) + 1:
        raise ValueError("waypoints must be chain+1")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    segs = [(waypoints[i + 1] - waypoints[i]).length for i in range(len(waypoints) - 1)]
    poly_len = max(sum(segs), 1e-6)

    def point_at(dist: float) -> Vector:
        d = max(0.0, min(dist, poly_len))
        walked = 0.0
        for i, seg_len in enumerate(segs):
            if walked + seg_len >= d - 1e-9 or i == len(segs) - 1:
                t = 0.0 if seg_len < 1e-9 else (d - walked) / seg_len
                return waypoints[i].lerp(waypoints[i + 1], t)
            walked += seg_len
        return waypoints[-1].copy()

    inv = arm.matrix_world.inverted()
    ratios = [1.0 / len(chain)] * len(chain)
    cursor = 0.0
    heads = [point_at(0.0)]
    for r in ratios:
        cursor += r * poly_len
        heads.append(point_at(cursor))

    for i, name in enumerate(chain):
        b = eb[name]
        h_w, t_w = heads[i], heads[i + 1]
        b.head = inv @ h_w
        b.tail = inv @ t_w
        if (b.tail - b.head).length < 1e-5:
            b.tail = b.head + Vector((0, 0, 0.01))
        axis = (t_w - h_w).normalized() if (t_w - h_w).length > 1e-8 else Vector((0, 0, 1))
        guide = guides.get(name, Vector((0, 1, 0))).copy()
        guide = guide - axis * guide.dot(axis)
        if guide.length < 1e-6:
            guide = Vector((0, 1, 0)) if abs(axis.dot(Vector((0, 1, 0)))) < 0.9 else Vector((1, 0, 0))
            guide = guide - axis * guide.dot(axis)
        try:
            b.align_roll(guide.normalized())
        except Exception:
            pass
    bpy.ops.object.mode_set(mode="OBJECT")


def extend_side(
    arm: bpy.types.Object,
    mesh: bpy.types.Object,
    chain: list[str],
    side: str,
    thumb: str,
    guides: dict[str, Vector],
) -> dict:
    root = world_head(arm, chain[0])
    tip = wing_tip(mesh, side, root)
    span_v = tip - root
    if span_v.length < 1e-6:
        raise RuntimeError(f"degenerate wing span {side}")
    root = root + span_v.normalized() * 0.02
    tip = wing_tip(mesh, side, root)
    span_v = tip - root

    up = Vector((0, 0, 1))
    fwd = span_v.cross(up)
    if fwd.length < 1e-6:
        fwd = Vector((0, -1, 0))
    fwd.normalize()

    fracs = [0.0, 0.22, 0.42, 0.62, 0.82, 1.0]
    wp: list[Vector] = []
    for f in fracs:
        p = root.lerp(tip, f)
        if 0.15 < f < 0.85:
            p = p + up * (0.018 * math.sin(math.pi * f)) + fwd * (0.01 * math.sin(math.pi * f))
        wp.append(p)
    polyline_equal(arm, chain, wp, guides)

    # Digit2 exactly on tip
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    d1 = chain[-1]
    d2 = d1.replace("Digit1", "Digit2")
    if d1 in eb and d2 in eb:
        b1, b2 = eb[d1], eb[d2]
        tip_l = inv @ tip
        mid = b1.head.lerp(tip_l, 0.55)
        b1.tail = mid
        b2.parent = b1
        b2.use_connect = False
        b2.head = mid.copy()
        b2.tail = tip_l

    bpy.ops.object.mode_set(mode="OBJECT")

    # Membrane fans toward tip
    if side == "L":
        membranes = (
            (["GargLDigitMiddle", "GargLDigitMiddle2", "GargLDigitMiddle3"], Vector((0, 0.02, 0.01))),
            (["GargLDigitPink", "GargLDigitPink2"], Vector((0, 0.015, -0.03))),
        )
        w2 = "GargLWing2"
    else:
        membranes = (
            (["GargRDigitMiddle", "GargRDigitMiddle2", "GargRDigitMiddle3"], Vector((0, -0.02, 0.01))),
            (["GargRDigitPink", "GargRDigitPink2"], Vector((0, -0.015, -0.03))),
        )
        w2 = "GargRWing2"

    base = world_head(arm, w2).lerp(world_tail(arm, w2), 0.4)
    for names, bias in membranes:
        if any(n not in arm.data.bones for n in names):
            continue
        end = tip.lerp(base, 0.04) + bias
        n = len(names)
        mwp = [base.lerp(end, i / n) for i in range(n + 1)]
        polyline_equal(arm, names, mwp, guides)

    # Thumb stub
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    if thumb in eb and w2 in eb:
        w2b = eb[w2]
        th = eb[thumb]
        base_w = arm.matrix_world @ w2b.head.lerp(w2b.tail, 0.45)
        th_dir = fwd * 0.05 + Vector((0, 0, -0.025))
        th.head = inv @ base_w
        th.tail = inv @ (base_w + th_dir)
        th.parent = w2b
        t2 = thumb + "2"
        if t2 in eb:
            th2 = eb[t2]
            tip_w = arm.matrix_world @ th.tail
            th2.head = th.tail.copy()
            th2.tail = inv @ (tip_w + th_dir.normalized() * 0.035)
            th2.parent = th
    bpy.ops.object.mode_set(mode="OBJECT")

    tip_bone = chain[-1]
    return {
        "root": [round(c, 4) for c in root],
        "tip": [round(c, 4) for c in tip],
        "span": round(span_v.length, 4),
        "after": coverage(arm, mesh, side, chain[0], tip_bone),
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
    dz = dmin.z - z0
    for v in dst.data.vertices:
        v.co.z += dz
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


def main() -> None:
    for p in (CHAR_GLB, NEW_MASTER):
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
        "L": coverage(arm, mesh, "L", "GargLWingWCollarbone", "GargLWingLDigit1"),
        "R": coverage(arm, mesh, "R", "GargRWingWCollarbone", "GargRWingRDigit1"),
    }
    print("BEFORE", json.dumps(before))

    guides = snapshot_guides(arm)
    after_detail = {
        "L": extend_side(arm, mesh, L_WING, "L", "GargWingThumbL", guides),
        "R": extend_side(arm, mesh, R_WING, "R", "GargWingThumbR", guides),
    }
    clear_pose(arm)
    bpy.context.view_layer.update()

    after = {
        "L": coverage(arm, mesh, "L", "GargLWingWCollarbone", "GargLWingLDigit1"),
        "R": coverage(arm, mesh, "R", "GargRWingWCollarbone", "GargRWingRDigit1"),
    }
    print("AFTER", json.dumps(after))
    for side in ("L", "R"):
        if after[side]["coverage"] < 0.85:
            raise SystemExit(f"Wing {side} coverage still low: {after[side]['coverage']}")

    bind(mesh, arm)

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

    report = {"before": before, "after": after, "detail": after_detail}
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(f"DONE report={REPORT}")


if __name__ == "__main__":
    main()
