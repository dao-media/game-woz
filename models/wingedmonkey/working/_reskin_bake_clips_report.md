# Reskin — bake clips onto deform armature

- Source (untouched): `models/wingedmonkey/working/Monkey_reskin_gargoyle_bound.blend`
- Working bake blend: `models/wingedmonkey/working/Monkey_reskin_gargoyle_baked.blend`
- Studio character GLB: `models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb` (Idle/Walk/FlyIdleLoop/FlyForward/Attack01 only)
- Native clip GLBs: `models/wingedmonkey/Animations/gargoyle_native_wip/` (armature-only, Garg* tracks)
- Mesh / vertex weights: **unchanged** (Part B deferred)
- Donor removed from bake blend after bake; location keys scaled ×0.01 while sampling

## Baked clips

| Clip | Donor frames | Local frames |
|---|---|---|
| Idle | 80–190 | 111 |
| Walk | 360–390 | 31 |
| FlyIdleLoop | 1305–1335 | 31 |
| FlyForward | 1180–1210 | 31 |
| Attack01 | 410–470 | 61 |

## Verify (donor hidden — mesh AABB)

| Clip | mesh_animates | center travel | vol ratio |
|---|---|---|---|
| Idle | **yes** | 0.079 m | 1.000 |
| Walk | **yes** | 0.063 m | 1.227 |
| FlyIdleLoop | **yes** | 0.721 m | 1.161 |
| FlyForward | **yes** | 0.892 m | 1.196 |
| Attack01 | **yes** | 2.216 m | 1.328 |

## Regions (Fly / Attack — clear motion)

Distance weights unchanged; expect prior Step-2 artifacts under extremes.

| Region | Fly Idle / Forward | Attack01 |
|---|---|---|
| torso | mesh moves + deforms | mesh moves + deforms |
| head | mesh moves + deforms | mesh moves + deforms |
| arms | mesh moves + deforms | mesh moves + deforms |
| hands | mesh moves + deforms | mesh moves + deforms |
| legs | mesh moves + deforms | mesh moves + deforms |
| wings | mesh moves + deforms | mesh moves + deforms (weight stretch risk) |

Idle/Walk: quieter deltas at mid-frame (hover / stance) but mesh AABB travel confirms deformation; same distance-weight quality as Step 2.

## Studio

- WIP entry → `WingedMonkey_reskin_wip_studio.glb`
- WIP `clipSet: gargoyle_native_wip` → new Garg* clip folder (other monkey still uses legacy gargoyle library)
