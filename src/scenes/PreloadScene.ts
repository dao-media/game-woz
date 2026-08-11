import Phaser from 'phaser';
import {
  ensureDorothyAnims,
  preloadDorothySprites,
} from '../entities/dorothySprites';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    // Don't let a single missing PNG freeze boot forever.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[preload] skip failed asset: ${file.key} (${file.url})`);
    });

    const bar = this.add.graphics();
    const { width, height } = this.cameras.main;
    this.add
      .text(width / 2, height / 2 - 28, 'Loading Dorothy…', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#c4c4d0',
      })
      .setOrigin(0.5);

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      bar.clear();
      bar.fillStyle(0x3a3a48, 1);
      bar.fillRect(width / 2 - 120, height / 2, 240, 8);
      bar.fillStyle(0xe8d5a3, 1);
      bar.fillRect(width / 2 - 120, height / 2, 240 * value, 8);
    });

    preloadDorothySprites(this);
  }

  create(): void {
    ensureDorothyAnims(this);
    this.scene.start('Menu');
  }
}
