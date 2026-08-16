#!/usr/bin/env python3
"""
Dorothy cloth/hair Blender sim setup (derived only — never writes masters/).

Pipeline (sprite-scale mindset: readable sway, then stop):
  1. Read masters/dorothy/meshes/Dorothy_rigged.glb (immutable)
  2. Copy walk action from models/.../Traversal_walk.glb
  3. Split Dress + Hair meshes from Body (color classify)
  4. Cloth on Dress (pin waist) + light Cloth on Hair (pin scalp)
  5. Body = Collision
  6. Bake walk range → models/dorothy/sim/

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/setup_dorothy_cloth_sim.py
"""
from __future__ import annotations

import array
import math
import sys
import time
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SRC_MESH = ROOT / "masters/dorothy/meshes/Dorothy_rigged.glb"
SRC_WALK = ROOT / "models/dorothy/Animations/mixamo_character/Traversal_walk.glb"
OUT_DIR = ROOT / "models/dorothy/sim"
OUT_BLEND = OUT_DIR / "Dorothy_cloth_walk_test.blend"
OUT_PREVIEW = OUT_DIR / "preview_walk"
FPS = 30
QUALITY_STEPS = 10


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def sample_tex(pix: array.array, w: int, h: int, u: float, v: float) -> tuple[float, float, float]:
    x = int(max(0, min(w - 1, (u % 1.0) * w)))
    y = int(max(0, min(h - 1, (v % 1.0) * h)))
    i = (y * w + x) * 4
    return pix[i], pix[i + 1], pix[i + 2]


def classify_vertex_kinds(mesh_obj: bpy.types.Object) -> dict[int, str]:
    """Return vi -> 'dress'|'hair'|'body' from albedo (same heuristics as bone script)."""
    img = next(i for i in bpy.data.images if i.size[0] > 0)
    w, h = img.size[:]
    pix = array.array("f", img.pixels)
    uv_layer = mesh_obj.data.uv_layers.active.data
    vert_uv: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for poly in mesh_obj.data.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            vert_uv[vi].append(tuple(uv_layer[li].uv))

    kind: dict[int, str] = {}
    for vi, uvs in vert_uv.items():
        u = sum(a for a, _ in uvs) / len(uvs)
        v = sum(b for _, b in uvs) / len(uvs)
        r, g, b = sample_tex(pix, w, h, u, v)
        co = mesh_obj.matrix_world @ mesh_obj.data.vertices[vi].co
        if co.z > 0.72 and r > 0.25 and r >= g * 0.9 and b < 0.38:
            kind[vi] = "hair"
        elif 0.05 < co.z < 0.58 and b > 0.28 and b >= r * 0.85 and b >= g * 0.8:
            kind[vi] = "dress"
        else:
            kind[vi] = "body"
    return kind


def duplicate_object(obj: bpy.types.Object, name: str) -> bpy.types.Object:
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = name
    bpy.context.collection.objects.link(copy)
    return copy


def delete_verts_except(obj: bpy.types.Object, keep: set[int]) -> None:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    me = obj.data
    for v in me.vertices:
        v.select = v.index not in keep
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    # Drop empty vertex groups noise later if needed


def ensure_vgroup(obj: bpy.types.Object, name: str) -> bpy.types.VertexGroup:
    vg = obj.vertex_groups.get(name)
    return vg if vg else obj.vertex_groups.new(name=name)


def paint_pin_dress(obj: bpy.types.Object) -> str:
    """Waistband pin: only the top band — leave most of the skirt free to sway."""
    name = "PIN_Cloth"
    vg = ensure_vgroup(obj, name)
    zs = [(v.index, (obj.matrix_world @ v.co).z) for v in obj.data.vertices]
    if not zs:
        return name
    zmin = min(z for _, z in zs)
    zmax = max(z for _, z in zs)
    # Top ~10% fully pinned; blend over next ~10%
    pin_lo = zmax - (zmax - zmin) * 0.10
    blend_lo = zmax - (zmax - zmin) * 0.20
    for vi, z in zs:
        if z >= pin_lo:
            w = 1.0
        elif z <= blend_lo:
            w = 0.0
        else:
            w = (z - blend_lo) / max(1e-6, pin_lo - blend_lo)
        vg.add([vi], w, "REPLACE")
    print(f"  dress pin: z[{zmin:.3f},{zmax:.3f}] full>={pin_lo:.3f} (narrow waistband)")
    return name


