import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';
import { StateMachine } from '../core/StateMachine';
import type { EntityDef } from '../data/entities';
import type { Input, MoveVector } from '../platform/Input';

export type PlayerState = 'idle' | 'walk' | 'run' | 'hop';

/**
 * Greybox player: floor-plane movement, feet box, z-hop, L/R facing only.
 * Arcade body stays in floor space; visual is projected each frame.
 */
export class Player {
  readonly feet: Phaser.Physics.Arcade.Image;
  readonly bodySprite: Phaser.GameObjects.Image;
  readonly fsm: StateMachine;

  floorX: number;
  floorY: number;
  z = 0;
  private zVel = 0;
  private facing: 1 | -1 = 1;
  private readonly stats: EntityDef['stats'];
  private readonly depthFar: number;
  private readonly depthNear: number;
  private readonly worldWidth: number;

  constructor(
    scene: Phaser.Scene,
    def: EntityDef,
    spawn: { floorX: number; floorY: number },
    bounds: { depthFar: number; depthNear: number; worldWidth: number },
  ) {
    this.stats = def.stats;
    this.depthFar = bounds.depthFar;
    this.depthNear = bounds.depthNear;
    this.worldWidth = bounds.worldWidth;
    this.floorX = spawn.floorX;
    this.floorY = spawn.floorY;

    const screen = Projection.toScreen(this.floorX, this.floorY, 0);

    this.feet = scene.physics.add.image(this.floorX, this.floorY, 'player-feet');
    this.feet.setCollideWorldBounds(true);
    this.feet.body!.setSize(tuning.feetWidth, tuning.feetHeight);
    this.feet.setVisible(false);
    this.feet.setImmovable(false);

    this.bodySprite = scene.add.image(screen.x, screen.y, 'player-body');
    this.bodySprite.setOrigin(0.5, 1);

    this.fsm = new StateMachine();
    this.fsm
      .add('idle', {
        enter: () => {
          this.zVel = 0;
        },
      })
      .add('walk', {})
      .add('run', {})
      .add('hop', {
        enter: () => {
          this.zVel = this.stats.hopImpulse;
          this.feet.setVelocity(0, 0);
        },
        update: (dt) => this.updateHop(dt),
      });
    this.fsm.set('idle');
    this.syncVisual();
  }

  update(input: Input, _dt: number): void {
    const move = input.getMoveVector();
    const running = input.isDown('run');
    const state = this.fsm.current as PlayerState | null;

    if (state === 'hop') {
      this.fsm.update(_dt);
      this.syncFromFeet();
      this.syncVisual();
      return;
    }

    if (input.justDown('hop') && this.z <= 0) {
      this.fsm.set('hop');
      this.syncVisual();
      return;
    }

    const moving = move.x !== 0 || move.y !== 0;
    this.applyMove(move, running && moving);

    if (!moving) {
      this.fsm.set('idle');
    } else if (running) {
      this.fsm.set('run');
    } else {
      this.fsm.set('walk');
    }

    this.fsm.update(_dt);
    this.syncFromFeet();
    this.clampFloor();
    this.syncVisual();
  }

  private applyMove(move: MoveVector, running: boolean): void {
    const speed = running ? this.stats.runSpeed : this.stats.moveSpeed;
    this.feet.setVelocity(move.x * speed, move.y * speed);

    if (move.x < -0.01) this.facing = -1;
    else if (move.x > 0.01) this.facing = 1;
  }

  private updateHop(dt: number): void {
    const sec = dt / 1000;
    this.zVel -= this.stats.zGravity * sec;
    this.z += this.zVel * sec;
    if (this.z <= 0) {
      this.z = 0;
      this.zVel = 0;
      this.fsm.set('idle');
    }
  }

  private syncFromFeet(): void {
    this.floorX = this.feet.x;
    this.floorY = this.feet.y;
  }

  private clampFloor(): void {
    this.floorX = Phaser.Math.Clamp(this.floorX, tuning.feetWidth, this.worldWidth - tuning.feetWidth);
    this.floorY = Phaser.Math.Clamp(this.floorY, this.depthFar, this.depthNear);
    this.feet.setPosition(this.floorX, this.floorY);
  }

  private syncVisual(): void {
    const screen = Projection.toScreen(this.floorX, this.floorY, this.z);
    this.bodySprite.setPosition(screen.x, screen.y);
    this.bodySprite.setFlipX(this.facing < 0);
    applyDepth(this.bodySprite, this.floorY);
  }

  /** Projected follow point for the camera. */
  getFollowPoint(): { x: number; y: number } {
    return Projection.toScreen(this.floorX, this.floorY, this.z);
  }

  destroy(): void {
    this.feet.destroy();
    this.bodySprite.destroy();
  }
}
