import type { InputAction } from '../platform/Input';

/** Default action → Phaser KeyCodes name map. */
export const defaultKeybindings: Record<InputAction, string[]> = {
  moveUp: ['W', 'UP'],
  moveDown: ['S', 'DOWN'],
  moveLeft: ['A', 'LEFT'],
  moveRight: ['D', 'RIGHT'],
  run: ['SHIFT'],
  hop: ['SPACE', 'K'],
  start: ['ENTER', 'SPACE'],
  confirm: ['ENTER', 'SPACE'],
  back: ['ESC', 'BACKSPACE'],
  menuUp: ['W', 'UP'],
  menuDown: ['S', 'DOWN'],
};
