import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import type { EntityDef } from '../data/entities';
import { StateMachine } from '../core/StateMachine';
import type { Input, MoveVector } from '../platform/Input';
import { Projection } from '../core/Projection';
import { Health } from '../combat/Health';
import {
  resolveAttack,
  clampFloorY,
  type AttackDef,
  type Damageable,
} from '../combat/Attack';
import type { CombatController } from '../combat/CombatController';
import { flashFill } from '../combat/CombatFeel';
import {
  DOROTHY_DEFAULT_WALK_DIR,
  DOROTHY_IDLE_FRAME,
  applyDorothyAnimTimeScale,
  applyDorothyFeetOrigin,
  dorothyAnimExists,
  dorothyIdleAnimKey,
  dorothyIdleAtlasKey,
  dorothyIdleFacing,
  dorothyIdleRealignDir,
  dorothyIdleShouldMirror,
  dorothyIdleSideFromDir,
  dorothyJumpAnimKey,
  dorothyJumpShouldMirror,
  dorothyRunAnimKey,
  dorothySpritesReady,
  dorothyWalkAnimKey,
  dorothyWalkDirFromMove,
  dorothyBaseScale,
  playDorothyAnim,
  playDorothyJumpAnim,
  type DorothyWalkDir,
} from './dorothySprites';
export type PlayerState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'fall'
  | 'lightAttack'
  | 'heavyAttack'
  | 'ultimate';

/**
 * Free ground traveler on the perspective floor plane (floorX / floorY / z).
 * Always scrollFactor 1 — gameplay plane; décor uses depth-track scrollFactors.
 */
export class Player implements Damageable {
  readonly characterId: string;
  readonly body: Phaser.GameObjects.Rectangle;
  /** Dorothy sprite when atlases loaded; otherwise null (greybox body). */
  readonly visual: Phaser.GameObjects.Sprite | null;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly fsm: StateMachine;
  readonly health: Health;

  floorX: number;
  floorY: number;
  z = 0;
  zVel = 0;

  combat: CombatController | null = null;

  private facingDir: 1 | -1 = 1;
  private walkDir: DorothyWalkDir = DOROTHY_DEFAULT_WALK_DIR;
  private idleMirror = false;
  private jumpMirror = false;
  private jumpDir: DorothyWalkDir = DOROTHY_DEFAULT_WALK_DIR;
  private readonly stats: EntityDef['stats'];
  private xMin: number;
  private xMax: number;
  private scriptedMove: MoveVector | null = null;
  private readonly scene: Phaser.Scene;

  private attackDef: AttackDef | null = null;
  private attackElapsedMs = 0;
  private attackHitSet = new Set<Damageable>();
  private attackOnComplete: (() => void) | null = null;
  private comboIndexDuringAttack = 0;
  private lockElapsedMs = 0;
  private lockDurationMs = 0;
  private attackRecoveryMs = 0;
  private knockVelX = 0;
  private knockVelY = 0;
  private baseFill: number;

  /** Takeoff snapshot for jump-scale drift proof (visual debug only). */
  private jumpScaleTakeoff: number | null = null;
  private jumpFloorYTakeoff: number | null = null;
  private lastWarnedJumpScaleLeak = false;

