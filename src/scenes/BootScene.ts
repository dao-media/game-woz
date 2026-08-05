import Phaser from 'phaser';
import { Input } from '../platform/Input';
import { Lifecycle } from '../platform/Lifecycle';
import { WebStorage } from '../platform/Storage';
import type { AppServices } from '../core/Registry';
import { REGISTRY } from '../core/Registry';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const services: AppServices = {
      storage: new WebStorage(),
      input: new Input(),
      lifecycle: new Lifecycle(),
    };
    services.lifecycle.attach(this.game);
    this.registry.set(REGISTRY.services, services);
    this.scene.start('Preload');
  }
}
