import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getServices } from '../core/Registry';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const { input } = getServices(this);
    input.bind(this);

    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(tuning.colors.background);

    this.add
      .text(width / 2, height * 0.32, 'OZ', {
        fontFamily: 'Georgia, serif',
        fontSize: '72px',
        color: '#e8d5a3',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.46, 'Down the Yellow Brick Road', {
        fontFamily: 'Georgia, serif',
        fontSize: '22px',
        color: '#a89878',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.68, 'Press START', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#c4c4d0',
      })
      .setOrigin(0.5);
  }

  update(): void {
    const { input, lifecycle } = getServices(this);
    if (input.justDown('start') || input.justDown('confirm')) {
      lifecycle.unlockAudio(this.game);
      this.scene.start('PathSelect');
    }
  }
}
