import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getSelectedPath, getServices } from '../core/Registry';

/**
 * End-of-run victory. Destination comes from the selected road path.
 */
export class WinScene extends Phaser.Scene {
  constructor() {
    super('Win');
  }

  create(): void {
    const { input } = getServices(this);
    input.bind(this);

    const path = getSelectedPath(this);
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(tuning.colors.background);

    this.add
      .text(width / 2, height * 0.28, 'You made it', {
        fontFamily: 'Georgia, serif',
        fontSize: '42px',
        color: '#e8d5a3',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.42, `The road ends at ${path.destination}.`, {
        fontFamily: 'Georgia, serif',
        fontSize: '22px',
        color: '#a89878',
        align: 'center',
        wordWrap: { width: width * 0.75 },
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.55, path.name, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#7a7a88',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.72, 'ENTER — choose another path\nESC — title', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#c4c4d0',
        align: 'center',
      })
      .setOrigin(0.5);
  }

  update(): void {
    const { input } = getServices(this);
    if (input.justDown('confirm') || input.justDown('start')) {
      this.scene.start('PathSelect');
    }
    if (input.justDown('back')) {
      this.scene.start('Menu');
    }
  }
}