  constructor(
    scene: Phaser.Scene,
    def: EntityDef,
    spawn: { floorX: number; floorY: number },
    bounds: { xMin: number; xMax: number },
    characterId: string,
  ) {
    this.scene = scene;
    this.characterId = characterId;
    this.stats = def.stats;
    this.floorX = spawn.floorX;
    this.floorY = Phaser.Math.Clamp(spawn.floorY, tuning.depthFar, tuning.depthNear);
    this.xMin = bounds.xMin;
    this.xMax = bounds.xMax;
    this.baseFill = tuning.colors.player;

    this.health = new Health(tuning.playerMaxHP, {
      onDamage: () => this.onHitFeel(0),
      onDeath: () => {
        /* GameScene watches isDead */
      },
    });

    this.shadow = scene.add.ellipse(0, 0, 40, 14, tuning.colors.shadow, 0.35);
    this.shadow.setScrollFactor(1);
    this.body = scene.add.rectangle(
      0,
      0,
      tuning.playerBodyWidth,
      tuning.playerBodyHeight,
      this.baseFill,
    );
    this.body.setScrollFactor(1);
    this.body.setOrigin(0.5, 1);
    this.shadow.setOrigin(0.5, 0.5);

    const useSprites = characterId === 'dorothy' && dorothySpritesReady(scene);
    if (useSprites) {
      const atlas = dorothyIdleAtlasKey('e');
      this.visual = scene.add.sprite(0, 0, atlas, DOROTHY_IDLE_FRAME);
      this.visual.setScrollFactor(1);
      applyDorothyFeetOrigin(this.visual);
      applyDorothyAnimTimeScale(this.visual);
      this.body.setVisible(false);
    } else {
      this.visual = null;
    }

    this.fsm = new StateMachine();
    this.fsm
      .add('idle', {})
      .add('walk', {})
      .add('run', {})
      .add('jump', {
        enter: () => {
          this.zVel = this.stats.jumpVelocityZ;
          this.jumpDir = this.walkDir;
          this.jumpMirror = dorothyJumpShouldMirror(this.jumpDir);
          // Capture scale at takeoff for leak proof (warn only if floorY stays fixed).
          this.jumpScaleTakeoff = this.entityVisualScale;
          this.jumpFloorYTakeoff = this.floorY;
          this.lastWarnedJumpScaleLeak = false;
        },
      })
      .add('fall', {})
      .add('lightAttack', {})
      .add('heavyAttack', {})
      .add('ultimate', {})
      .set('idle');

    this.syncVisual();
    this.syncLocomotionAnim();
  }

  get facing(): 1 | -1 {
    return this.facingDir;
  }

  /** Along-road X (east). */
  get x(): number {
    return this.floorX;
  }

  get depth01(): number {
    return Projection.floorYToDepth01(this.floorY);
  }

  get comboIndex(): number {
    return this.combat?.comboIndex ?? 0;
  }

  get lastHitDamage(): number {
    return this.combat?.lastHitDamage ?? 0;
  }

  get heavyCooldownRemainMs(): number {
    return this.combat?.heavyCooldownRemainMs ?? 0;
  }

  get ultimateCooldownRemainMs(): number {
    return this.combat?.ultimateCooldownRemainMs ?? 0;
  }

  get ultimateCharge(): number {
    return this.combat?.ultimateCharge ?? 0;
  }

  get ultimateTargetsAcquired(): number {
    return this.combat?.ultimateTargetsAcquired ?? 0;
  }

  get comboMarkersLit(): number {
    return this.combat?.comboMarkersLit ?? 0;
  }

  get comboWindowActive(): boolean {
    return this.combat?.comboWindowActive ?? false;
  }

  get comboWindowTarget(): 2 | 3 | null {
    return this.combat?.comboWindowTarget ?? null;
  }

  get lastUltimateChargeAdded(): number {
    return this.combat?.lastUltimateChargeAdded ?? 0;
  }

  /** Brief window after an attack ends — AI punish cue. */
  get isInAttackRecovery(): boolean {
    return this.attackRecoveryMs > 0;
  }

  setScriptedMove(move: MoveVector | null): void {
    this.scriptedMove = move;
  }

  get state(): PlayerState {
    return (this.fsm.current as PlayerState | null) ?? 'idle';
  }

  /**
   * On-screen entity scale — pure function of floorY (never z / screen-Y).
   * Identical grounded and airborne at the same depth.
   */
  get entityVisualScale(): number {
    return (
      dorothyBaseScale() *
      Projection.entityDepthScale(this.floorY, tuning.playerDepthScaleStrength)
    );
  }

  /** |current − takeoff| scale while airborne; 0 when grounded / no takeoff. */
  get jumpScaleDrift(): number {
    if (this.jumpScaleTakeoff === null) return 0;
    return Math.abs(this.entityVisualScale - this.jumpScaleTakeoff);
  }

  get jumpFloorYDrift(): number {
    if (this.jumpFloorYTakeoff === null) return 0;
    return Math.abs(this.floorY - this.jumpFloorYTakeoff);
  }

  canStartAttack(): boolean {
    if (this.health.isDead) return false;
    const s = this.state;
    return s === 'idle' || s === 'walk' || s === 'run';
  }

