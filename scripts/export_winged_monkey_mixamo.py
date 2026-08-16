#!/usr/bin/env python3
"""
Build a Mixamo-uploadable simplified Winged Monkey (mesh only).

Mixamo auto-rigger wants:
  - Single humanoid mesh (T/A-pose OK)
  - Roughly ≤40k polygons, file under ~50MB
  - No armature / no extra empties
  - Origin near feet, character centered

Reads (never modified):
  masters/wingedmonkey/meshes/WingedMonkey.glb

Writes (derived):
  models/wingedmonkey/mixamo/WingedMonkey_mixamo.fbx
  models/wingedmonkey/mixamo/WingedMonkey_mixamo.obj (+ .mtl)
  models/wingedmonkey/mixamo/README.md

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/export_winged_monkey_mixamo.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "masters/wingedmonkey/meshes/WingedMonkey.glb"
OUT_DIR = ROOT / "models/wingedmonkey/mixamo"
OUT_FBX = OUT_DIR / "WingedMonkey_mixamo.fbx"
OUT_OBJ = OUT_DIR / "WingedMonkey_mixamo.obj"
# Target face count for Mixamo (stay comfortably under ~40–50k)
TARGET_FACES = 32_000


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def find_body_mesh() -> bpy.types.Object:
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 1000]
    if not meshes:
        raise RuntimeError("No body mesh found")
    meshes.sort(key=lambda o: len(o.data.vertices), reverse=True)
    return meshes[0]


def find_armature() -> bpy.types.Object | None:
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            return o
    return None


def pose_toward_tpose(arm: bpy.types.Object) -> None:
    """
    Nudge Tripo arms toward a Mixamo-friendly T/A pose.
    Rest pose already spreads hands; lift upper arms toward horizontal ±X.
    """
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()

    # Rotate upper arms in pose space: left up toward +X, right toward -X.
    # Empirically ~55° around local bone axis that lifts the arm (bone Y).
    lifts = {
        "L_Upperarm": Euler((0.0, 0.0, math.radians(50.0)), "XYZ"),
        "R_Upperarm": Euler((0.0, 0.0, math.radians(-50.0)), "XYZ"),
        "L_Forearm": Euler((0.0, 0.0, math.radians(-8.0)), "XYZ"),
        "R_Forearm": Euler((0.0, 0.0, math.radians(8.0)), "XYZ"),
    }
    for name, eul in lifts.items():
        pb = arm.pose.bones.get(name)
        if not pb:
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = eul

    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    print("posed arms toward T/A for Mixamo markers")


def apply_armature_pose(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    """Bake current pose into mesh geometry, then detach armature."""
    # Ensure armature modifier targets arm
    arm_mod = None
    for mod in mesh.modifiers:
        if mod.type == "ARMATURE":
            arm_mod = mod
            break
    if arm_mod is None:
        arm_mod = mesh.modifiers.new(name="Armature", type="ARMATURE")
    arm_mod.object = arm

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    # Apply as shape / modifier — converts posed verts into mesh data
    bpy.ops.object.modifier_apply(modifier=arm_mod.name)

    mesh.parent = None
    mesh.vertex_groups.clear()
    print("applied armature pose into mesh")


def strip_non_mesh() -> None:
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    # Drop tiny helper meshes
    for o in list(bpy.data.objects):
        if o.type == "MESH" and len(o.data.vertices) < 500:
            bpy.data.objects.remove(o, do_unlink=True)


def center_on_feet(mesh: bpy.types.Object) -> None:
    """Put feet on Z=0 and center on world origin (Mixamo-friendly)."""
    bpy.context.view_layer.update()
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    min_z = min(zs)
    cx = 0.5 * (min(xs) + max(xs))
    cy = 0.5 * (min(ys) + max(ys))
    mesh.location -= Vector((cx, cy, min_z))
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Origin at feet center
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")  # cursor still 0,0,0 after apply
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    print(
        f"centered feet-on-ground  "
        f"height={max(zs) - min_z:.3f}  "
        f"foot_z→0"
    )


def scale_to_mixamo_height(mesh: bpy.types.Object, target_m: float = 1.75) -> None:
    """Mixamo markers behave better near adult human height."""
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    zs = [p.z for p in pts]
    height = max(zs) - min(zs)
    if height < 1e-4:
        return
    s = target_m / height
    mesh.scale *= s
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    print(f"scaled height {height:.3f} → {target_m:.2f}m (×{s:.3f})")


def decimate_to_target(mesh: bpy.types.Object, target_faces: int) -> None:
    faces = len(mesh.data.polygons)
    if faces <= target_faces:
        print(f"already ≤ target faces ({faces})")
        return
    ratio = max(0.02, min(1.0, target_faces / faces))
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    mod = mesh.modifiers.new(name="DecimateMixamo", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

    # Light cleanup
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"decimated {faces} → {len(mesh.data.polygons)} faces (ratio={ratio:.4f})")


def strip_materials_for_size(mesh: bpy.types.Object) -> None:
    mesh.data.materials.clear()
    # Drop UV-heavy image packs by clearing materials only; keep UVs for Mixamo paint
    print("cleared materials (smaller upload; Mixamo doesn't need PBR)")


def export_fbx(path: Path, mesh: bpy.types.Object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        object_types={"MESH"},
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        apply_unit_scale=True,
        bake_space_transform=True,
        mesh_smooth_type="FACE",
        use_mesh_modifiers=True,
        add_leaf_bones=False,
        bake_anim=False,
        path_mode="STRIP",
        embed_textures=False,
    )
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def export_obj(path: Path, mesh: bpy.types.Object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    # Blender 4+/5: wm.obj_export
    if hasattr(bpy.ops.wm, "obj_export"):
        bpy.ops.wm.obj_export(
            filepath=str(path),
            export_selected_objects=True,
            export_materials=False,
            export_uv=True,
            export_normals=True,
            forward_axis="NEGATIVE_Z",
            up_axis="Y",
        )
    else:
        bpy.ops.export_scene.obj(
            filepath=str(path),
            use_selection=True,
            use_materials=False,
            use_normals=True,
            use_uvs=True,
            axis_forward="-Z",
            axis_up="Y",
        )
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def write_readme(mesh: bpy.types.Object) -> None:
    faces = len(mesh.data.polygons)
    verts = len(mesh.data.vertices)
    (OUT_DIR / "README.md").write_text(
        f"""# Winged Monkey — Mixamo upload pack

