import type Phaser from 'phaser';
import type { Input } from '../platform/Input';
import type { Lifecycle } from '../platform/Lifecycle';
import type { Storage } from '../platform/Storage';
import type { RunState } from '../state/RunState';
import { getBranchById, type ForkBranch } from '../data/branches';

export type AppServices = {
  storage: Storage;
  input: Input;
  lifecycle: Lifecycle;
  runState: RunState;
};

export const REGISTRY = {
  services: 'services',
} as const;

export function getServices(scene: Phaser.Scene): AppServices {
  const services = scene.registry.get(REGISTRY.services) as AppServices | undefined;
  if (!services) {
    throw new Error('App services not registered — BootScene must run first');
  }
  return services;
}

export function getSelectedPath(scene: Phaser.Scene): ForkBranch {
  const { runState } = getServices(scene);
  const id = runState.selectedPath;
  if (!id) throw new Error('No road path selected in RunState');
  const branch = getBranchById(id);
  if (!branch) throw new Error(`Unknown path id "${id}"`);
  return branch;
}

export function getSelectedCharacterId(scene: Phaser.Scene): string {
  const { runState } = getServices(scene);
  if (!runState.selectedCharacter) {
    throw new Error('No character selected in RunState');
  }
  return runState.selectedCharacter;
}
