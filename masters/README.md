# Masters

Canonical **read-only** originals for this repo (tracked in git; large binaries via Git LFS).

- Put new master/original exports here first (do not edit in place).
- Derived/optimized/game packs go under `models/` (or other working paths), never back into `masters/`.
- After changing masters or derived packs, commit and push so `origin` stays current (`git lfs pull` on fresh clones).

Example layout:

```
masters/
  dorothy/
    Sprites/         # original sprite exports (NEW/, direction packs, …)
    meshes/          # master rigs / GLBs
    Animations/      # original FBX + baked mixamo_character GLBs
  wingedmonkey/
    meshes/          # master meshes (Tripo, Hunyuan remesh, Mixamo-prep)
```

Winged Monkey mesh masters (do not edit):

- `masters/wingedmonkey/meshes/WingedMonkey.glb` — original Tripo export
- `masters/wingedmonkey/meshes/WingedMonkey_NEW.glb` — updated body mesh
- `masters/wingedmonkey/meshes/monkey_lowpoly.glb` — Hunyuan remesh (low-poly, T-pose)
- `masters/wingedmonkey/meshes/monkey_mixamo.glb` — Mixamo-upload prep derived from `monkey_lowpoly` (rebuilt via `scripts/export_monkey_mixamo.py`)

Mixamo upload pack (derived, under `models/`):

- `models/wingedmonkey/mixamo/monkey_mixamo.fbx` — upload this to Mixamo
- See `models/wingedmonkey/mixamo/README.md`

Dorothy sprite masters (do not edit):

- `masters/dorothy/Sprites/NEW/` — direction packs / exports
- Other packs under `masters/dorothy/Sprites/` — treat as originals

Runtime / optimized Dorothy sprites (derived):

- `models/dorothy/Sprites/game/` — packs the game Preload uses

Dorothy locomotion masters (do not edit):

- `masters/dorothy/Animations/Traversal_{walk,run}.fbx`, `Jump.fbx`, `Idle.fbx`
- `masters/dorothy/Animations/mixamo_character/{Traversal_walk,Traversal_run,Jump,Idle}.glb`

Seed optimized studio copies (writes only under `models/`):

```bash
npx tsx scripts/seed_dorothy_anims_from_masters.ts
```
