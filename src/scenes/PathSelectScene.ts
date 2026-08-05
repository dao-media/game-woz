import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getServices, REGISTRY } from '../core/Registry';
import { DEFAULT_PATH_ID, roadPaths, type RoadPath } from '../data/paths';
import { STORAGE_KEYS } from '../platform/Storage';

/**
 * Choose which path of the Yellow Brick Road to travel.
 * Each path terminates at a different place in Oz.
 */
export class PathSelectScene extends Phaser.Scene {
  private index = 0;
  private labels: Phaser.GameObjects.Text[] = [];
  private detail!: Phaser.GameObjects.Text;

  constructor() {
    super('PathSelect');
  }

  create(): void {
    const { input, storage } = getServices(this);
    input.bind(this);

    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(tuning.colors.background);

    this.add
      .text(width / 2, 48, 'Choose your path', {
        fontFamily: 'Georgia, serif',
        fontSize: '32px',
        color: '#e8d5a3',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 88, 'Each road ends somewhere different in Oz', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888898',
      })
      .setOrigin(0.5);

    void this.restoreLastPath(storage);

    this.labels = roadPaths.map((path, i) => {
      const y = 150 + i * 44;
      return this.add
        .text(width / 2, y, path.name, {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#c4c4d0',
        })
        .setOrigin(0.5);
    });

    this.detail = this.add
      .text(width / 2, height - 100, '', {
        fontFamily: 'Georgia, serif',
        fontSize: '16px',
        color: '#a89878',
        align: 'center',
        wordWrap: { width: width * 0.7 },
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height - 40, '↑↓ Select   ENTER Confirm   ESC Back', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#666674',
      })
      .setOrigin(0.5);

    this.refresh();
  }

  private async restoreLastPath(storage: { get: (k: string) => Promise<string | null> }): Promise<void> {
    const saved = await storage.get(STORAGE_KEYS.lastPathId);
    const id = saved ?? DEFAULT_PATH_ID;
    const idx = roadPaths.findIndex((p) => p.id === id);
    if (idx >= 0) {
      this.index = idx;
      this.refresh();
    }
  }

  update(): void {
    const { input } = getServices(this);

    if (input.justDown('menuUp') || input.justDown('moveUp')) {
      this.index = (this.index - 1 + roadPaths.length) % roadPaths.length;
      this.refresh();
    }
    if (input.justDown('menuDown') || input.justDown('moveDown')) {
      this.index = (this.index + 1) % roadPaths.length;
      this.refresh();
    }
    if (input.justDown('confirm') || input.justDown('start')) {
      void this.confirm();
    }
    if (input.justDown('back')) {
      this.scene.start('Menu');
    }
  }

  private refresh(): void {
    this.labels.forEach((label, i) => {
      const selected = i === this.index;
      label.setColor(selected ? '#f0e6c8' : '#7a7a88');
      label.setText(`${selected ? '▸ ' : '  '}${roadPaths[i]!.name}`);
    });
    const path = roadPaths[this.index]!;
    this.detail.setText(`${path.blurb}\nTerminates at ${path.destination}.`);
  }

  private async confirm(): Promise<void> {
    const path: RoadPath = roadPaths[this.index]!;
    const { storage } = getServices(this);
    await storage.set(STORAGE_KEYS.lastPathId, path.id);
    this.registry.set(REGISTRY.selectedPath, path);
    this.scene.start('Game');
  }
}
