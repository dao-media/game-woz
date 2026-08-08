import type { Storage } from '../platform/Storage';
import { STORAGE_KEYS } from '../platform/Storage';
import {
  DEFAULT_DIFFICULTY,
  type DifficultyId,
} from '../ai/DifficultyParams';

/** Run-level choices — single funnel; persist via Storage. */
export type RunStateData = {
  selectedCharacter: string | null;
  selectedPath: string | null;
  difficulty: DifficultyId;
};

export class RunState {
  selectedCharacter: string | null = null;
  selectedPath: string | null = null;
  difficulty: DifficultyId = DEFAULT_DIFFICULTY;

  toData(): RunStateData {
    return {
      selectedCharacter: this.selectedCharacter,
      selectedPath: this.selectedPath,
      difficulty: this.difficulty,
    };
  }

  async load(storage: Storage): Promise<void> {
    const raw = await storage.get(STORAGE_KEYS.runState);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Partial<RunStateData>;
      this.selectedCharacter = data.selectedCharacter ?? null;
      this.selectedPath = data.selectedPath ?? null;
      this.difficulty = data.difficulty ?? DEFAULT_DIFFICULTY;
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

  async setDifficulty(id: DifficultyId, storage: Storage): Promise<void> {
    this.difficulty = id === 'custom' ? 'normal' : id;
    await this.save(storage);
  }

  /** Clear path when starting a fresh approach to the fork. */
  async clearPath(storage: Storage): Promise<void> {
    this.selectedPath = null;
    await this.save(storage);
  }
}
