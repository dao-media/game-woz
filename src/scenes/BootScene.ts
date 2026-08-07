import Phaser from 'phaser';
import { Input } from '../platform/Input';
import { Lifecycle } from '../platform/Lifecycle';
import { WebStorage } from '../platform/Storage';
import { RunState } from '../state/RunState';
import type { AppServices } from '../core/Registry';
import { REGISTRY } from '../core/Registry';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const storage = new WebStorage();
    const runState = new RunState();
    const services: AppServices = {
      storage,
      input: new Input(),
      lifecycle: new Lifecycle(),
      runState,
    };
    services.lifecycle.attach(this.game);
    this.registry.set(REGISTRY.services, services);
    void runState.load(storage).then(() => {
      this.scene.start('Preload');
    });
  }
}
