# OZ: Down the Yellow Brick Road (WOZ Game)

Portable Phaser 3 greybox — **one-point perspective** floor-plane travel with combat, utility AI enemies, difficulty presets, and triggered encounters.

Private repo: [dao-media/game-woz](https://github.com/dao-media/game-woz)

---

## Stack

| Layer | Choice |
|-------|--------|
| Engine | Phaser **3.90** |
| Language | TypeScript (strict) |
| Bundler | Vite (`base: './'` — relative paths for portable / file / itch deploy) |
| Physics | Arcade (gravity 0; movement is custom floor-plane) |
| Persistence | `Storage` interface → `WebStorage` (localStorage) |

## Commands

```bash
npm install
npm run dev       # hot reload (local)
npm run build     # tsc && vite build
npm run preview   # serve dist/ — verify relative asset paths
```

---

## Scene flow

```
Boot → Preload → Menu → CharacterSelect → Munchkinland → Game → Win
```

| Scene | What happens |
|-------|----------------|
| **Boot** | Registers `Input`, `Storage`, `Lifecycle`, `RunState` in the Phaser registry |
| **Preload** | Dorothy NEW sprite atlases (walk / run / jump / idle) via `dorothySprites.ts` |
| **Menu** | Facade gate title (“Press START”) |
| **CharacterSelect** | Pick traveler + **difficulty** (Easy / Normal / Hard); persist to `RunState` |
| **Munchkinland** | Intro camera move → gate walk-out → free floor play → fork by `floorY` → path saved |
| **Game** | Continuation road: combat, AI enemies, triggered waves, optional **arena lock** |
| **Win** | Reach road end (blocked while arena-locked) |

**Fork paths** (`src/data/branches.ts`): Emerald City Road · Westward Path · Southern Trail — chosen by depth band at the split.

---

## Controls

| Action | Keys |
|--------|------|
| Move (floor plane) | WASD / arrows — ↑ farther (smaller `floorY`), ↓ nearer |
| Run | Shift + move |
| Jump | Space / K |
| Light attack (combo) | **J** |
| Heavy (heel-click bolt) | **L** |
| Ultimate (triple pulse) | **U** |
| Debug overlay | **;** / \` / F3 (macOS: F3 is often Mission Control — use **;** ) |
| Debug spawn enemy | **]** (`CLOSED_BRACKET`) — toggles Wheeler / Winged Monkey |
| Character select | ← → character · ↑ ↓ difficulty · Enter confirm · Esc back |

Bindings live in `src/config/keybindings.ts`. Unknown Phaser key names are **skipped with a warning** (do not crash boot).

---

## Stage model

- **One-point perspective** — `src/core/Projection.ts`: `floorX` / `floorY` / `z` → screen; vanishing X tracks camera mid-X.
- **Depth scale** — `depthScale` drives perspective X; character sprites use `entityDepthScale(floorY, playerDepthScaleStrength)` only (no per-clip scale multipliers).
- **Jump height** — screen Y is `groundScreenY(floorY) − z`. Air height comes from engine `z` only; Jump sprites are in-place (no baked lift).
- **StageView** — trapezoid floor + vertical back wall; clean horizon seam (`src/render/StageView.ts`).
- **DepthTracks** — décor: `backdrop` (parallax) + `far` / `midFar` / `mid` / `near` (`src/core/DepthTracks.ts`).
- **Player** — free travel on the floor plane (not lane-locked); always `scrollFactor` 1.
- **Direction** — East = +`floorX` = screen-right; Munchkinland gate at west.

**All combat and AI resolve in floor space** (depth-aware). No screen-space hit tests. Visual sprite scale never feeds hit boxes.

---

## Progress report (up to date)

### Status legend

- **Shipped on `main`** — on origin (traversal, Dorothy combat, Phase A AI/encounters, Dorothy NEW sprites + unified scale).
- **In working tree** — local-only changes (e.g. 3D Studio experiments) not yet committed.
- **On disk only** — asset folders not wired into Preload.

### 1. Traversal & opening — shipped

- [x] Greybox scaffold: Boot / Preload / Menu / CharacterSelect / Munchkinland / Game / Win
- [x] One-point stage + free floor travel
- [x] Munchkinland opening: intro camera (`IntroCameraMove`), facade→feed framing, gate walk-out, free play
- [x] Fork selection by `floorY` → `RunState.selectedPath`
- [x] Character + path persistence via `Storage`

### 2. Combat spine — shipped (Dorothy complete greybox kit)

Reusable combat under `src/combat/`:

| Module | Role |
|--------|------|
| `Health` | `maxHP` / `currentHP`; ordered `damageModifiers` pipeline; death hooks |
| `Attack` | Data-driven `arc` / `rect` / `circle` in floor space; knockback clamped to `[depthFar, depthNear]` |
| `attacks.ts` | Dorothy 3-kick defs + placeholder kick |
| `CombatFeel` | Fill flash, floating damage numbers, short hit-stop |
| `RedEnergy` | Heavy forward bolt + ultimate expanding pulse rings (via `Projection`) |
| `CombatController` | Per-character kit; attached in `createPlayer` |

**Dorothy four tiers:**

| Tier | Behavior |
|------|----------|
| **Passive** | Silver Slippers — incoming damage reduction + HP regen |
| **Light** | Buffered 3-kick combo; FSM `lightAttack` |
| **Heavy** | Heel-click **projectile** red energy along facing; `floorY` tolerance; multi-hit cap; cooldown |
| **Ultimate** | Windup (input locked) → acquire nearest ≤3 in range → AoE pulse per target; long cooldown + **`ultimateCharge` 0–1 seam** (refills with CD for now; later fills from damage) |

**Other characters:** placeholder light kick only (Tin-Man / Lion / Scarecrow kits later).

**HUD** (`CombatHUD`): HP bar + L / U cooldown fill slots.

### 3. Enemies, utility AI, difficulty, encounters — Phase A (shipped)

| Module | Role |
|--------|------|
| `entities/createEnemy.ts` | **Sprite seam** — `enemyId` → configured `Enemy` |
| `data/enemies.ts` | Winged monkey + Wheeler data defs |
| `ai/Perception.ts` | Floor-space snapshot (pose, player FSM, heavy ready, recovery, allies, token flag) |
| `ai/UtilityAI.ts` | Score candidates; pick highest (not a fixed FSM loop) |
| `ai/Executor.ts` | Thin motor FSM: idle / move / dive / charge / attack / recover |
| `ai/brains/monkeyBrain.ts` | Standoff · dive · retreat · reposition · bait |
| `ai/brains/wheelerBrain.ts` | Charge · lunge · recover · circle · reposition |
| `ai/DifficultyParams.ts` | Slider-ready param block + Easy / Normal / Hard (+ `custom` slot) |
| `combat/EncounterManager.ts` | Triggered waves + arena lock / clear / unlock |
| `data/encounters.ts` | Encounter placement data |

**Design principle:** enemies feel **smart, not spongy**. Difficulty tunes **behavior** (reaction delay, punish accuracy, telegraph length, perception range, retreat bias). HP/damage mults stay minor (~±15–25%).

**Enemy types:**

- **Winged monkey** — flies at height (`z > 0`); holds standoff while player heavy is available; dives to punish when player is committed/recovering and heavy is down; retreats / flanks / baits.
- **Wheeler** — ground (`z = 0`); charges / lunges when it has an opening; circles and flanks on depth when it doesn’t; recovers after contact.

**Difficulty** — set on Character Select (↑↓), stored in `RunState.difficulty`. Presets in `tuning.difficultyPresets`. Phase B dials (`maxSimultaneousAttackers`, `commitCadenceMs`) already exist on the block but are unused until the director lands.

**Encounters on the Game road:**

| Id | Trigger `floorX` | Lock? | Contents |
|----|------------------|-------|----------|
| `wheeler-rush` | ~380 | No | 2 Wheelers |
| `monkey-harass` | ~720 | No | 2 Winged monkeys |
| `mixed-arena` | ~1100 | **Yes** | Wave 1: mix of 4 · Wave 2: 2 more; east clamp until clear |

Greybox combat dummies **retired**. `]` debug-spawns live AI enemies.

### 4. Platform / UX hardening — shipped

- [x] Input: unknown key codes warn + skip (fixes black screen from invalid `BRACKETRIGHT`; correct key is `CLOSED_BRACKET`)
- [x] Debug overlay: combat + **per-enemy intent / scores / executor** + encounter / difficulty
- [x] F3 sprite ground-truth: anim name, on-screen height, feet Y, `z`; auto-captures idle → shows **Δheight / Δfeet**; optional feet reference line

### 5. Dorothy sprites — shipped (unified scale)

| Path | Contents | In git? | Wired? |
|------|----------|---------|--------|
| `masters/dorothy/Sprites/NEW/` | Original 8-way Walk / Run / Jump + East/West Idle exports | **Yes** (Git LFS) | Source only — do not edit |
| `models/dorothy/Sprites/NEW/` | Runtime copy of NEW packs (Preload) | **Yes** (Git LFS) | **Yes** — `dorothySprites.ts` |
| `models/dorothy/Sprites/game/` | Older optimized packs | **Yes** (Git LFS) | Legacy / presentation |
| `models/` (FBX / GLB / other characters) | Dorothy + companions meshes & animations | Partially / local | Studio + some gameplay paths |
| `photos/characters/` | Reference photos / PSDs | Local | **No** |

**Scale invariant** (`Player.syncVisual` + `dorothySprites.ts`):

1. **One shared scale** — `dorothyBaseScale()` × `Projection.entityDepthScale(floorY, playerDepthScaleStrength)`. No per-anim multipliers (old jump / N·S shrink removed).
2. **Feet-anchored** — shared sole origin on untrimmed 460² frames (`applyDorothyFeetOrigin`).
3. **Vertical from `z` only** — in-place Jump packs; height is engine jump, not baked sprite lift.
4. **Jump playback** — `DOROTHY_JUMP_ANIM_TIME_SCALE = 1.5` (clip rate only; physics unchanged).

PNGs use **Git LFS**. After clone: `git lfs pull`. New exports → copy into `masters/` first, then mirror/derive into `models/` — never optimize masters in place.

`createPlayer` / `createEnemy` remain the seams for other characters’ atlases.

---

## Architecture map

```
src/
  ai/
    DifficultyParams.ts      # presets + resolveDifficultyParams
    Perception.ts            # decide-layer inputs
    UtilityAI.ts             # score → chosen ActionId
    Executor.ts              # motor FSM
    brains/monkeyBrain.ts
    brains/wheelerBrain.ts
  combat/
    Health.ts  Attack.ts  attacks.ts
    CombatController.ts  CombatFeel.ts  RedEnergy.ts
    EncounterManager.ts      # waves + arena lock
  config/
    tuning.ts                # ALL feel / AI / encounter numbers
    keybindings.ts
  core/
    Projection.ts  DepthTracks.ts  DepthSort.ts
    Registry.ts  StateMachine.ts
  data/
    characters.ts  enemies.ts  encounters.ts
    branches.ts  scenery.ts  entities.ts
  entities/
    Player.ts  Enemy.ts  dorothySprites.ts
    createPlayer.ts  createEnemy.ts   # art seams
    StageProp.ts
  platform/
    Input.ts  Storage.ts  Lifecycle.ts
  render/
    StageView.ts  FacadeGate.ts  MunchkinGate.ts
  scenes/
    Boot → Preload → Menu → CharacterSelect
    Munchkinland (+ IntroCameraMove) → Game → Win
  state/
    RunState.ts              # character, path, difficulty
  ui/
    CombatHUD.ts  DebugOverlay.ts
