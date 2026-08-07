import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getServices } from '../core/Registry';
import { buildFacadeGate } from '../render/FacadeGate';

/**
 * Title / gate of Munchkinland splash (keeps previous 'Menu' scene key).
 * Facade pose: head-on gate; road not yet revealed.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const { input } = getServices(this);
    input.bind(this);
    input.setEnabled(true);

    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(tuning.colors.background);

    const facade = this.add.container(width / 2, height * 0.42);
    buildFacadeGate(this, facade);

    this.add
      .text(width / 2, height * 0.14, 'OZ', {
        fontFamily: 'Georgia, serif',
        fontSize: '56px',
        color: '#e8d5a3',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.72, 'Press START', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#c4c4d0',
      })
      .setOrigin(0.5);
  }

  update(): void {
    const { input, lifecycle } = getServices(this);
    if (input.justDown('confirm') || input.justDown('start')) {
      lifecycle.unlockAudio(this.game);
      this.scene.start('CharacterSelect');
    }
  }
}