Derived from `masters/wingedmonkey/meshes/WingedMonkey.glb` (master untouched).

## Files

| File | Use |
|------|-----|
| `WingedMonkey_mixamo.fbx` | Preferred Mixamo upload |
| `WingedMonkey_mixamo.obj` | Fallback if FBX fails |

Current mesh: **{verts:,} verts / {faces:,} faces**, ~1.75 m tall, mesh-only, feet on origin.

## Upload steps

1. Open [Mixamo](https://www.mixamo.com) → **Upload Character**
2. Drop `WingedMonkey_mixamo.fbx`
3. Place markers (chin, wrists, elbows, knees, groin, hips)
4. Download **FBX Binary**, Skin: **With Skin** (first pack)

## Rebuild

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \\
  --python scripts/export_winged_monkey_mixamo.py
```

## Notes

- Arms are nudged toward a T/A pose for easier marker placement.
- Wings stay in the silhouette (folded on this mesh). If Mixamo mis-detects limbs,
  try the OBJ, or ask for a body-only variant.
- After Mixamo rigs it, drop the downloaded FBX into `models/wingedmonkey/` (derived)
  — never overwrite `masters/`.
"""
    )


def main() -> None:
    if not MASTER.exists():
        raise SystemExit(f"Missing master: {MASTER}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(MASTER))
    mesh = find_body_mesh()
    mesh.name = "WingedMonkey_mixamo"
    arm = find_armature()
    print(f"source verts={len(mesh.data.vertices)} faces={len(mesh.data.polygons)}")

    if arm is not None:
        pose_toward_tpose(arm)
        apply_armature_pose(mesh, arm)

    strip_non_mesh()
    # Re-find after strip
    mesh = find_body_mesh()
    mesh.name = "WingedMonkey_mixamo"

    center_on_feet(mesh)
    scale_to_mixamo_height(mesh, 1.75)
    decimate_to_target(mesh, TARGET_FACES)
    strip_materials_for_size(mesh)

    export_fbx(OUT_FBX, mesh)
    export_obj(OUT_OBJ, mesh)
    write_readme(mesh)
    print("DONE Mixamo pack →", OUT_DIR)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("MIXAMO EXPORT FAILED:", e, file=sys.stderr)
        raise