```

**Rules of the house**

1. No magic numbers in logic — use `tuning.ts`.
2. Character / enemy branching only at `createPlayer` / `createEnemy` (+ combat/AI brains they attach).
3. Hits and AI only in floor space.
4. East = +x; gate west.

---

## Tuning & data entry points

| Concern | File |
|---------|------|
| Movement, combat, AI presets, enemy feel, arena pads | `src/config/tuning.ts` |
| Key map | `src/config/keybindings.ts` |
| Playable roster | `src/data/characters.ts` |
| Enemy stats | `src/data/enemies.ts` |
| Wave placement | `src/data/encounters.ts` |
| Fork paths | `src/data/branches.ts` |
| Décor props | `src/data/scenery.ts` |

---

## Not yet / next

### Phase B — group coordination director (next playable slice)

- `EncounterDirector` + **attack tokens** (`maxSimultaneousAttackers`, `commitCadenceMs` from `DifficultyParams`)
- Feed token availability into `Perception.hasAttackToken`
- Slotting / flanking around the player; cadence between commits
- Debug: token holders, free tokens, slots, cadence timer

### Later

- Mini-bosses / bosses (reuse utility + executor + arena lock)
- Real kits for Tin-Man / Lion / Scarecrow
- Mixamo/FBX animation pipeline polish, VFX
- Settings UI sliders → `DifficultyParams` (`custom` slot ready)
- Ultimate charge earned from dealing/taking damage (seam exists; CD auto-refill is temporary)
- Wire remaining `models/` + `photos/` for non-Dorothy characters through Preload

---

## Definition of done (current greybox)

- [x] Floor-plane travel + Munchkinland → Game flow from a relative-path build
- [x] Dorothy passive + light + heavy + ultimate work together
- [x] Live AI monkeys / Wheelers react to player state (not dumb loops)
- [x] Difficulty changes **behavior** more than sponge HP/damage
- [x] Triggered waves + arena lock clear/unlock
- [x] F3 AI + sprite scale/feet ground-truth readout
- [x] Dorothy NEW sprites: shared scale, feet pivot, in-place jump (height from `z`)
- [ ] Phase B director / tokens
- [ ] Art pipeline / kits for other characters

---

## Playtest checklist (Phase A)

1. Character Select → set difficulty (↑↓) → Dorothy → Munchkinland → pick a fork.
2. On the road: **J** combo · **L** bolt · **U** ultimate vs spawns.
3. Confirm monkeys keep standoff when heavy is ready; dive when you’re committed and heavy is down.
4. Confirm Wheelers circle then charge; arena at ~1100 locks until clear, then unlocks.
5. **F3** — intents/scores/difficulty/encounter; stand idle to capture ref, then walk/run/jump and check **Δheight / Δfeet** (~0 at standing frames).
6. Jump: clean rise/fall on `z` (no squat / double-lift); clip plays at 1.5×.
7. Soften/harden difficulty and confirm reaction / telegraph / punish feel changes more than HP.
