#!/usr/bin/env python3
"""
Attach fitted Gargoyle wing bones onto WingedMonkey_NEW's Tripo armature.

Does NOT replace the body rig — only adds Garg* wing chains under the NEW
upper-torso bone (`bone_2`), fits them to the monkey wing mesh / RIGGED
landmarks, and transfers wing weights from the existing rigged mesh.

Reads (never modified):
  - masters/wingedmonkey/meshes/WingedMonkey_NEW.glb
  - models/wingedmonkey/WingedMonkey_rigged.glb   (wing landmarks + weights)
  - models/wingedmonkey/WingedMonkey_gargoyle.glb (Gargoyle wing bone names/rest)

Writes:
  - models/wingedmonkey/WingedMonkey_new_wings.glb
  - models/wingedmonkey/WingedMonkey_new_wings.blend

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/attach_gargoyle_wings_to_monkey_new.py
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SRC_NEW = ROOT / "masters/wingedmonkey/meshes/WingedMonkey_NEW.glb"
SRC_RIGGED = ROOT / "models/wingedmonkey/WingedMonkey_rigged.glb"
SRC_GARG = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.blend"

# Parent wing clavicles under this NEW torso bone (upper chest).
NEW_WING_PARENT = "bone_2"

# RIGGED landmarks (already monkey-fitted) → drive Gargoyle wing chain fit.
LANDMARKS = {
    "L": {
        "clav": "L_WingCollarbone",
        "w1": "L_Wing1",
        "w2": "L_Wing2",
        "palm": "L_WingPalm",
        "digit": "L_WingDigit1",
        "thumb": "L_WingThumb",
    },
    "R": {
        "clav": "R_WingCollarbone",
        "w1": "R_Wing1",
        "w2": "R_Wing2",
        "palm": "R_WingPalm",
        "digit": "R_WingDigit1",
        "thumb": "R_WingThumb",
    },
}

L_WING_CHAIN = [
    "GargLWingWCollarbone",
    "GargLWing1",
    "GargLWing2",
    "GargLWingLWingPalm",
    "GargLWingLDigit1",
]
L_WING_TIP = "GargLWingLDigit2"
R_WING_CHAIN = [
    "GargRWingWCollarbone",
    "GargRWing1",
    "GargRWing2",
    "GargRWingRWingPalm",
    "GargRWingRDigit1",
]
R_WING_TIP = "GargRWingRDigit2"
THUMBS = {
    "L": ("GargWingThumbL", "GargWingThumbL2"),
    "R": ("GargWingThumbR", "GargWingThumbR2"),
}

# RIGGED group → Gargoyle deform bone(s)
WEIGHT_MAP: dict[str, list[str]] = {
    "L_WingCollarbone": ["GargLWingWCollarbone"],
    "L_Wing1": ["GargLWing1"],
    "L_Wing2": ["GargLWing2"],
    "L_WingPalm": ["GargLWingLWingPalm"],
    "L_WingDigit1": ["GargLWingLDigit1", "GargLWingLDigit2"],
    "L_WingThumb": ["GargWingThumbL", "GargWingThumbL2"],
    "R_WingCollarbone": ["GargRWingWCollarbone"],
    "R_Wing1": ["GargRWing1"],
    "R_Wing2": ["GargRWing2"],
    "R_WingPalm": ["GargRWingRWingPalm"],
    "R_WingDigit1": ["GargRWingRDigit1", "GargRWingRDigit2"],
    "R_WingThumb": ["GargWingThumbR", "GargWingThumbR2"],
}

ALL_WING_BONES = (
    L_WING_CHAIN
    + [L_WING_TIP]
    + R_WING_CHAIN
    + [R_WING_TIP]
    + [THUMBS["L"][0], THUMBS["L"][1], THUMBS["R"][0], THUMBS["R"][1]]
)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_head(arm: bpy.types.Object, name: str) -> Vector:
    b = arm.data.bones[name]
    return arm.matrix_world @ b.head_local


def world_tail(arm: bpy.types.Object, name: str) -> Vector:
    b = arm.data.bones[name]
    return arm.matrix_world @ b.tail_local


def wing_tip_from_mesh(mesh: bpy.types.Object, side: str) -> Vector:
    coords = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    zs = [c.z for c in coords]
    z_cut = min(zs) + 0.45 * (max(zs) - min(zs))
    upper = [c for c in coords if c.z >= z_cut]
    if side == "L":
        return max(upper, key=lambda c: c.x)
    return min(upper, key=lambda c: c.x)


def edit_mode(arm: bpy.types.Object):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")


def polyline_fit(arm: bpy.types.Object, chain: list[str], waypoints: list[Vector]) -> None:
    """Place chain bones along world-space waypoints (len = len(chain)+1)."""
    assert len(waypoints) == len(chain) + 1
    edit_mode(arm)
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    for i, name in enumerate(chain):
        if name not in eb:
            raise KeyError(name)
        bone = eb[name]
        bone.head = inv @ waypoints[i]
        bone.tail = inv @ waypoints[i + 1]
        if (bone.tail - bone.head).length < 1e-5:
            bone.tail = bone.head + Vector((0.0, 0.0, 0.02))
        bone.align_roll(Vector((0.0, 1.0, 0.0)))
    bpy.ops.object.mode_set(mode="OBJECT")


def ensure_wing_bones_from_garg(new_arm: bpy.types.Object, garg_arm: bpy.types.Object) -> None:
    """Create Gargoyle wing bones on NEW (copy rest lengths), parent clavs to bone_2."""
    if NEW_WING_PARENT not in new_arm.data.bones:
        raise SystemExit(f"NEW armature missing parent bone {NEW_WING_PARENT!r}")

    edit_mode(new_arm)
    eb = new_arm.data.edit_bones
    parent = eb[NEW_WING_PARENT]
    inv = new_arm.matrix_world.inverted()

    # Create bones leaf-first so parents exist when we set parent pointers.
    # First create all empty bones, then set hierarchy + rest from garg world.
    for name in ALL_WING_BONES:
        if name in eb:
            continue
        eb.new(name)

    for name in ALL_WING_BONES:
        src = garg_arm.data.bones[name]
        dst = eb[name]
        h = garg_arm.matrix_world @ src.head_local
        t = garg_arm.matrix_world @ src.tail_local
        dst.head = inv @ h
        dst.tail = inv @ t
        if (dst.tail - dst.head).length < 1e-5:
            dst.tail = dst.head + Vector((0.02, 0.0, 0.0))
        dst.use_connect = False

    # Hierarchy from Gargoyle (wing-only); clavicles reparent to NEW torso.
    for name in ALL_WING_BONES:
        src = garg_arm.data.bones[name]
        dst = eb[name]
        if name in ("GargLWingWCollarbone", "GargRWingWCollarbone"):
            dst.parent = parent
            continue
        if src.parent and src.parent.name in eb:
            dst.parent = eb[src.parent.name]
        else:
            dst.parent = parent

    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"created/updated {len(ALL_WING_BONES)} wing bones under {NEW_WING_PARENT}")


def fit_wings_to_landmarks(
    new_arm: bpy.types.Object,
    landmark_arm: bpy.types.Object,
    mesh: bpy.types.Object,
) -> None:
    for side, chain, tip_bone in (
        ("L", L_WING_CHAIN, L_WING_TIP),
        ("R", R_WING_CHAIN, R_WING_TIP),
    ):
        lm = LANDMARKS[side]
        root = world_head(landmark_arm, lm["clav"])
        w1 = world_head(landmark_arm, lm["w1"])
        w2 = world_head(landmark_arm, lm["w2"])
        palm = world_head(landmark_arm, lm["palm"])
        digit = world_head(landmark_arm, lm["digit"])
        tip = world_tail(landmark_arm, lm["digit"])
        out = tip - root
        if out.length > 1e-6:
            root = root + out.normalized() * 0.03
        digit_pt = digit if (digit - palm).length > 1e-4 else palm.lerp(tip, 0.55)
        wp = [root, w1, w2, palm, digit_pt, tip]
        polyline_fit(new_arm, chain, wp)

        # Tip bone extends Digit1 → mesh tip
        edit_mode(new_arm)
        eb = new_arm.data.edit_bones
        if tip_bone in eb and chain[-1] in eb:
            parent = eb[chain[-1]]
            tb = eb[tip_bone]
            inv = new_arm.matrix_world.inverted()
            tb.head = parent.tail.copy()
            tb.tail = inv @ tip
            if (tb.tail - tb.head).length < 1e-5:
                tb.tail = tb.head + (parent.tail - parent.head)
            tb.parent = parent
            tb.use_connect = False
            tb.align_roll(Vector((0.0, 1.0, 0.0)))
        bpy.ops.object.mode_set(mode="OBJECT")

        thumb, thumb2 = THUMBS[side]
        edit_mode(new_arm)
        eb = new_arm.data.edit_bones
        if thumb in eb and chain[2] in eb:
            w2b = eb[chain[2]]
            inv = new_arm.matrix_world.inverted()
            base_w = new_arm.matrix_world @ w2b.head.lerp(w2b.tail, 0.35)
            span = (tip - root).normalized() if (tip - root).length > 1e-6 else Vector((1, 0, 0))
            fwd = span.cross(Vector((0, 0, 1)))
            if fwd.length < 1e-6:
                fwd = Vector((0.0, -1.0, 0.0))
            fwd.normalize()
            th = eb[thumb]
            th.head = inv @ base_w
            th.tail = inv @ (base_w + fwd * 0.06 + Vector((0, 0, -0.02)))
            th.parent = w2b
            th.use_connect = False
            th.align_roll(Vector((0.0, 1.0, 0.0)))
            if thumb2 in eb:
                th2 = eb[thumb2]
                th2.head = th.tail.copy()
                th2.tail = th.tail + (th.tail - th.head).normalized() * 0.04
                th2.parent = th
                th2.use_connect = False
                th2.align_roll(Vector((0.0, 1.0, 0.0)))
        bpy.ops.object.mode_set(mode="OBJECT")
        print(f"fitted {side} wing → tip {[round(v, 3) for v in tip]}")


def transfer_wing_weights(dst_mesh: bpy.types.Object, src_mesh: bpy.types.Object) -> None:
    """Nearest-vert transfer of RIGGED wing groups, remapped to Gargoyle names."""
    # Ensure destination groups exist
    for targets in WEIGHT_MAP.values():
        for t in targets:
            if t not in dst_mesh.vertex_groups:
                dst_mesh.vertex_groups.new(name=t)

    # Temporary groups on dst matching source names for Data Transfer
    tmp_names: list[str] = []
    for src_name in WEIGHT_MAP:
        if src_name not in src_mesh.vertex_groups:
            continue
        tmp = f"_tmp_{src_name}"
        if tmp not in dst_mesh.vertex_groups:
            dst_mesh.vertex_groups.new(name=tmp)
        tmp_names.append(tmp)

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    src_mesh.select_set(True)
    dst_mesh.select_set(True)
    bpy.context.view_layer.objects.active = dst_mesh

    # Transfer all vertex groups by name (tmp not present on src — transfer src names first)
    # So: transfer L_Wing* from src onto dst creating/overwriting those names, then remap.
    bpy.ops.object.data_transfer(
        data_type="VGROUP_WEIGHTS",
        use_auto_transform=False,
        layers_select_src="ALL",
        layers_select_dst="NAME",
        mix_mode="REPLACE",
        mix_factor=1.0,
        vert_mapping="NEAREST",
    )

    # Remap L_Wing* → Garg*
    for src_name, targets in WEIGHT_MAP.items():
        src_vg = dst_mesh.vertex_groups.get(src_name)
        if src_vg is None:
            continue
        # Collect weights
        weights: dict[int, float] = {}
        for i, v in enumerate(dst_mesh.data.vertices):
            for g in v.groups:
                if g.group == src_vg.index and g.weight > 1e-5:
                    weights[i] = g.weight
                    break
        for tname in targets:
            t_vg = dst_mesh.vertex_groups.get(tname) or dst_mesh.vertex_groups.new(name=tname)
            for vi, w in weights.items():
                t_vg.add([vi], w, "REPLACE")
        # Remove temporary Tripo wing group from NEW (body keeps its own groups)
        dst_mesh.vertex_groups.remove(src_vg)

    for tmp in tmp_names:
        vg = dst_mesh.vertex_groups.get(tmp)
        if vg:
            dst_mesh.vertex_groups.remove(vg)

    print(f"transferred wing weights → {sum(len(v) for v in WEIGHT_MAP.values())} Garg groups")


def bind_armature(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    # Keep existing armature modifier pointing at NEW arm; ensure parent.
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            mod.object = arm
            break
    else:
        mod = mesh.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
    mesh.parent = arm


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type in {"ARMATURE", "MESH"} and "Icosphere" not in o.name:
            o.hide_set(False)
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_materials="EXPORT",
        export_texcoords=True,
        export_normals=True,
    )
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    for p in (SRC_NEW, SRC_RIGGED, SRC_GARG):
        if not p.exists():
            raise SystemExit(f"Missing: {p}")

    clear_scene()

    # --- NEW character (destination) ---
    bpy.ops.import_scene.gltf(filepath=str(SRC_NEW))
    new_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    new_arm.name = "WingedMonkeyNew"
    new_mesh = next(
        o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 1000
    )
    new_mesh.name = "WingedMonkey"
    # Drop helper icosphere
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != new_mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    print(f"NEW arm={new_arm.name} bones={len(new_arm.data.bones)} mesh_verts={len(new_mesh.data.vertices)}")

    # --- RIGGED (landmarks + wing weights) ---
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SRC_RIGGED))
    added = [o for o in bpy.data.objects if o not in before]
    rig_arm = next(o for o in added if o.type == "ARMATURE")
    rig_arm.name = "MonkeyRiggedRef"
    rig_mesh = next(o for o in added if o.type == "MESH" and len(o.data.vertices) > 1000)
    rig_mesh.name = "MonkeyRiggedMesh"
    print(f"RIGGED landmarks ready ({len(rig_arm.data.bones)} bones)")

    # --- GARG (wing bone name/rest template) ---
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SRC_GARG))
    added = [o for o in bpy.data.objects if o not in before]
    garg_arm = next(o for o in added if o.type == "ARMATURE")
    garg_arm.name = "GargoyleWingDonor"
    # Drop garg meshes — only need bones
    for o in list(added):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

    ensure_wing_bones_from_garg(new_arm, garg_arm)
    fit_wings_to_landmarks(new_arm, rig_arm, new_mesh)
    transfer_wing_weights(new_mesh, rig_mesh)
    bind_armature(new_mesh, new_arm)

    # Cleanup donors
    bpy.data.objects.remove(rig_mesh, do_unlink=True)
    bpy.data.objects.remove(rig_arm, do_unlink=True)
    bpy.data.objects.remove(garg_arm, do_unlink=True)

    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    export_glb(OUT_GLB)

    # Quick validate
    wing_bones = [b.name for b in new_arm.data.bones if "Wing" in b.name or "Thumb" in b.name]
    wing_groups = [
        g.name
        for g in new_mesh.vertex_groups
        if g.name.startswith("Garg") and ("Wing" in g.name or "Thumb" in g.name)
    ]
    print(f"DONE wing_bones={len(wing_bones)} wing_groups={len(wing_groups)} → {OUT_GLB.name}")


if __name__ == "__main__":
    main()
