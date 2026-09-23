// 状态层：串联判定规则与本地存储，页面只通过动作修改数据
import { create } from "zustand";
import {
  buildEntries,
  closeEntry,
  completeReview,
  compileItems,
  judgeValue,
  publishBlockers,
  spotDeviation,
  uid,
  type ItemDraft,
} from "../domain/rules";
import { loadState, saveState, STORAGE_KEY } from "../domain/storage";
import { seedState } from "../domain/standards";
import type {
  InspectionEntry,
  InspectionRecord,
  InspectionTemplate,
  Judgement,
  PersistedState,
  ReviewTask,
  TemplateWindow,
} from "../domain/types";

interface TemplateDraftInput {
  id?: string;
  name: string;
  area: string;
  window: TemplateWindow;
  items: ItemDraft[];
}

interface InspectionInput {
  area: string;
  inspector: string;
  inspectedAt: string;
  template: InspectionTemplate;
  values: Record<string, string>;
}

interface SpotCheckInput {
  record: InspectionRecord;
  entry: InspectionEntry;
  spotInspector: string;
  spotValue: string;
}

interface StoreState extends PersistedState {
  saveTemplateDraft: (input: TemplateDraftInput) => { ok: boolean; error?: string };
  deleteTemplate: (id: string) => void;
  publishTemplate: (id: string) => { ok: boolean; error?: string };
  submitInspection: (input: InspectionInput) => { ok: boolean; error?: string; recordId?: string };
  closeAbnormality: (recordId: string, entryId: string, closedBy: string, note: string) => void;
  createReviewFromSpot: (
    input: SpotCheckInput
  ) => { ok: boolean; error?: string; taskId?: string };
  resolveReview: (taskId: string, reviewer: string, note: string) => { ok: boolean; error?: string };
  resetAll: () => void;
}

function persist(state: StoreState): PersistedState {
  const snapshot: PersistedState = {
    version: 2,
    templates: state.templates,
    records: state.records,
    tasks: state.tasks,
  };
  saveState(snapshot);
  return snapshot;
}

export const useStore = create<StoreState>((set, get) => {
  function commit(patch: Partial<PersistedState>) {
    const next = { ...get(), ...patch };
    persist(next);
    set(patch);
  }

  return {
    ...loadState(),

    saveTemplateDraft: ({ id, name, area, window, items }) => {
      if (!name.trim()) return { ok: false, error: "请填写模板名称" };
      if (!area) return { ok: false, error: "请选择区域" };
      if (!window.start || !window.end || window.start > window.end) {
        return { ok: false, error: "生效时间不完整或起止顺序错误" };
      }
      const compiled = compileItems(items);
      if (!compiled.items) return { ok: false, error: compiled.error };
      const compiledItems = compiled.items;
      const now = new Date().toISOString();
      const existing = get().templates.find((template) => template.id === id);
      if (existing) {
        if (existing.status === "published") {
          return { ok: false, error: "已生效模板不可修改，请基于它新建版本" };
        }
        commit({
          templates: get().templates.map((template) =>
            template.id === existing.id
              ? { ...template, name: name.trim(), area, window, items: compiledItems }
              : template
          ),
        });
      } else {
        const nextVersion =
          get()
            .templates.filter(
              (template) => template.area === area && template.name === name.trim()
            )
            .reduce((max, template) => Math.max(max, template.version), 0) + 1;
        const template: InspectionTemplate = {
          id: uid("tpl"),
          name: name.trim(),
          area,
          version: nextVersion,
          status: "draft",
          window,
          items: compiledItems,
          createdAt: now,
        };
        commit({ templates: [template, ...get().templates] });
      }
      return { ok: true };
    },

    deleteTemplate: (id) => {
      const target = get().templates.find((template) => template.id === id);
      if (!target || target.status === "published") return;
      commit({ templates: get().templates.filter((template) => template.id !== id) });
    },

    publishTemplate: (id) => {
      const target = get().templates.find((template) => template.id === id);
      if (!target) return { ok: false, error: "模板不存在" };
      if (target.status === "published") return { ok: false, error: "模板已生效" };
      const blockers = publishBlockers(get(), target);
      if (blockers.length > 0) return { ok: false, error: blockers.join("；") };
      const now = new Date().toISOString();
      commit({
        templates: get().templates.map((template) =>
          template.id === id
            ? { ...template, status: "published", publishedAt: now }
            : template
        ),
      });
      return { ok: true };
    },

    submitInspection: ({ area, inspector, inspectedAt, template, values }) => {
      if (!inspector.trim()) return { ok: false, error: "请填写巡检人" };
      if (!inspectedAt) return { ok: false, error: "请选择巡检时间" };
      const entries = buildEntries(template);
      for (const entry of entries) {
        const value = values[entry.itemId] ?? "";
        const item = template.items.find((candidate) => candidate.id === entry.itemId);
        if (!item) continue;
        const judgement = judgeValue(item, value);
        if (value.trim() === "") {
          if (item.required) return { ok: false, error: `必检设备「${item.device} · ${item.name}」未填写` };
        } else if (judgement === null) {
          return { ok: false, error: `「${item.device} · ${item.name}」录入值无效` };
        }
        entry.value = value.trim();
        entry.judgement = (judgement ?? "normal") as Judgement;
      }
      const record: InspectionRecord = {
        id: uid("rec"),
        area,
        inspector: inspector.trim(),
        inspectedAt,
        submittedAt: new Date().toISOString(),
        templateId: template.id,
        templateName: template.name,
        templateVersion: template.version,
        entries,
      };
      commit({ records: [record, ...get().records] });
      return { ok: true, recordId: record.id };
    },

    closeAbnormality: (recordId, entryId, closedBy, note) => {
      if (!closedBy.trim()) return;
      commit({
        records: get().records.map((record) =>
          record.id === recordId ? closeEntry(record, entryId, closedBy, note) : record
        ),
      });
    },

    createReviewFromSpot: ({ record, entry, spotInspector, spotValue }) => {
      if (!spotInspector.trim()) return { ok: false, error: "请填写抽检人" };
      const deviation = spotDeviation(entry, spotValue);
      if ("error" in deviation) return { ok: false, error: deviation.error };
      const task: ReviewTask = {
        id: uid("task"),
        recordId: record.id,
        entryId: entry.id,
        area: record.area,
        itemName: entry.name,
        device: entry.device,
        originalInspector: record.inspector,
        originalValue: entry.value,
        originalJudgement: entry.judgement,
        spotInspector: spotInspector.trim(),
        spotValue: spotValue.trim(),
        spotJudgement: deviation.judgement,
        reason: deviation.reason,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      commit({ tasks: [task, ...get().tasks] });
      return { ok: true, taskId: task.id };
    },

    resolveReview: (taskId, reviewer, note) => {
      const task = get().tasks.find((candidate) => candidate.id === taskId);
      if (!task) return { ok: false, error: "复核任务不存在" };
      if (task.status === "resolved") return { ok: false, error: "该任务已闭环" };
      const result = completeReview(task, reviewer, note);
      if ("error" in result) return { ok: false, error: result.error };
      commit({
        tasks: get().tasks.map((candidate) => (candidate.id === taskId ? result : candidate)),
      });
      return { ok: true };
    },

    resetAll: () => {
      localStorage.removeItem(STORAGE_KEY);
      const seeded = seedState();
      commit({
        templates: seeded.templates,
        records: seeded.records,
        tasks: seeded.tasks,
      });
    },
  };
});
