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
| **Preload** | Placeholder load (greybox — no FBX/atlas yet) |
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
| Debug overlay | F3 / \` |
| Debug spawn enemy | **]** (`CLOSED_BRACKET`) — toggles Wheeler / Winged Monkey |
| Character select | ← → character · ↑ ↓ difficulty · Enter confirm · Esc back |

Bindings live in `src/config/keybindings.ts`. Unknown Phaser key names are **skipped with a warning** (do not crash boot).

---

## Stage model

- **One-point perspective** — `src/core/Projection.ts`: `floorX` / `floorY` / `z` → screen; `depthScale` from `perspectiveFarScale`; vanishing X tracks camera mid-X.
- **StageView** — trapezoid floor + vertical back wall; clean horizon seam (`src/render/StageView.ts`).
- **DepthTracks** — décor: `backdrop` (parallax) + `far` / `midFar` / `mid` / `near` (`src/core/DepthTracks.ts`).
- **Player** — free travel on the floor plane (not lane-locked); always `scrollFactor` 1.
- **Direction** — East = +`floorX` = screen-right; Munchkinland gate at west.

**All combat and AI resolve in floor space** (depth-aware). No screen-space hit tests.

---

## Progress report (up to date)

### Status legend

- **Shipped on `main`** — pushed to origin (through Dorothy combat spine commit `40ed63d` and earlier traversal).
- **In working tree** — implemented locally (Phase A AI / encounters / difficulty UI). May still need a commit/push.
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

### 3. Enemies, utility AI, difficulty, encounters — Phase A (in working tree)

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

### 4. Platform / UX hardening — in working tree

- [x] Input: unknown key codes warn + skip (fixes black screen from invalid `BRACKETRIGHT`; correct key is `CLOSED_BRACKET`)
- [x] Debug overlay: player combat + **per-enemy intent / top scores / executor state** + encounter phase / wave / arena lock / difficulty

### 5. Art assets — on disk, not wired

| Folder | Contents | Wired? |
|--------|----------|--------|
| `models/` | ~35 FBX — Dorothy, Tin-Man, Scarecrow, Cowardly Lion, Toto, Winged Monkey + animations | **No** (not in Preload) |
| `photos/characters/` | ~50 reference photos / PSDs (turnarounds) | **No** |

`createPlayer` / `createEnemy` are the intended drop-in seams for atlases later.

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
    Player.ts  Enemy.ts
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
- Sprites, Mixamo/FBX animation pipeline, VFX polish
- Settings UI sliders → `DifficultyParams` (`custom` slot ready)
- Ultimate charge earned from dealing/taking damage (seam exists; CD auto-refill is temporary)
- Wire `models/` + `photos/` through Preload into `createPlayer` / `createEnemy`

---

## Definition of done (current greybox)

- [x] Floor-plane travel + Munchkinland → Game flow from a relative-path build
- [x] Dorothy passive + light + heavy + ultimate work together
- [x] Live AI monkeys / Wheelers react to player state (not dumb loops)
- [x] Difficulty changes **behavior** more than sponge HP/damage
- [x] Triggered waves + arena lock clear/unlock
- [x] F3 AI readout usable for tuning
- [ ] Phase B director / tokens
- [ ] Commit + push remaining Phase A working-tree files if not yet on `origin/main`
- [ ] Art pipeline / kits for other characters

---

## Playtest checklist (Phase A)

1. Character Select → set difficulty (↑↓) → Dorothy → Munchkinland → pick a fork.
2. On the road: **J** combo · **L** bolt · **U** ultimate vs spawns.
3. Confirm monkeys keep standoff when heavy is ready; dive when you’re committed and heavy is down.
4. Confirm Wheelers circle then charge; arena at ~1100 locks until clear, then unlocks.
5. **F3** — verify intents/scores/difficulty/encounter state.
6. Soften/harden difficulty and confirm reaction / telegraph / punish feel changes more than HP.