  startLightAttack(def: AttackDef, comboIndex: number, onComplete: () => void): void {
    this.attackDef = def;
    this.attackElapsedMs = 0;
    this.attackHitSet.clear();
    this.attackOnComplete = onComplete;
    this.comboIndexDuringAttack = comboIndex;
    this.fsm.set('lightAttack');
  }

  /** Brief FSM lock for heavy / ultimate (movement & other attacks blocked). */
  startCombatLock(state: 'heavyAttack' | 'ultimate', durationMs: number): void {
    this.lockElapsedMs = 0;
    this.lockDurationMs = durationMs;
    this.fsm.set(state);
  }

  tickCombatLock(dtMs: number): void {
    if (this.state !== 'heavyAttack' && this.state !== 'ultimate') return;
    this.lockElapsedMs += dtMs;
    if (this.lockElapsedMs >= this.lockDurationMs) {
      this.endCombatLock();
    }
  }

  endCombatLock(): void {
    if (this.state === 'heavyAttack' || this.state === 'ultimate') {
      this.attackRecoveryMs = 320;
      this.fsm.set('idle');
    }
    this.lockElapsedMs = 0;
    this.lockDurationMs = 0;
  }

  tickLightAttack(
    dtMs: number,
    targets: readonly Damageable[],
    onHit: (damage: number, floorX: number, floorY: number) => void,
  ): void {
    if (!this.attackDef) return;

    this.attackElapsedMs += dtMs;
    const def = this.attackDef;

    if (
      this.attackElapsedMs >= def.activeStartMs &&
      this.attackElapsedMs <= def.activeEndMs
    ) {
      const hits = resolveAttack(
        def,
        { floorX: this.floorX, floorY: this.floorY, facing: this.facingDir },
        targets,
        this.attackHitSet,
        { kind: 'player-light', id: def.id },
      );
      for (const h of hits) {
        onHit(h.damage, h.target.floorX, h.target.floorY);
      }
    }

    if (this.attackElapsedMs >= def.durationMs) {
      this.attackOnComplete?.();
      this.attackDef = null;
      this.attackOnComplete = null;
      this.attackRecoveryMs = 280;
      this.fsm.set('idle');
    }

    void this.comboIndexDuringAttack;
  }

  applyKnockback(dx: number, dy: number): void {
    this.knockVelX += dx;
    this.knockVelY += dy;
  }

  onHitFeel(_damage: number): void {
    flashFill(this.scene, this.body, this.baseFill);
  }

  /**
   * Full player tick. When attacking, movement is locked (except knockback decay).
   * Combat controller runs before movement so lightAttack can claim the frame.
   */
  update(input: Input, dtMs: number, targets: readonly Damageable[] = []): void {
    if (this.health.isDead) {
      this.syncVisual();
      return;
    }

    if (this.attackRecoveryMs > 0) {
      this.attackRecoveryMs = Math.max(0, this.attackRecoveryMs - dtMs);
    }

    this.combat?.tickPassive?.(this, dtMs);
    this.combat?.update(this, input, dtMs, targets);

    const dt = dtMs / 1000;
    const attacking =
      this.state === 'lightAttack' ||
      this.state === 'heavyAttack' ||
      this.state === 'ultimate';

    // Knockback impulse decay in floor space.
    if (Math.abs(this.knockVelX) > 0.5 || Math.abs(this.knockVelY) > 0.5) {
      this.floorX += this.knockVelX * dt;
      this.floorY = clampFloorY(this.floorY + this.knockVelY * dt);
      this.knockVelX *= Math.max(0, 1 - 8 * dt);
      this.knockVelY *= Math.max(0, 1 - 8 * dt);
    } else {
      this.knockVelX = 0;
      this.knockVelY = 0;
    }

    if (!attacking) {
      const move = this.scriptedMove ?? input.getMoveVector();
      const wantRun = this.scriptedMove ? false : input.isDown('run');
      const onGround = this.z <= 0 && this.zVel <= 0;

      if (!this.scriptedMove && onGround && input.justDown('jump')) {
        this.fsm.set('jump');
      }

      const airborne = this.state === 'jump' || this.state === 'fall' || this.z > 0;
      const mul = (move.x !== 0 || move.y !== 0) && wantRun ? this.stats.runSpeedMul : 1;

      // Full air travel (including N/S depth). Scale stays f(floorY) only — if
      // depth changes mid-jump, size may change with perspective (correct).
      this.floorX += move.x * this.stats.moveSpeedX * mul * dt;
      this.floorY += move.y * this.stats.moveSpeedY * mul * dt;

      if (move.x < -0.01) this.facingDir = -1;
      else if (move.x > 0.01) this.facingDir = 1;

      if (move.x !== 0 || move.y !== 0) {
        this.walkDir = dorothyWalkDirFromMove(move.x, move.y);
      }

      if (airborne) {
        this.zVel -= this.stats.gravityZ * dt;
        this.z += this.zVel * dt;
        if (this.z <= 0) {
          this.z = 0;
          this.zVel = 0;
          this.jumpScaleTakeoff = null;
          this.jumpFloorYTakeoff = null;
        } else {
          this.assertJumpScaleInvariant();
        }
      }

      this.updateFsm(move, wantRun);
      this.fsm.update(dtMs);
    } else {
      // Still apply gravity if somehow airborne into attack.
      if (this.z > 0) {
        this.zVel -= this.stats.gravityZ * dt;
        this.z += this.zVel * dt;
        if (this.z <= 0) {
          this.z = 0;
          this.zVel = 0;
          this.jumpScaleTakeoff = null;
          this.jumpFloorYTakeoff = null;
        } else {
          this.assertJumpScaleInvariant();
        }
      }
      this.fsm.update(dtMs);
    }

    this.floorX = Phaser.Math.Clamp(this.floorX, this.xMin, this.xMax);
    this.floorY = clampFloorY(this.floorY);
    this.syncLocomotionAnim();
    this.syncVisual();
  }

