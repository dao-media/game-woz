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
  DOROTHY_WALK_IDLE_FRAME,
  applyDorothyAnimTimeScale,
  applyDorothyFeetOrigin,
  dorothyAnimExists,
  dorothyIdleAnimKey,
  dorothyIdleShouldMirror,
  dorothyJumpAnimKey,
  dorothyJumpShouldMirror,
  dorothyRunAnimKey,
  dorothySpritesReady,
  dorothyWalkAnimKey,
  dorothyWalkAtlasKey,
  dorothyWalkDirFromMove,
  dorothyWorldScale,
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
      const atlas = dorothyWalkAtlasKey(DOROTHY_DEFAULT_WALK_DIR);
      this.visual = scene.add.sprite(0, 0, atlas, DOROTHY_WALK_IDLE_FRAME);
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

      const mul = (move.x !== 0 || move.y !== 0) && wantRun ? this.stats.runSpeedMul : 1;
      this.floorX += move.x * this.stats.moveSpeedX * mul * dt;
      this.floorY += move.y * this.stats.moveSpeedY * mul * dt;

      if (move.x < -0.01) this.facingDir = -1;
      else if (move.x > 0.01) this.facingDir = 1;

      if (move.x !== 0 || move.y !== 0) {
        this.walkDir = dorothyWalkDirFromMove(move.x, move.y);
      }

      const airborne = this.state === 'jump' || this.state === 'fall' || this.z > 0;
      if (airborne) {
        this.zVel -= this.stats.gravityZ * dt;
        this.z += this.zVel * dt;
        if (this.z <= 0) {
          this.z = 0;
          this.zVel = 0;
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

  syncVisual(): void {
    const screen = Projection.toScreen(this.floorX, this.floorY, this.z);
    const ground = Projection.toScreen(this.floorX, this.floorY, 0);
    const scale = Projection.depthScale(this.floorY);

    this.body.setPosition(screen.x, screen.y);
    this.body.setScale((this.facingDir < 0 ? -1 : 1) * scale, scale);
    applyDepth(this.body, this.floorY, 1);

    if (this.visual) {
      const atlasKey = this.visual.texture.key;
      const vs = dorothyWorldScale(atlasKey) * scale;
      const airborne = this.state === 'jump' || this.state === 'fall';
      const flip =
        (this.state === 'idle' && this.idleMirror) ||
        (airborne && this.jumpMirror)
          ? -1
          : 1;
      this.visual.setPosition(screen.x, screen.y);
      this.visual.setScale(flip * vs, vs);
      applyDorothyFeetOrigin(this.visual);
      applyDepth(this.visual, this.floorY, 1);
      this.visual.setVisible(this.shadow.visible);
    }

    this.shadow.setPosition(ground.x, ground.y);
    const t = Phaser.Math.Clamp(this.z / tuning.shadowMaxZ, 0, 1);
    const shadowMul = Phaser.Math.Linear(
      tuning.shadowScaleGround,
      tuning.shadowScaleAir,
      t,
    );
    this.shadow.setScale(scale * shadowMul);
    applyDepth(this.shadow, this.floorY, 0);
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
      this.idleMirror = dorothyIdleShouldMirror(this.walkDir);
      const idleKey = dorothyIdleAnimKey(this.walkDir);
      if (dorothyAnimExists(this.scene, idleKey) && sprite.anims.currentAnim?.key !== idleKey) {
        playDorothyAnim(sprite, idleKey, true);
      }
      return;
    }

    if (this.state === 'idle' || (this.state !== 'walk' && this.state !== 'run')) {
      this.idleMirror = dorothyIdleShouldMirror(this.walkDir);
      const idleKey = dorothyIdleAnimKey(this.walkDir);
      const idleFallback = dorothyIdleAnimKey(DOROTHY_DEFAULT_WALK_DIR);
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
