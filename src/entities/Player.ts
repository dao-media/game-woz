import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import type { EntityDef } from '../data/entities';
import { StateMachine } from '../core/StateMachine';
import type { Input, MoveVector } from '../platform/Input';
import { Projection } from '../core/Projection';

export type PlayerState = 'idle' | 'walk' | 'run' | 'jump' | 'fall';

/**
 * Free ground traveler on the perspective floor plane (floorX / floorY / z).
 * Always scrollFactor 1 — gameplay plane; décor uses depth-track scrollFactors.
 */
export class Player {
  readonly characterId: string;
  readonly body: Phaser.GameObjects.Rectangle;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly fsm: StateMachine;

  floorX: number;
  floorY: number;
  z = 0;
  zVel = 0;

  private facing: 1 | -1 = 1;
  private readonly stats: EntityDef['stats'];
  private xMin: number;
  private xMax: number;
  private scriptedMove: MoveVector | null = null;

  constructor(
    scene: Phaser.Scene,
    def: EntityDef,
    spawn: { floorX: number; floorY: number },
    bounds: { xMin: number; xMax: number },
    characterId: string,
  ) {
    this.characterId = characterId;
    this.stats = def.stats;
    this.floorX = spawn.floorX;
    this.floorY = Phaser.Math.Clamp(spawn.floorY, tuning.depthFar, tuning.depthNear);
    this.xMin = bounds.xMin;
    this.xMax = bounds.xMax;

    this.shadow = scene.add.ellipse(0, 0, 40, 14, tuning.colors.shadow, 0.35);
    this.shadow.setScrollFactor(1);
    this.body = scene.add.rectangle(
      0,
      0,
      tuning.playerBodyWidth,
      tuning.playerBodyHeight,
      tuning.colors.player,
    );
    this.body.setScrollFactor(1);
    this.body.setOrigin(0.5, 1);
    this.shadow.setOrigin(0.5, 0.5);

    this.fsm = new StateMachine();
    this.fsm
      .add('idle', {})
      .add('walk', {})
      .add('run', {})
      .add('jump', {
        enter: () => {
          this.zVel = this.stats.jumpVelocityZ;
        },
      })
      .add('fall', {})
      .set('idle');

    this.syncVisual();
  }

  /** Along-road X (east). */
  get x(): number {
    return this.floorX;
  }

  get depth01(): number {
    return Projection.floorYToDepth01(this.floorY);
  }

  setScriptedMove(move: MoveVector | null): void {
    this.scriptedMove = move;
  }

  get state(): PlayerState {
    return (this.fsm.current as PlayerState | null) ?? 'idle';
  }

  update(input: Input, dtMs: number): void {
    const dt = dtMs / 1000;
    const move = this.scriptedMove ?? input.getMoveVector();
    const wantRun = this.scriptedMove ? false : input.isDown('run');
    const onGround = this.z <= 0 && this.zVel <= 0;

    if (!this.scriptedMove && onGround && input.justDown('jump')) {
      this.fsm.set('jump');
    }

    const mul = (move.x !== 0 || move.y !== 0) && wantRun ? this.stats.runSpeedMul : 1;
    this.floorX += move.x * this.stats.moveSpeedX * mul * dt;
    this.floorX = Phaser.Math.Clamp(this.floorX, this.xMin, this.xMax);

    // ↑ farther (smaller floorY), ↓ nearer (larger floorY).
    this.floorY += move.y * this.stats.moveSpeedY * mul * dt;
    this.floorY = Phaser.Math.Clamp(this.floorY, tuning.depthFar, tuning.depthNear);

    if (move.x < -0.01) this.facing = -1;
    else if (move.x > 0.01) this.facing = 1;

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
    this.syncVisual();
  }

  private updateFsm(move: MoveVector, wantRun: boolean): void {
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
    this.body.setScale((this.facing < 0 ? -1 : 1) * scale, scale);
    applyDepth(this.body, this.floorY, 1);

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

  destroy(): void {
    this.body.destroy();
    this.shadow.destroy();
  }

  setHeld(held: boolean): void {
    this.body.setVisible(!held);
    this.shadow.setVisible(!held);
    if (!held) this.syncVisual();
  }
}
