import Phaser from 'phaser';
import { defaultKeybindings } from '../config/keybindings';

export type InputAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'run'
  | 'jump'
  | 'lightAttack'
  | 'heavyAttack'
  | 'ultimate'
  | 'start'
  | 'confirm'
  | 'back'
  | 'menuUp'
  | 'menuDown'
  | 'debug'
  | 'spawnEnemy'
  | 'debugForceUltimate';

/** Ground-plane move vector (world x/y), normalized. */
export type MoveVector = { x: number; y: number };

type ActionState = {
  keys: Phaser.Input.Keyboard.Key[];
  axis: number;
};

const GAMEPLAY_ACTIONS: ReadonlySet<InputAction> = new Set([
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'run',
  'jump',
  'lightAttack',
  'heavyAttack',
  'ultimate',
]);

/**
 * Unified action-set input. Game logic reads actions, never raw keys.
 * When disabled, movement/jump/run report neutral (cutscenes / walk-outs).
 */
export class Input {
  private readonly actions = new Map<InputAction, ActionState>();
  private bound = false;
  private _enabled = true;

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(value: boolean): void {
    this._enabled = value;
  }

  bind(scene: Phaser.Scene, bindings: Record<InputAction, string[]> = defaultKeybindings): void {
    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Input: keyboard plugin unavailable');
    }

    this.actions.clear();
    const captureNames: string[] = [];
    for (const [action, keyNames] of Object.entries(bindings) as [InputAction, string[]][]) {
      const keys: Phaser.Input.Keyboard.Key[] = [];
      for (const name of keyNames) {
        const code = Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes];
        if (typeof code !== 'number') {
          console.warn(`Input: unknown key "${name}" for action "${action}" — skipped`);
          continue;
        }
        // enableCapture=true so browser defaults (Find on F3, etc.) don't steal the key.
        keys.push(keyboard.addKey(code, true));
        captureNames.push(name);
      }
      this.actions.set(action, { keys, axis: 0 });
    }
    if (captureNames.length > 0) {
      keyboard.addCapture(captureNames);
    }
    this.bound = true;
  }

  setAxis(action: InputAction, value: number): void {
    const state = this.actions.get(action);
    if (!state) return;
    state.axis = Phaser.Math.Clamp(value, -1, 1);
  }

  isDown(action: InputAction): boolean {
    if (!this._enabled && GAMEPLAY_ACTIONS.has(action)) return false;
    const state = this.actions.get(action);
    if (!state) return false;
    if (Math.abs(state.axis) > 0.4) return true;
    return state.keys.some((k) => k.isDown);
  }

  justDown(action: InputAction): boolean {
    if (!this._enabled && GAMEPLAY_ACTIONS.has(action)) return false;
    const state = this.actions.get(action);
    if (!state) return false;
    return state.keys.some((k) => Phaser.Input.Keyboard.JustDown(k));
  }

  getMoveVector(): MoveVector {
    if (!this.bound || !this._enabled) return { x: 0, y: 0 };

    let x = 0;
    let y = 0;

    if (this.isDown('moveLeft')) x -= 1;
    if (this.isDown('moveRight')) x += 1;
    if (this.isDown('moveUp')) y -= 1;
    if (this.isDown('moveDown')) y += 1;

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
    return { x: x / len, y: y / len };
  }
}