  private updateFsm(move: MoveVector, wantRun: boolean): void {
    if (
      this.state === 'lightAttack' ||
      this.state === 'heavyAttack' ||
      this.state === 'ultimate'
    ) {
      return;
    }
    if (this.z > 0) {
      if (this.zVel > 0) this.fsm.set('jump');
      else this.fsm.set('fall');
      return;
    }
    if (move.x === 0 && move.y === 0) this.fsm.set('idle');
    else if (wantRun) this.fsm.set('run');
    else this.fsm.set('walk');
  }

  /**
   * Visual only. Scale is a pure function of floorY; z only moves screen Y.
   * Order is mandatory: (1) scale from floorY (2) position with groundY − z.
   */
  syncVisual(): void {
    // 1) Scale from floorY alone — never read z or screen-Y here.
    const entityScale = Projection.entityDepthScale(
      this.floorY,
      tuning.playerDepthScaleStrength,
    );
    const visualScale = dorothyBaseScale() * entityScale;

    // 2) Position — z enters only as vertical offset from ground contact.
    const groundY = Projection.groundScreenY(this.floorY);
    const screenX = Projection.toScreen(this.floorX, this.floorY, 0).x;
    const screenY = groundY - this.z;
    const groundX = screenX;

    this.body.setScale((this.facingDir < 0 ? -1 : 1) * entityScale, entityScale);
    this.body.setPosition(screenX, screenY);
    applyDepth(this.body, this.floorY, 1);

    if (this.visual) {
      const airborne = this.state === 'jump' || this.state === 'fall';
      const flip =
        (this.state === 'idle' && this.idleMirror) ||
        (airborne && this.jumpMirror)
          ? -1
          : 1;
      // Exactly one scale assignment for the character sprite.
      this.visual.setScale(flip * visualScale, visualScale);
      // Nudge toward camera so soles sit on the shadow (walk/run read behind it otherwise).
      const towardCam = tuning.playerSpriteTowardCameraPx * entityScale;
      this.visual.setPosition(screenX, screenY + towardCam);
      applyDorothyFeetOrigin(this.visual);
      applyDepth(this.visual, this.floorY, 1);
      this.visual.setVisible(this.shadow.visible);
    }

    this.shadow.setPosition(groundX, groundY);
    const t = Phaser.Math.Clamp(this.z / tuning.shadowMaxZ, 0, 1);
    const shadowMul = Phaser.Math.Linear(
      tuning.shadowScaleGround,
      tuning.shadowScaleAir,
      t,
    );
    this.shadow.setScale(entityScale * shadowMul);
    applyDepth(this.shadow, this.floorY, 0);
  }

