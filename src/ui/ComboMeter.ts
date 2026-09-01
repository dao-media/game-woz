import Phaser from 'phaser';
import { Projection } from '../core/Projection';
import { applyDepth } from '../core/DepthSort';
import { tuning } from '../config/tuning';
import type { Player } from '../entities/Player';

/**
 * Three-marker rhythm combo meter — world-anchored near the player.
 */
export class ComboMeter {
  private readonly root: Phaser.GameObjects.Container;
  private readonly markers: Phaser.GameObjects.Arc[] = [];
  private readonly windowRings: Phaser.GameObjects.Arc[] = [];
  private pulsePhase = 0;

  constructor(scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0);
    this.root.setScrollFactor(1);

    const size = tuning.comboMeterMarkerSize;
    const gap = tuning.comboMeterMarkerGap;
    const totalW = size * 3 + gap * 2;
    let x = -totalW / 2 + size / 2;

    for (let i = 0; i < 3; i++) {
      const ring = scene.add.circle(0, 0, size * 0.72, 0x000000, 0);
      ring.setStrokeStyle(2, tuning.colors.cooldownReady, 0);
      this.windowRings.push(ring);

      const dot = scene.add.circle(0, 0, size * 0.45, tuning.colors.hpBarBg, 0.85);
      dot.setStrokeStyle(1, 0x5a5a68, 0.9);
      this.markers.push(dot);

      ring.setPosition(x, 0);
      dot.setPosition(x, 0);
      this.root.add([ring, dot]);
      x += size + gap;
    }
  }

  update(player: Player, dtMs: number): void {
    if (player.characterId !== 'dorothy') {
      this.root.setVisible(false);
      return;
    }

    const lit = player.comboMarkersLit;
    const windowActive = player.comboWindowActive;
    const windowTarget = player.comboWindowTarget;
    const show =
      lit > 0 ||
      windowActive ||
      player.state === 'lightAttack' ||
      player.comboWindowTarget !== null;

    this.root.setVisible(show && !player.health.isDead);
    if (!show || player.health.isDead) return;

    this.pulsePhase += dtMs * 0.012;

    const screen = Projection.toScreen(player.floorX, player.floorY, player.z);
    const entityScale = Projection.entityDepthScale(
      player.floorY,
      tuning.playerDepthScaleStrength,
    );
    const feetY =
      (player.visual?.y ?? player.body.y) +
      (player.visual ? 0 : tuning.playerBodyHeight * entityScale * 0.5);
    const y = feetY + tuning.comboMeterOffsetY * entityScale;
    this.root.setPosition(screen.x, y);
    applyDepth(this.root, player.floorY, 4);

    for (let i = 0; i < 3; i++) {
      const markerIndex = i + 1;
      const dot = this.markers[i]!;
      const ring = this.windowRings[i]!;
      const isLit = lit >= markerIndex || (player.state === 'lightAttack' && player.comboIndex === i);
      dot.fillColor = isLit ? tuning.colors.cooldownReady : tuning.colors.hpBarBg;
      dot.setAlpha(isLit ? 1 : 0.55);

      const isWindowMarker = windowActive && windowTarget === markerIndex;
      if (isWindowMarker) {
        const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.pulsePhase * 4));
        ring.setStrokeStyle(2, tuning.colors.ultimateCharge, pulse);
        dot.setScale(1 + 0.12 * Math.sin(this.pulsePhase * 4));
      } else {
        ring.setStrokeStyle(2, tuning.colors.cooldownReady, 0);
        dot.setScale(1);
      }
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}
