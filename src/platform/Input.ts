import Phaser from 'phaser';
import { defaultKeybindings } from '../config/keybindings';

export type InputAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'run'
  | 'hop'
  | 'start'
  | 'confirm'
  | 'back'
  | 'menuUp'
  | 'menuDown';

export type MoveVector = { x: number; y: number };

type ActionState = {
  keys: Phaser.Input.Keyboard.Key[];
  /** Optional external axis contribution (−1…1), for future touch/gamepad. */
  axis: number;
};

/**
 * Unified action-set input. Game logic reads actions, never raw keys.
 * Keyboard now; touch (virtual stick) and gamepad plug into the same axes later.
 */
export class Input {
  private readonly actions = new Map<InputAction, ActionState>();
  private bound = false;

  bind(scene: Phaser.Scene, bindings: Record<InputAction, string[]> = defaultKeybindings): void {
    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Input: keyboard plugin unavailable');
    }

    this.actions.clear();
    for (const [action, keyNames] of Object.entries(bindings) as [InputAction, string[]][]) {
      const keys = keyNames.map((name) => {
        const code = Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes];
        if (typeof code !== 'number') {
          throw new Error(`Input: unknown key "${name}"`);
        }
        return keyboard.addKey(code);
      });
      this.actions.set(action, { keys, axis: 0 });
    }
    this.bound = true;
  }

  /** Inject axis from future virtual joystick / gamepad (−1…1). */
  setAxis(action: InputAction, value: number): void {
    const state = this.actions.get(action);
    if (!state) return;
    state.axis = Phaser.Math.Clamp(value, -1, 1);
  }

  isDown(action: InputAction): boolean {
    const state = this.actions.get(action);
    if (!state) return false;
    if (Math.abs(state.axis) > 0.4) return true;
    return state.keys.some((k) => k.isDown);
  }

  justDown(action: InputAction): boolean {
    const state = this.actions.get(action);
    if (!state) return false;
    return state.keys.some((k) => Phaser.Input.Keyboard.JustDown(k));
  }

  /**
   * 8-directional floor-plane move vector, normalized (or zero).
   * Diagonals stay unit length.
   */
  getMoveVector(): MoveVector {
    if (!this.bound) return { x: 0, y: 0 };

    let x = 0;
    let y = 0;

    if (this.isDown('moveLeft')) x -= 1;
    if (this.isDown('moveRight')) x += 1;
    if (this.isDown('moveUp')) y -= 1;
    if (this.isDown('moveDown')) y += 1;

    // Future stick axes can accumulate here via setAxis on move* actions.
    const left = this.actions.get('moveLeft');
    const right = this.actions.get('moveRight');
    const up = this.actions.get('moveUp');
    const down = this.actions.get('moveDown');
    if (left) x -= left.axis;
    if (right) x += right.axis;
    if (up) y -= up.axis;
    if (down) y += down.axis;

    x = Phaser.Math.Clamp(x, -1, 1);
    y = Phaser.Math.Clamp(y, -1, 1);

    const len = Math.hypot(x, y);
    if (len < 0.01) return { x: 0, y: 0 };
    // Snap near-cardinal stick input to clean 8-way.
    const nx = x / len;
    const ny = y / len;
    return { x: nx, y: ny };
  }
}
