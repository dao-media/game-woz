#!/usr/bin/env python3
"""
Skin WingedMonkey_NEW mesh onto the fitted Gargoyle armature so Gargoyle clips play.

Reads masters (immutable) + current Gargoyle character; writes derived NEW+Gargoyle pack.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/skin_new_mesh_to_gargoyle.py
"""
from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SRC_NEW = ROOT / "masters/wingedmonkey/meshes/WingedMonkey_NEW.glb"
SRC_GARG_CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
SRC_RIGGED = ROOT / "models/wingedmonkey/WingedMonkey_rigged.glb"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.blend"

WING_TIPS = {
    "L": ("GargLWingLDigit1", "GargLWingLDigit2"),
    "R": ("GargRWingRDigit1", "GargRWingRDigit2"),
}


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_wing_tip(mesh: bpy.types.Object, side: str, root: Vector) -> Vector:
    coords = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    zs = [c.z for c in coords]
    z_cut = min(zs) + 0.40 * (max(zs) - min(zs))
    best = None
    best_score = -1.0
    for p in coords:
        if p.z < z_cut:
            continue
        if side == "L" and p.x < 0.02:
            continue
        if side == "R" and p.x > -0.02:
            continue
        score = abs(p.x) * 2.0 + (p - root).length + 0.1 * p.z
        if score > best_score:
            best_score = score
            best = p
    if best is None:
        raise RuntimeError(f"No wing tip for {side}")
    return best


def fix_wing_tips(arm: bpy.types.Object, mesh: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    arm.hide_set(False)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.context.view_layer.update()
    if arm.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    for side, (d1, d2) in WING_TIPS.items():
        if d1 not in eb or d2 not in eb:
            continue
        b1, b2 = eb[d1], eb[d2]
        root = arm.matrix_world @ b1.head
        tip = mesh_wing_tip(mesh, side, root)
        b1.tail = inv @ root.lerp(tip, 0.85)
        b2.parent = b1
        b2.use_connect = False
        b2.head = b1.tail.copy()
        b2.tail = inv @ tip
        if (b2.tail - b2.head).length < 1e-4:
            b2.tail = b2.head + Vector((0.02, 0, 0))
        b1.align_roll(Vector((0.0, 1.0, 0.0)))
        b2.align_roll(Vector((0.0, 1.0, 0.0)))
        print(f"NEW wing {side} tip → {[round(v, 3) for v in tip]}")
    bpy.ops.object.mode_set(mode="OBJECT")


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
    weighted = sum(1 for v in dst.data.vertices if v.groups)
    print(f"transferred weights → {weighted}/{len(dst.data.vertices)} verts, groups={len(dst.vertex_groups)}")


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


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            o.hide_set(False)
            o.select_set(True)
        elif o.type == "MESH" and len(o.data.vertices) > 1000:
            o.hide_set(False)
            o.select_set(True)
        else:
            o.select_set(False)
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
    for p in (SRC_NEW, SRC_GARG_CHAR):
        if not p.exists():
            raise SystemExit(f"Missing {p}")

    clear_scene()

    # Gargoyle character = armature + weight donor mesh
    bpy.ops.import_scene.gltf(filepath=str(SRC_GARG_CHAR))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    arm.name = "GargoyleMonkey"
    donor = next(o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 1000)
    donor.name = "WeightDonor"
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != donor:
            bpy.data.objects.remove(o, do_unlink=True)

    # NEW mesh
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SRC_NEW))
    added = [o for o in bpy.data.objects if o not in before]
    new_mesh = next(o for o in added if o.type == "MESH" and len(o.data.vertices) > 1000)
    new_mesh.name = "WingedMonkey"
    for o in list(added):
        if o != new_mesh:
            bpy.data.objects.remove(o, do_unlink=True)

    # Align NEW mesh to donor (same authored AABB / origin)
    new_mesh.matrix_world = donor.matrix_world.copy()
    bpy.context.view_layer.update()

    # Armature already has wing tips fitted in rebake_gargoyle_monkey_clips.py —
    # do NOT re-run mesh tip heuristics on NEW (they can snap to feet).
    transfer_weights(new_mesh, donor)
    bind(new_mesh, arm)
    bpy.data.objects.remove(donor, do_unlink=True)

    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    export_glb(OUT_GLB)
    print(f"DONE → {OUT_GLB.name} (Gargoyle armature + NEW mesh)")


if __name__ == "__main__":
    main()