def decimate_dress(obj: bpy.types.Object, target_faces: int = 1200) -> None:
    """Cloth needs a lighter mesh — Tripo density either locks or explodes."""
    n_before = len(obj.data.polygons)
    if n_before <= target_faces:
        print(f"  dress faces={n_before} (no decimate)")
        return
    ratio = target_faces / max(1, n_before)
    mod = obj.modifiers.new("DecimateForCloth", "DECIMATE")
    mod.ratio = max(0.05, min(1.0, ratio))
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"  dress decimated {n_before} → {len(obj.data.polygons)} faces (cloth-friendly)")


def add_cloth(obj: bpy.types.Object, pin_group: str, *, preset: str, mass: float, bending: float) -> None:
    """Sprite-readable skirt: hold length, allow left/right lag + wind push."""
    mod = obj.modifiers.new(name="Cloth", type="CLOTH")
    cloth = mod.settings
    if hasattr(cloth, "quality"):
        cloth.quality = QUALITY_STEPS
    cloth.mass = mass
    # Lower air damping = more swing / lag (was overdamped into invisibility)
    cloth.air_damping = 1.0
    # Enough tension to hold length; not so much that it glued to armature
    cloth.tension_stiffness = 55.0 if preset == "SILK" else 70.0
    cloth.compression_stiffness = 55.0 if preset == "SILK" else 70.0
    cloth.shear_stiffness = 15.0 if preset == "SILK" else 22.0
    cloth.bending_stiffness = bending
    cloth.tension_damping = 8.0
    cloth.compression_damping = 8.0
    cloth.shear_damping = 8.0
    cloth.bending_damping = 0.5
    cloth.vertex_group_mass = pin_group
    cloth.use_dynamic_mesh = True
    cloth.pin_stiffness = 1.0
    if hasattr(cloth, "time_scale"):
        cloth.time_scale = 1.0
    if hasattr(cloth, "effector_weights"):
        cloth.effector_weights.gravity = 0.08
        cloth.effector_weights.wind = 2.0
        cloth.effector_weights.force = 2.0
    col = mod.collision_settings
    col.use_collision = False
    col.use_self_collision = False
    if hasattr(col, "collision_quality"):
        col.collision_quality = 2
    print(
        f"  cloth on {obj.name}: mass={mass} bend={bending} tension={cloth.tension_stiffness} "
        f"grav={cloth.effector_weights.gravity:.2f} wind=on"
    )


def add_walk_wind(f0: int, f1: int) -> bpy.types.Object:
    """
    Side wind that flips with the walk so the hem sways in X (front-view readable).
    Hip travel alone is ~3cm — too small to see at sprite scale without a push.
    """
    bpy.ops.object.effector_add(type="WIND", location=(0.0, 0.0, 0.35))
    wind = bpy.context.object
    wind.name = "ClothWind"
    wind.field.strength = 400.0
    wind.field.flow = 0.5
    wind.field.noise = 0.5
    # Wind blows along local +Z of the effector → aim +Z at world +X
    wind.rotation_euler = (0.0, math.radians(90), 0.0)

    action_len = max(1, f1 - f0)
    for i in range(0, action_len + 1):
        f = f0 + i
        phase = (i / action_len) * math.pi * 4  # two full swings per walk loop
        wind.field.strength = 450.0 * math.sin(phase)
        wind.field.keyframe_insert(data_path="strength", frame=f)
    print(f"  wind field ClothWind animated {f0}–{f1} (strong side push for sprite read)")
    return wind


