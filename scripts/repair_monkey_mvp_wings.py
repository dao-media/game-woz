#!/usr/bin/env python3
"""
Repair Winged Monkey MVP bind: full-span wings + NEW mesh wing weights.

Reads derived GLBs (not masters). Writes models/wingedmonkey/* only.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/repair_monkey_mvp_wings.py
"""
from __future__ import annotations

import json
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
NEW = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
NEW_MASTER = ROOT / "masters/wingedmonkey/meshes/WingedMonkey_NEW.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.blend"
REPORT = ROOT / "models/wingedmonkey/Animations/gargoyle/_wing_repair.json"

MVP = [
    "GargPelvis",
    "GargSpine1",
    "GargRibcage",
    "GargNeck1",
    "GargHead",
    "GargLArmCollarbone",
    "GargLArmUpperarm1",
    "GargLArmForearm1",
    "GargLArmPalm",
    "GargRCollarbone",
    "GargRUpperarm1",
    "GargRForearm1",
    "GargRPalm",
    "GargLLegThigh1",
    "GargLLegCalf1",
    "GargLLegAnkle",
    "GargRThigh1",
    "GargRCalf1",
    "GargRAnkle",
    "GargLWing1",
    "GargRWing1",
]


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def wh(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def wt(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].tail_local


def wing_tip(mesh: bpy.types.Object, side: str, root: Vector) -> Vector:
    best = None
    best_score = -1e9
    for v in mesh.data.vertices:
        p = mesh.matrix_world @ v.co
        if side == "L":
            if p.x < root.x + 0.02:
                continue
            lateral = p.x - root.x
        else:
            if p.x > root.x - 0.02:
                continue
            lateral = root.x - p.x
        score = lateral * 2.0 + 0.35 * (root.z - p.z) + 0.15 * (p.y - root.y)
        if score > best_score:
            best_score = score
            best = p.copy()
    if best is None:
        return root + Vector((0.22 if side == "L" else -0.22, 0.10, -0.25))
    return best


def set_wing(arm: bpy.types.Object, name: str, head_w: Vector, tip_w: Vector) -> None:
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones[name]
    inv = arm.matrix_world.inverted()
    eb.use_connect = False
    eb.head = inv @ head_w
    eb.tail = inv @ tip_w
    if (eb.tail - eb.head).length < 1e-4:
        eb.tail = eb.head + Vector((0.05, 0, 0))
    axis = (tip_w - head_w).normalized()
    guide = Vector((0, 1, 0))
    guide = guide - axis * guide.dot(axis)
    if guide.length < 1e-6:
        guide = Vector((1, 0, 0))
        guide = guide - axis * guide.dot(axis)
    try:
        eb.align_roll(guide.normalized())
    except Exception:
        pass
    bpy.ops.object.mode_set(mode="OBJECT")


def vg_count(mesh: bpy.types.Object, name: str) -> int:
    vg = mesh.vertex_groups.get(name)
    if not vg:
        return 0
    n = 0
    for i in range(len(mesh.data.vertices)):
        try:
            if vg.weight(i) > 0.01:
                n += 1
        except RuntimeError:
            pass
    return n


def transfer_weights(dst: bpy.types.Object, src: bpy.types.Object) -> None:
    """Nearest-vertex weight copy (data_transfer often no-ops on these meshes)."""
    from mathutils.kdtree import KDTree

    src_names = {g.name for g in src.vertex_groups}
    for g in list(dst.vertex_groups):
        if g.name in src_names:
            dst.vertex_groups.remove(g)
    for g in src.vertex_groups:
        dst.vertex_groups.new(name=g.name)

    src_mw = src.matrix_world
    dst_mw = dst.matrix_world
    src_pts = [src_mw @ v.co for v in src.data.vertices]
    tree = KDTree(len(src_pts))
    for i, p in enumerate(src_pts):
        tree.insert(p, i)
    tree.balance()

    src_groups = {g.index: g.name for g in src.vertex_groups}
    src_w: list[list[tuple[str, float]]] = [[] for _ in src.data.vertices]
    for v in src.data.vertices:
        for g in v.groups:
            name = src_groups.get(g.group)
            if name and g.weight > 1e-5:
                src_w[v.index].append((name, g.weight))

    buckets: dict[str, list[tuple[int, float]]] = {g.name: [] for g in dst.vertex_groups}
    for dv in dst.data.vertices:
        _co, idx, _dist = tree.find(dst_mw @ dv.co)
        for name, w in src_w[idx]:
            buckets[name].append((dv.index, w))

    for name, pairs in buckets.items():
        if not pairs:
            continue
        vg = dst.vertex_groups[name]
        for vi, w in pairs:
            vg.add([vi], min(w, 1.0), "REPLACE")
    print(
        f"transferred weights → {sum(1 for v in dst.data.vertices if v.groups)}/"
        f"{len(dst.data.vertices)} verts with groups"
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


def align_new_to_donor(dst: bpy.types.Object, donor: bpy.types.Object) -> None:
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
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != mesh and (
            o.name.startswith("Ico") or len(o.data.vertices) < 1000
        ):
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    arm.hide_set(False)
    mesh.hide_set(False)
    arm.select_set(True)
    mesh.select_set(True)
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
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(CHAR))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    donor = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    arm.name = "GargoyleMonkey"
    donor.name = "WingedMonkey"
    keep = {"GargoyleMonkey", "WingedMonkey"}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    arm = bpy.data.objects["GargoyleMonkey"]
    donor = bpy.data.objects["WingedMonkey"]
    clear_pose(arm)

    before = {
        "L": {
            "head": [round(c, 4) for c in wh(arm, "GargLWing1")],
            "len": round((wt(arm, "GargLWing1") - wh(arm, "GargLWing1")).length, 4),
        },
        "R": {
            "head": [round(c, 4) for c in wh(arm, "GargRWing1")],
            "len": round((wt(arm, "GargRWing1") - wh(arm, "GargRWing1")).length, 4),
        },
        "L_weights": vg_count(donor, "GargLWing1"),
        "R_weights": vg_count(donor, "GargRWing1"),
    }

    # Unbind before editing rest bones so glTF IBMs rebuild on rebind
    for mod in list(donor.modifiers):
        if mod.type == "ARMATURE":
            donor.modifiers.remove(mod)
    if donor.parent:
        mw = donor.matrix_world.copy()
        donor.parent = None
        donor.matrix_world = mw

    for side, bone in (("L", "GargLWing1"), ("R", "GargRWing1")):
        root = wh(arm, bone)
        tip = wing_tip(donor, side, root)
        set_wing(arm, bone, root, tip)

    bind(donor, arm)
    clear_pose(arm)
    bpy.context.view_layer.update()
    print(
        "post-rebind LWing len",
        round((wt(arm, "GargLWing1") - wh(arm, "GargLWing1")).length, 4),
    )

    after = {
        "L": {
            "head": [round(c, 4) for c in wh(arm, "GargLWing1")],
            "tip": [round(c, 4) for c in wt(arm, "GargLWing1")],
            "len": round((wt(arm, "GargLWing1") - wh(arm, "GargLWing1")).length, 4),
        },
        "R": {
            "head": [round(c, 4) for c in wh(arm, "GargRWing1")],
            "tip": [round(c, 4) for c in wt(arm, "GargRWing1")],
            "len": round((wt(arm, "GargRWing1") - wh(arm, "GargRWing1")).length, 4),
        },
    }

    before_names = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=str(NEW_MASTER))
    new_mesh = max(
        (o for o in bpy.data.objects if o.type == "MESH" and o.name not in before_names),
        key=lambda o: len(o.data.vertices),
    )
    new_mesh.name = "WingedMonkeyNEW"
    for o in list(bpy.data.objects):
        if o.name not in {"GargoyleMonkey", "WingedMonkey", "WingedMonkeyNEW"}:
            bpy.data.objects.remove(o, do_unlink=True)
    arm = bpy.data.objects["GargoyleMonkey"]
    donor = bpy.data.objects["WingedMonkey"]
    new_mesh = bpy.data.objects["WingedMonkeyNEW"]
    align_new_to_donor(new_mesh, donor)
    transfer_weights(new_mesh, donor)
    bind(new_mesh, arm)
    bind(donor, arm)
    clear_pose(arm)

    after["L_weights_donor"] = vg_count(donor, "GargLWing1")
    after["R_weights_donor"] = vg_count(donor, "GargRWing1")
    after["L_weights_new"] = vg_count(new_mesh, "GargLWing1")
    after["R_weights_new"] = vg_count(new_mesh, "GargRWing1")

    report = {"before": before, "after": after}
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2))
    print("REPORT", json.dumps(report, indent=2))

    new_mesh.hide_set(True)
    export_skinned(CHAR, arm, donor)
    donor.hide_set(True)
    new_mesh.hide_set(False)
    export_skinned(NEW, arm, new_mesh)
    donor.hide_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    print("DONE")


if __name__ == "__main__":
    main()
