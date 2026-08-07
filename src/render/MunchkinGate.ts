import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { applyDepth } from '../core/DepthSort';
import { Projection } from '../core/Projection';

/**
 * Gate planted on one perspective ray (constant floorX).
 * Depth lines in StageView are those same constant-floorX rays — so the gate
 * is aligned to a ground perspective line by construction.
 */
export class MunchkinGate {
  readonly parts: Phaser.GameObjects.GameObject[] = [];
  readonly floorX: number;

  constructor(scene: Phaser.Scene, floorX = tuning.gateFloorX) {
    this.floorX = floorX;
    const openLo = tuning.gateOpeningFloorY - tuning.gateOpeningHalfWidth;
    const openHi = tuning.gateOpeningFloorY + tuning.gateOpeningHalfWidth;

    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const floorY = Phaser.Math.Linear(tuning.depthFar, tuning.depthNear, t);
      if (floorY > openLo && floorY < openHi) continue;

      const depthT = (tuning.depthNear - floorY) / (tuning.depthNear - tuning.depthFar);
      const h = Phaser.Math.Linear(110, 56, 1 - depthT);
      const w = Phaser.Math.Linear(52, 30, 1 - depthT);
      const slab = scene.add.rectangle(0, 0, w, h, tuning.colors.munchkin);
      slab.setOrigin(0.5, 1);
      slab.setScrollFactor(1);
      slab.setData('floorY', floorY);
      slab.setData('kind', 'slab');
      this.parts.push(slab);
    }

    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const floorY = Phaser.Math.Linear(openLo, openHi, t);
      const lintel = scene.add.rectangle(0, 0, 36, 22, tuning.colors.munchkin);
      lintel.setOrigin(0.5, 1);
      lintel.setScrollFactor(1);
      lintel.setData('floorY', floorY);
      lintel.setData('kind', 'lintel');
      this.parts.push(lintel);
    }

    const label = scene.add
      .text(0, 0, 'GATE', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e8d5a3',
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(1);
    label.setData('floorY', tuning.gateOpeningFloorY);
    label.setData('kind', 'label');
    this.parts.push(label);

    this.syncVisual();
  }

  syncVisual(): void {
    for (const p of this.parts) {
      const floorY = p.getData('floorY') as number;
      const kind = p.getData('kind') as string;
      const screen = Projection.toScreen(this.floorX, floorY, 0);
      const scale = Projection.depthScale(floorY);

      if (kind === 'label' && p instanceof Phaser.GameObjects.Text) {
        p.setPosition(screen.x, screen.y - 96 * scale);
        p.setScale(scale);
        applyDepth(p, floorY, 0.3);
      } else if (p instanceof Phaser.GameObjects.Rectangle) {
        if (kind === 'lintel') {
          p.setPosition(screen.x, screen.y - 70 * scale);
        } else {
          p.setPosition(screen.x, screen.y);
        }
        p.setScale(scale, scale);
        applyDepth(p, floorY, kind === 'lintel' ? 0.2 : 0);
      }
    }
  }

  setAlpha(alpha: number): void {
    for (const p of this.parts) {
      if ('setAlpha' in p && typeof (p as { setAlpha: (a: number) => void }).setAlpha === 'function') {
        (p as { setAlpha: (a: number) => void }).setAlpha(alpha);
      }
    }
  }

  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return this.parts;
  }

  /** Alias for spawn/handoff math (along-road X). */
  get worldX(): number {
    return this.floorX;
  }
}
