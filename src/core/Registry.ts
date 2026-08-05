import type Phaser from 'phaser';
import type { Input } from '../platform/Input';
import type { Lifecycle } from '../platform/Lifecycle';
import type { Storage } from '../platform/Storage';
import type { RoadPath } from '../data/paths';

/** Shared handles registered on the Phaser game registry / boot. */
export type AppServices = {
  storage: Storage;
  input: Input;
  lifecycle: Lifecycle;
};

export const REGISTRY = {
  services: 'services',
  selectedPath: 'selectedPath',
} as const;

export function getServices(scene: Phaser.Scene): AppServices {
  const services = scene.registry.get(REGISTRY.services) as AppServices | undefined;
  if (!services) {
    throw new Error('App services not registered — BootScene must run first');
  }
  return services;
}

export function getSelectedPath(scene: Phaser.Scene): RoadPath {
  const path = scene.registry.get(REGISTRY.selectedPath) as RoadPath | undefined;
  if (!path) {
    throw new Error('No road path selected');
  }
  return path;
}
