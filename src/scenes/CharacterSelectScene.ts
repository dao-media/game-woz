import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getServices } from '../core/Registry';
import { characters, DEFAULT_CHARACTER_ID, type CharacterId } from '../data/characters';

/** Four greybox class placeholders — keyboard/gamepad navigable. */
export class CharacterSelectScene extends Phaser.Scene {
  private index = 0;
  private labels: Phaser.GameObjects.Text[] = [];
  private boxes: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super('CharacterSelect');
  }

  create(): void {
    const { input, runState } = getServices(this);
    input.bind(this);
    input.setEnabled(true);

    const saved = runState.selectedCharacter;
    const savedIdx = characters.findIndex((c) => c.id === saved);
    this.index = savedIdx >= 0 ? savedIdx : 0;

    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(tuning.colors.background);

    this.add
      .text(width / 2, 48, 'Choose a traveler', {
        fontFamily: 'Georgia, serif',
        fontSize: '28px',
        color: '#e8d5a3',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 84, '(placeholders — classes come later)', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#666674',
      })
      .setOrigin(0.5);

    const slotW = 160;
    const gap = 24;
    const totalW = characters.length * slotW + (characters.length - 1) * gap;
    const startX = width / 2 - totalW / 2 + slotW / 2;
    const slotY = height * 0.48;

    this.boxes = [];
    this.labels = [];
    characters.forEach((c, i) => {
      const x = startX + i * (slotW + gap);
      const box = this.add
        .rectangle(x, slotY, slotW, 120, 0x2a2a32)
        .setStrokeStyle(2, 0x5a5a68);
      const figure = this.add.rectangle(x, slotY + 10, 28, 48, tuning.colors.player);
      void figure;
      const label = this.add
        .text(x, slotY + 70, c.label, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#c4c4d0',
          align: 'center',
          wordWrap: { width: slotW - 12 },
        })
        .setOrigin(0.5, 0);
      this.boxes.push(box);
      this.labels.push(label);
    });

    this.add
      .text(width / 2, height - 48, '← → Select   ENTER Confirm   ESC Back', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#666674',
      })
      .setOrigin(0.5);

    this.refresh();
  }

  update(): void {
    const { input } = getServices(this);

    if (input.justDown('moveLeft')) {
      this.index = (this.index - 1 + characters.length) % characters.length;
      this.refresh();
    }
    if (input.justDown('moveRight')) {
      this.index = (this.index + 1) % characters.length;
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
    this.boxes.forEach((box, i) => {
      const selected = i === this.index;
      box.setStrokeStyle(2, selected ? 0xe8d5a3 : 0x5a5a68);
      box.setFillStyle(selected ? 0x3a3a28 : 0x2a2a32);
      this.labels[i]?.setColor(selected ? '#f0e6c8' : '#888898');
    });
  }

  private async confirm(): Promise<void> {
    const { storage, runState } = getServices(this);
    const id = (characters[this.index]?.id ?? DEFAULT_CHARACTER_ID) as CharacterId;
    await runState.setCharacter(id, storage);
    await runState.clearPath(storage);
    this.scene.start('Munchkinland');
  }
}
