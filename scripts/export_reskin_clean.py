#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[1]
# WIP Studio export source: de-hunch + limb counter-pose + 10 native clips.
BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_limbs.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
KEEP = [
    "Idle",
    "Walk",
    "FlyIdleLoop",
    "FlyForward",
    "Attack01",
    "IdleToFly",
    "FlyToIdle",
    "FlyAttack02",
    "FlyHit",
    "Hit",
]

def log(m): print(m, flush=True)

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
tgt = bpy.data.objects["ARM_GargoyleNative"]
mesh = bpy.data.objects["SM_WingedMonkey_reskin"]
donor = bpy.data.objects.get("GargoyleAnimDonor")

# Purge donor object + Take 001 actions so they cannot leak into GLB
if donor:
    bpy.data.objects.remove(donor, do_unlink=True)
    log("removed GargoyleAnimDonor")
keep = set(KEEP)
for act in list(bpy.data.actions):
    if act.name not in keep:
        log(f"remove action {act.name}")
        bpy.data.actions.remove(act)

# Rebuild NLA from kept actions only
if not tgt.animation_data:
    tgt.animation_data_create()
for track in list(tgt.animation_data.nla_tracks):
    tgt.animation_data.nla_tracks.remove(track)
tgt.animation_data.action = None
cursor = 1
for name in KEEP:
    act = bpy.data.actions.get(name)
    if not act:
        raise RuntimeError(f"missing {name}")
    track = tgt.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, start=cursor, action=act)
    if hasattr(strip, "action_slot"):
        slots = list(getattr(tgt.animation_data, "action_suitable_slots", []) or [])
        if slots:
            try: strip.action_slot = slots[0]
            except Exception: pass
    cursor = int(strip.frame_end) + 2
    log(f"NLA {name}")

# Character export (mesh + armature, NLA tracks)
bpy.ops.object.select_all(action="DESELECT")
mesh.hide_viewport = False
tgt.hide_viewport = False
mesh.select_set(True)
tgt.select_set(True)
bpy.context.view_layer.objects.active = tgt
log("export character...")
kwargs = dict(
    filepath=str(OUT_GLB),
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_animations=True,
    export_nla_strips=True,
    export_anim_single_armature=True,
    export_cameras=False,
    export_lights=False,
    export_draco_mesh_compression_enable=False,
    export_skins=True,
    export_morph=False,
)
# Prefer NLA_TRACKS mode when available (Blender 4+/5)
if "export_animation_mode" in bpy.ops.export_scene.gltf.get_rna_type().properties.keys():
    kwargs["export_animation_mode"] = "NLA_TRACKS"
bpy.ops.export_scene.gltf(**kwargs)
log(f"character {OUT_GLB.stat().st_size/1024/1024:.2f} MB")

# Armature-only clip library
CLIP_DIR.mkdir(parents=True, exist_ok=True)
for p in CLIP_DIR.glob("*.glb"):
    p.unlink()
mesh.hide_viewport = True
mesh.hide_render = True
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
for name in KEEP:
    act = bpy.data.actions.get(name)
    for t in tgt.animation_data.nla_tracks:
        t.mute = True
    tgt.animation_data.action = act
    if hasattr(tgt.animation_data, "action_slot"):
        slots = list(getattr(tgt.animation_data, "action_suitable_slots", []) or [])
        if slots:
            try: tgt.animation_data.action_slot = slots[0]
            except Exception: pass
    bpy.ops.object.select_all(action="DESELECT")
    tgt.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    out = CLIP_DIR / f"{name}.glb"
    log(f"export clip {name}")
    ck = dict(
        filepath=str(out),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_nla_strips=False,
        export_anim_single_armature=True,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
        export_skins=True,
        export_morph=False,
    )
    if "export_animation_mode" in props:
        ck["export_animation_mode"] = "ACTIVE_ACTIONS"
    bpy.ops.export_scene.gltf(**ck)
    log(f"  {out.stat().st_size/1024:.1f} KB")

mesh.hide_viewport = False
mesh.hide_render = False
log("DONE")
