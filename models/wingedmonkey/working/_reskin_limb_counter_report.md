# Reskin limb counter-pose (verdict B)

## Plan applied

| Bones | Offset | Why |
|-------|--------|-----|
| `GargLArmCollarbone`, `GargRCollarbone` | **+37.3°** world-+X orientation | Inverse of pelvis de-hunch — restores PRE world arm aim; children (upperarm/forearm) inherit |
| `GargLLegThigh1`, `GargRThigh1` | **+55°** world-+X on Idle / FlyIdle / FlyForward | PRE-restore (+37.3) + ~18° aesthetic so legs hang/tuck under upright torso (not horizontal-back) |
| Same four bones on Attack01 | **+37.3°** only | Attack mid-frame thighs were already near-natural; +55 overshot |

- Orientation-only (socket world translation kept). Clip motion preserved (constant offset composed into every frame).
- **GargPelvis untouched** (de-hunch keys identical). **Weights untouched.**
- Working copy: `models/wingedmonkey/working/Monkey_reskin_gargoyle_limbs.blend`
- Sources untouched: `dehunch.blend`, `feet_flyidle.blend`, masters.

## Before → after limb aim (`from_down` °, mid-frame)

| Clip | L thigh | R thigh | L upperarm | R upperarm |
|------|---------|---------|------------|------------|
| Idle | 100.4 → **49.9** | 80.4 → ~43* | 53.1 → **20.7** | 44.3 → **18.1** |
| Fly Idle | 108.7 → **54.8** | 83.1 → ~46* | 89.9 → **53.2** | 103.7 → **66.6** |
| Fly Forward | 69.7 → **15.2** | 54.2 → **3.0** | 87.9 → **52.5** | 86.1 → **50.2** |
| Attack01 | (+37.3) → **19.9** | → **49.6** | → **30.3** | — |

\*Idle/FlyIdle R thigh tracked with L under symmetric +55° bake (see JSON).

## Guards

- Pelvis pitch: Idle ≈0°, Fly Idle ≈−8°, Fly Forward ≈+15° (unchanged; hover–dive gap preserved)
- Weights fingerprint: unchanged
- Originals intact

## Export

- `models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb` — **38.3 MB**, uncompressed (no Draco)
- Clip library refreshed under `models/wingedmonkey/Animations/gargoyle_native_wip/`
- Sprite previews: `models/wingedmonkey/working/_limb_counter_sprites/*_side_v2_128px.png`

## Script

`scripts/bake_reskin_limb_counterpose.py` (v1 used uniform +37.3; final bake used per-bone/per-clip values above — update script if re-running).
