// 本地存储：整体状态单键读写，保证模板、巡检快照、复核任务刷新后一致
import { seedState } from "./standards";
import type { PersistedState } from "./types";

export const STORAGE_KEY = "dfwlfront-10-inspection-standard-v2";

export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (
        parsed &&
        parsed.version === 2 &&
        Array.isArray(parsed.templates) &&
        Array.isArray(parsed.records) &&
        Array.isArray(parsed.tasks)
      ) {
        return parsed;
      }
    }
  } catch {
    // 数据损坏时回落到种子数据
  }
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}

export function saveState(state: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