def render_comparison(dress: bpy.types.Object, f0: int, f1: int) -> None:
    """Side-by-side cloth OFF | ON — dress only, so silhouette delta is obvious."""
    out = OUT_DIR / "preview_compare"
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 256
    scene.render.resolution_y = 256
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    # Hide everything except dress for a clear silhouette compare
    hidden = []
    for o in bpy.data.objects:
        if o != dress and o.type in {"MESH", "ARMATURE"}:
            if o.hide_render is False:
                hidden.append(o)
                o.hide_render = True
                o.hide_viewport = True

    cam = bpy.data.objects.get("PreviewCam")
    if cam is None:
        cam_data = bpy.data.cameras.new("PreviewCam")
        cam = bpy.data.objects.new("PreviewCam", cam_data)
        bpy.context.collection.objects.link(cam)
    # Front view — X sway reads clearly
    cam.location = (0.0, -2.2, 0.55)
    cam.rotation_euler = (math.radians(82), 0.0, 0.0)
    scene.camera = cam

    if not any(o.type == "LIGHT" for o in bpy.data.objects):
        light_data = bpy.data.lights.new("PreviewKey", "SUN")
        light_data.energy = 2.5
        light = bpy.data.objects.new("PreviewKey", light_data)
        bpy.context.collection.objects.link(light)
        light.rotation_euler = (math.radians(50), math.radians(10), 0)

    cloth_mod = next(m for m in dress.modifiers if m.type == "CLOTH")
    step = max(1, (f1 - f0) // 6)
    tmp_paths = []
    for f in range(f0, f1 + 1, step):
        scene.frame_set(f)
        cloth_mod.show_render = False
        cloth_mod.show_viewport = False
        p_off = out / f"_tmp_off_{f:04d}.png"
        scene.render.filepath = str(p_off)
        bpy.ops.render.render(write_still=True)
        cloth_mod.show_render = True
        cloth_mod.show_viewport = True
        p_on = out / f"_tmp_on_{f:04d}.png"
        scene.render.filepath = str(p_on)
        bpy.ops.render.render(write_still=True)
        tmp_paths.append((f, p_off, p_on))

    # Stitch outside Blender if needed — write a tiny stitch script marker
    stitch = out / "STITCH_ME.txt"
    stitch.write_text("\n".join(f"{f}\t{off.name}\t{on.name}" for f, off, on in tmp_paths))
    print(f"  comparison frames → {out} ({len(tmp_paths)} pairs)")

    for o in hidden:
        o.hide_render = False
        o.hide_viewport = False
    cloth_mod.show_render = True
    cloth_mod.show_viewport = True


def paint_pin_hair(obj: bpy.types.Object) -> str:
    """Scalp pin: highest hair verts → 1, tips → 0."""
    name = "PIN_Cloth"
    vg = ensure_vgroup(obj, name)
    zs = [(v.index, (obj.matrix_world @ v.co).z) for v in obj.data.vertices]
    if not zs:
        return name
    zmin = min(z for _, z in zs)
    zmax = max(z for _, z in zs)
    pin_lo = zmax - (zmax - zmin) * 0.22
    blend_lo = zmax - (zmax - zmin) * 0.45
    for vi, z in zs:
        if z >= pin_lo:
            w = 1.0
        elif z <= blend_lo:
            w = 0.0
        else:
            w = (z - blend_lo) / max(1e-6, pin_lo - blend_lo)
        vg.add([vi], w, "REPLACE")
    print(f"  hair pin: z[{zmin:.3f},{zmax:.3f}] full>={pin_lo:.3f}")
    return name


def add_collision(obj: bpy.types.Object) -> None:
    mod = obj.modifiers.new(name="Collision", type="COLLISION")
    # Soft body-ish thickness for legs under skirt
    if hasattr(obj.collision, "thickness_outer"):
        obj.collision.thickness_outer = 0.012
        obj.collision.thickness_inner = 0.008
    print(f"  collision on {obj.name}")


def import_walk_action(arm: bpy.types.Object) -> tuple[bpy.types.Action, int, int]:
    """Pull Animation action from walk GLB onto our armature; return (action, f0, f1)."""
    # Import walk into a temp collection, steal action, delete walk objects
    before = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(SRC_WALK))
    new_objs = [o for o in bpy.data.objects if o not in before]
    new_actions = [a for a in bpy.data.actions if a not in before_actions]
    walk_arm = next((o for o in new_objs if o.type == "ARMATURE"), None)
    action = None
    if walk_arm and walk_arm.animation_data and walk_arm.animation_data.action:
        action = walk_arm.animation_data.action
    elif new_actions:
        action = new_actions[0]
    else:
        # Walk file may have reused name "Animation"
        action = bpy.data.actions.get("Animation")
    if action is None:
        raise RuntimeError("No walk action found in Traversal_walk.glb")

    action = action.copy()
    action.name = "Walk_Dorothy"

    # Remove imported walk objects (keep our Dorothy from master)
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)

    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    # Blender 5 slotted actions
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        try:
            arm.animation_data.action_slot = action.slots[0]
        except Exception:
            pass

    f0 = int(action.frame_range[0])
    f1 = int(action.frame_range[1])
    if f1 <= f0:
        f1 = f0 + 24
    print(f"  walk action '{action.name}' frames {f0}–{f1}")
    return action, f0, f1


