/**
 * Persistence behind an interface — never call localStorage directly from game code.
 * Swap WebStorage for Capacitor Preferences / Tauri fs later.
 */
export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class WebStorage implements Storage {
  async get(key: string): Promise<string | null> {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      globalThis.localStorage.setItem(key, value);
    } catch {
      // Quota / private mode — ignore for now.
    }
  }

  async remove(key: string): Promise<void> {
    try {
      globalThis.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export const STORAGE_KEYS = {
  lastPathId: 'oz.lastPathId',
  settings: 'oz.settings',
} as const;
