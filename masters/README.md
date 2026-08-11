# Masters

Canonical **read-only** originals for this repo.

- Put new master/original exports here first (do not edit in place).
- Derived/optimized/game packs go under `models/` (or other working paths), never back into `masters/`.

Example layout:

```
masters/
  dorothy/
    Sprites/NEW/     # original sprite packs
    meshes/          # master rigs / GLBs
    Animations/      # original FBX + baked mixamo_character GLBs
```

Dorothy locomotion masters (do not edit):

- `masters/dorothy/Animations/Traversal_{walk,run}.fbx`, `Jump.fbx`, `Idle.fbx`
- `masters/dorothy/Animations/mixamo_character/{Traversal_walk,Traversal_run,Jump,Idle}.glb`

Seed optimized studio copies (writes only under `models/`):

```bash
npx tsx scripts/seed_dorothy_anims_from_masters.ts
```
