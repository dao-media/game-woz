import type { Storage } from '../platform/Storage';
import { STORAGE_KEYS } from '../platform/Storage';

/** Run-level choices — single funnel; persist via Storage. */
export type RunStateData = {
  selectedCharacter: string | null;
  selectedPath: string | null;
};

export class RunState {
  selectedCharacter: string | null = null;
  selectedPath: string | null = null;

  toData(): RunStateData {
    return {
      selectedCharacter: this.selectedCharacter,
      selectedPath: this.selectedPath,
    };
  }

  async load(storage: Storage): Promise<void> {
    const raw = await storage.get(STORAGE_KEYS.runState);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Partial<RunStateData>;
      this.selectedCharacter = data.selectedCharacter ?? null;
      this.selectedPath = data.selectedPath ?? null;
    } catch {
      // ignore corrupt save
    }
  }

  async save(storage: Storage): Promise<void> {
    await storage.set(STORAGE_KEYS.runState, JSON.stringify(this.toData()));
  }

  async setCharacter(id: string, storage: Storage): Promise<void> {
    this.selectedCharacter = id;
    await this.save(storage);
  }

  async setPath(id: string, storage: Storage): Promise<void> {
    this.selectedPath = id;
    await this.save(storage);
  }

  /** Clear path when starting a fresh approach to the fork. */
  async clearPath(storage: Storage): Promise<void> {
    this.selectedPath = null;
    await this.save(storage);
  }
}