  /** Dev guard: scale must not change while floorY is constant mid-jump. */
  private assertJumpScaleInvariant(): void {
    if (this.jumpScaleTakeoff === null || this.jumpFloorYTakeoff === null) return;
    const floorDrift = Math.abs(this.floorY - this.jumpFloorYTakeoff);
    const scaleDrift = Math.abs(this.entityVisualScale - this.jumpScaleTakeoff);
    if (floorDrift < 0.01 && scaleDrift > 0.0005 && !this.lastWarnedJumpScaleLeak) {
      this.lastWarnedJumpScaleLeak = true;
      console.warn(
        `[Player] jump scale leak: scale drifted ${scaleDrift.toFixed(4)} while floorY constant (${this.floorY.toFixed(1)}) z=${this.z.toFixed(1)}`,
      );
    }
  }

  /** Idle / walk(8) / run / jump when packs exist. */
  private syncLocomotionAnim(): void {
    const sprite = this.visual;
    if (!sprite) return;

    const attacking =
      this.state === 'lightAttack' ||
      this.state === 'heavyAttack' ||
      this.state === 'ultimate';
    if (attacking) return;

    const airborne = this.state === 'jump' || this.state === 'fall' || this.z > 0;
    if (airborne) {
      const jumpKey = dorothyJumpAnimKey(this.jumpDir);
      if (dorothyAnimExists(this.scene, jumpKey)) {
        if (sprite.anims.currentAnim?.key !== jumpKey) {
          playDorothyJumpAnim(sprite, jumpKey);
        }
        return;
      }
      // Jump pack missing — hold idle pose in the air.
      const airIdle = dorothyIdleSideFromDir(this.jumpDir);
      this.idleMirror = dorothyIdleShouldMirror(this.jumpDir);
      const idleKey = dorothyIdleAnimKey(airIdle);
      if (dorothyAnimExists(this.scene, idleKey) && sprite.anims.currentAnim?.key !== idleKey) {
        playDorothyAnim(sprite, idleKey, true);
      }
      return;
    }

    if (this.state === 'idle' || (this.state !== 'walk' && this.state !== 'run')) {
      const idleSide = dorothyIdleSideFromDir(this.walkDir);
      // Realign facing to the idle pack (East → right, West → left).
      this.walkDir = dorothyIdleRealignDir(idleSide);
      this.facingDir = dorothyIdleFacing(idleSide);
      this.idleMirror = dorothyIdleShouldMirror(this.walkDir);
      const idleKey = dorothyIdleAnimKey(idleSide);
      const idleFallback = dorothyIdleAnimKey('e');
      const key = dorothyAnimExists(this.scene, idleKey)
        ? idleKey
        : dorothyAnimExists(this.scene, idleFallback)
          ? idleFallback
          : null;
      if (key && sprite.anims.currentAnim?.key !== key) {
        playDorothyAnim(sprite, key, true);
      }
      return;
    }

    if (this.state === 'run') {
      const runKey = dorothyRunAnimKey(this.walkDir);
      if (dorothyAnimExists(this.scene, runKey)) {
        if (sprite.anims.currentAnim?.key !== runKey) playDorothyAnim(sprite, runKey, true);
        return;
      }
    }

    const walkKey = dorothyWalkAnimKey(this.walkDir);
    if (dorothyAnimExists(this.scene, walkKey)) {
      if (sprite.anims.currentAnim?.key !== walkKey) playDorothyAnim(sprite, walkKey, true);
      return;
    }

    const fallback = dorothyWalkAnimKey(DOROTHY_DEFAULT_WALK_DIR);
    if (dorothyAnimExists(this.scene, fallback) && sprite.anims.currentAnim?.key !== fallback) {
      playDorothyAnim(sprite, fallback, true);
    }
  }

  destroy(): void {
    this.visual?.destroy();
    this.body.destroy();
    this.shadow.destroy();
  }

  setHeld(held: boolean): void {
    this.body.setVisible(!held && !this.visual);
    this.visual?.setVisible(!held);
    this.shadow.setVisible(!held);
    if (!held) this.syncVisual();
  }
}