def bake_cloth(obj: bpy.types.Object, f0: int, f1: int) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    cloth_mod = next(m for m in obj.modifiers if m.type == "CLOTH")
    cache = cloth_mod.point_cache
    cache.frame_start = f0
    cache.frame_end = f1
    # Bake via override context
    with bpy.context.temp_override(active_object=obj, object=obj, point_cache=cache, scene=bpy.context.scene):
        bpy.ops.ptcache.bake(bake=True)
    print(f"  baked {obj.name} cache {f0}–{f1}")


def render_preview(f0: int, f1: int, step: int = 3) -> None:
    OUT_PREVIEW.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items else "BLENDER_WORKBENCH"
    # Prefer workbench for speed
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 256
    scene.render.resolution_y = 256
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    # Simple camera if none
    if not any(o.type == "CAMERA" for o in bpy.data.objects):
        cam_data = bpy.data.cameras.new("PreviewCam")
        cam = bpy.data.objects.new("PreviewCam", cam_data)
        bpy.context.collection.objects.link(cam)
        cam.location = (0.0, -2.4, 0.9)
        cam.rotation_euler = (math.radians(80), 0, 0)
        scene.camera = cam
    else:
        scene.camera = next(o for o in bpy.data.objects if o.type == "CAMERA")

    # Light
    if not any(o.type == "LIGHT" for o in bpy.data.objects):
        light_data = bpy.data.lights.new("PreviewKey", "SUN")
        light_data.energy = 2.0
        light = bpy.data.objects.new("PreviewKey", light_data)
        bpy.context.collection.objects.link(light)
        light.rotation_euler = (math.radians(45), math.radians(15), 0)

    for f in range(f0, f1 + 1, step):
        scene.frame_set(f)
        scene.render.filepath = str(OUT_PREVIEW / f"walk_{f:04d}.png")
        bpy.ops.render.render(write_still=True)
    print(f"  preview frames → {OUT_PREVIEW}")


