import Phaser from 'phaser';
import { tuning } from '../config/tuning';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    // Local-only load path (no network). Visual stub while textures generate in create.
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, 240, 12, 0x333340);
    this.add
      .rectangle(width / 2 - 118, height / 2, 236, 8, 0xc4a35a)
      .setOrigin(0, 0.5);
  }

  create(): void {
    this.generateTextures();
    this.scene.start('Menu');
  }

  private generateTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    g.fillStyle(tuning.colors.player, 1);
    g.fillRect(0, 0, tuning.playerBodyWidth, tuning.playerBodyHeight);
    g.generateTexture('player-body', tuning.playerBodyWidth, tuning.playerBodyHeight);
    g.clear();

    g.fillStyle(tuning.colors.playerFeet, 1);
    g.fillRect(0, 0, tuning.feetWidth, tuning.feetHeight);
    g.generateTexture('player-feet', tuning.feetWidth, tuning.feetHeight);
    g.clear();

    g.fillStyle(tuning.colors.obstacle, 1);
    g.fillRect(0, 0, tuning.obstacleWidth, tuning.obstacleHeight);
    g.generateTexture('obstacle-body', tuning.obstacleWidth, tuning.obstacleHeight);
    g.clear();

    g.fillStyle(0x445566, 1);
    g.fillRect(0, 0, tuning.feetWidth, tuning.feetHeight);
    g.generateTexture('obstacle-feet', tuning.feetWidth, tuning.feetHeight);
    g.clear();

    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 2, 2);
    g.generateTexture('pixel', 2, 2);
    g.destroy();
  }
}
