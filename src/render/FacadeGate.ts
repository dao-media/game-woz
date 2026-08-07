import Phaser from 'phaser';
import { tuning } from '../config/tuning';

/**
 * Head-on greybox gate (approach / splash) — viewed facing west.
 */
export function buildFacadeGate(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
): void {
  const gateY = 40;
  parent.add([
    scene.add.rectangle(-90, gateY, 36, 160, tuning.colors.munchkin).setOrigin(0.5, 1),
    scene.add.rectangle(90, gateY, 36, 160, tuning.colors.munchkin).setOrigin(0.5, 1),
    scene.add.rectangle(0, gateY - 150, 220, 36, tuning.colors.munchkin).setOrigin(0.5, 0.5),
    scene.add
      .text(0, gateY - 150, 'GATE OF MUNCHKINLAND', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e8d5a3',
      })
      .setOrigin(0.5),
  ]);
}

/**
 * Approach framing: standing on the road facing due west.
 * Gate head-on; yellow-brick strip underfoot; stage is behind the camera.
 */
export function buildApproachFraming(
  scene: Phaser.Scene,
): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0).setScrollFactor(0).setDepth(40_000);

  const bg = scene.add.rectangle(
    tuning.gameWidth / 2,
    tuning.gameHeight / 2,
    tuning.gameWidth,
    tuning.gameHeight,
    tuning.colors.background,
  );
  root.add(bg);

  // Road underfoot — wider near camera (bottom), pinches toward the gate.
  const road = scene.add.graphics();
  const topY = tuning.gameHeight * 0.58;
  const botY = tuning.gameHeight;
  const cx = tuning.gameWidth / 2;
  road.fillStyle(tuning.colors.road, 0.85);
  road.beginPath();
  road.moveTo(cx - 70, topY);
  road.lineTo(cx + 70, topY);
  road.lineTo(cx + 280, botY);
  road.lineTo(cx - 280, botY);
  road.closePath();
  road.fillPath();
  road.lineStyle(2, 0xa88840, 0.5);
  road.lineBetween(cx - 70, topY, cx - 280, botY);
  road.lineBetween(cx + 70, topY, cx + 280, botY);
  root.add(road);

  const gate = scene.add.container(cx, tuning.gameHeight * 0.42);
  buildFacadeGate(scene, gate);
  root.add(gate);

  root.setData('gate', gate);
  return root;
}