def main() -> None:
    t0 = time.time()
    if not SRC_MESH.exists():
        raise SystemExit(f"Missing master mesh (read-only source): {SRC_MESH}")
    if not SRC_WALK.exists():
        raise SystemExit(f"Missing walk clip: {SRC_WALK}")
    if "masters/" in str(OUT_DIR) or OUT_DIR.resolve().is_relative_to((ROOT / "masters").resolve()):
        raise SystemExit("Refusing to write under masters/")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    clear_scene()

    print(f"READ master (immutable): {SRC_MESH}")
    bpy.ops.import_scene.gltf(filepath=str(SRC_MESH))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    body = next(o for o in bpy.data.objects if o.type == "MESH" and o.name != "Icosphere")
    # Drop junk
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name.lower().startswith("ico"):
            bpy.data.objects.remove(o, do_unlink=True)

    arm.name = "Armature"
    body.name = "Dorothy_Body"
    print(f"  armature bones={len(arm.data.bones)} body verts={len(body.data.vertices)}")

    print("Classify dress/hair/body…")
    kind = classify_vertex_kinds(body)
    dress_ids = {vi for vi, k in kind.items() if k == "dress"}
    hair_ids = {vi for vi, k in kind.items() if k == "hair"}
    body_ids = {vi for vi, k in kind.items() if k == "body"}
    print(f"  counts dress={len(dress_ids)} hair={len(hair_ids)} body={len(body_ids)}")
    if len(dress_ids) < 200:
        raise SystemExit("Dress classification too small — aborting before write")

    print("Split derived meshes…")
    dress = duplicate_object(body, "Dorothy_Dress")
    hair = duplicate_object(body, "Dorothy_Hair")
    delete_verts_except(dress, dress_ids)
    delete_verts_except(hair, hair_ids)
    delete_verts_except(body, body_ids)
    print(
        f"  after split: body={len(body.data.vertices)} "
        f"dress={len(dress.data.vertices)} hair={len(hair.data.vertices)}"
    )

    # Parent / armature
    for obj in (body, dress, hair):
        obj.parent = arm
        # Keep existing Armature modifier if present
        mods = [m for m in obj.modifiers if m.type == "ARMATURE"]
        if not mods:
            am = obj.modifiers.new("Armature", "ARMATURE")
            am.object = arm
        else:
            mods[0].object = arm

    print("Pin groups…")
    # Decimate before pinning so weights land on the sim mesh
    decimate_dress(dress, target_faces=1400)
    dress_pin = paint_pin_dress(dress)
    hair_pin = paint_pin_hair(hair)

    print("Physics…")
    add_collision(body)
    add_cloth(dress, dress_pin, preset="SILK", mass=0.35, bending=0.2)
    for m in list(hair.modifiers):
        if m.type == "CLOTH":
            hair.modifiers.remove(m)
    print("  hair: mesh-on-bones only (no cloth this pass)")

    # Modifier order: Armature first (bottom), Cloth on top
    arm_mod = next(m for m in dress.modifiers if m.type == "ARMATURE")
    cloth_mod = next(m for m in dress.modifiers if m.type == "CLOTH")
    bpy.context.view_layer.objects.active = dress
    while dress.modifiers[0] != arm_mod:
        bpy.ops.object.modifier_move_up(modifier=arm_mod.name)
    while dress.modifiers[-1] != cloth_mod:
        bpy.ops.object.modifier_move_down(modifier=cloth_mod.name)

    print("Attach walk action…")
    _action, f0, f1 = import_walk_action(arm)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = f0
    scene.frame_end = f1
    scene.frame_set(f0)

    # Apply scale on sim objects (cloth likes applied scale)
    for obj in (body, dress, hair, arm):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.select_all(action="DESELECT")

    print("Add walk wind (sprite-readable X sway)…")
    add_walk_wind(f0, f1)

    print("Bake dress cloth…")
    bake_cloth(dress, f0, f1)
    print("Skip hair cloth bake (bones only)")

    print(f"Save blend → {OUT_BLEND}")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    print("Render cloth OFF|ON comparison…")
    try:
        render_comparison(dress, f0, f1)
    except Exception as e:
        print(f"  comparison render failed: {e}")
        try:
            render_preview(f0, f1, step=max(1, (f1 - f0) // 8))
        except Exception as e2:
            print(f"  preview render skipped: {e2}")

    print(f"DONE in {time.time() - t0:.1f}s")
    print(f"  master untouched: {SRC_MESH}")
    print(f"  outputs: {OUT_BLEND}")
    print(f"  compare: {OUT_DIR / 'preview_compare'}")
    for p in OUT_DIR.rglob("*"):
        if not p.is_file():
            continue
        if "masters" in p.parts:
            raise SystemExit(f"Refusing: wrote under masters: {p}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FAILED:", e, file=sys.stderr)
        raise
