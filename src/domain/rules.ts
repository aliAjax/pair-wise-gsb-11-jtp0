// 判定逻辑：发布约束、数值判定、抽检偏离、复核规则
import type {
  InspectionEntry,
  InspectionRecord,
  InspectionTemplate,
  Judgement,
  PersistedState,
  ReviewTask,
  TemplateItem,
} from "./types";

export function uid(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

export function windowsOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string }
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function judgeValue(item: TemplateItem, value: string): Judgement | null {
  const raw = value.trim();
  if (raw === "") return null;
  if (item.type === "number") {
    const num = Number(raw);
    if (Number.isNaN(num)) return null;
    if (item.min !== undefined && num < item.min) return "abnormal";
    if (item.max !== undefined && num > item.max) return "abnormal";
    return "normal";
  }
  if (item.options && item.options.length > 0 && !item.options.includes(raw)) return null;
  // 选择项约定：首个选项为正常基准，其余合法选项判异常
  if (item.options && item.options.length > 0 && raw !== item.options[0]) return "abnormal";
  return "normal";
}

export function judgeFrozen(entry: InspectionEntry, value: string): Judgement | null {
  return judgeValue(
    {
      id: entry.itemId,
      name: entry.name,
      device: entry.device,
      required: entry.required,
      type: entry.frozen.type,
      unit: entry.frozen.unit,
      min: entry.frozen.min,
      max: entry.frozen.max,
      options: entry.frozen.options,
    },
    value
  );
}

export function buildEntries(template: InspectionTemplate): InspectionEntry[] {
  return template.items.map((item) => ({
    id: uid("entry"),
    itemId: item.id,
    name: item.name,
    device: item.device,
    required: item.required,
    frozen: {
      type: item.type,
      unit: item.unit,
      min: item.min,
      max: item.max,
      options: item.options ? [...item.options] : undefined,
    },
    value: "",
    judgement: "normal",
    closure: { status: "open" },
  }));
}

export function openAbnormalCount(state: PersistedState, area: string): number {
  return state.records
    .filter((record) => record.area === area)
    .flatMap((record) => record.entries)
    .filter((entry) => entry.judgement === "abnormal" && entry.closure.status === "open").length;
}

export function publishBlockers(state: PersistedState, template: InspectionTemplate): string[] {
  const blockers: string[] = [];
  const conflict = state.templates.find(
    (other) =>
      other.id !== template.id &&
      other.status === "published" &&
      other.area === template.area &&
      windowsOverlap(other.window, template.window)
  );
  if (conflict) {
    blockers.push(
      `与已生效模板「${conflict.name} v${conflict.version}」（${conflict.window.start} ~ ${conflict.window.end}）窗口重叠`
    );
  }
  const openCount = openAbnormalCount(state, template.area);
  if (openCount > 0) {
    blockers.push(`该区域存在 ${openCount} 条未闭环异常，仅可保存草稿`);
  }
  return blockers;
}

export interface ItemDraft {
  name: string;
  device: string;
  type: "number" | "select";
  unit: string;
  min: string;
  max: string;
  options: string;
  required: boolean;
}

export function compileItems(drafts: ItemDraft[]): { items?: TemplateItem[]; error?: string } {
  if (drafts.length === 0) return { error: "至少登记 1 个必检设备" };
  const items: TemplateItem[] = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const label = `第 ${index + 1} 项`;
    if (!draft.name.trim()) return { error: `${label}：请填写检查项名称` };
    if (!draft.device.trim()) return { error: `${label}：请填写必检设备` };
    const base = {
      id: uid("item"),
      name: draft.name.trim(),
      device: draft.device.trim(),
      required: draft.required,
    };
    if (draft.type === "number") {
      if (draft.min.trim() === "" || draft.max.trim() === "") {
        return { error: `${label}「${base.name}」：请填写允许范围的下限和上限` };
      }
      const min = Number(draft.min);
      const max = Number(draft.max);
      if (Number.isNaN(min) || Number.isNaN(max)) {
        return { error: `${label}「${base.name}」：允许范围必须是数字` };
      }
      if (min > max) return { error: `${label}「${base.name}」：下限不能大于上限` };
      items.push({ ...base, type: "number", unit: draft.unit.trim() || undefined, min, max });
    } else {
      const options = draft.options
        .split(/[,，、\n]/)
        .map((option) => option.trim())
        .filter(Boolean);
      if (options.length === 0) {
        return { error: `${label}「${base.name}」：请填写可选值，用逗号分隔` };
      }
      items.push({ ...base, type: "select", options });
    }
  }
  return { items };
}

export function effectiveTemplate(
  templates: InspectionTemplate[],
  area: string,
  date: string
): InspectionTemplate | undefined {
  return templates.find(
    (template) =>
      template.status === "published" &&
      template.area === area &&
      template.window.start <= date &&
      date <= template.window.end
  );
}

export function spotDeviation(
  entry: InspectionEntry,
  spotValue: string
): { judgement: Judgement; reason: string } | { error: string } {
  const judgement = judgeFrozen(entry, spotValue);
  if (judgement === null) return { error: "抽检值无效：数值项需为数字，选择项需为可选值之一" };
  if (judgement !== entry.judgement) {
    return {
      judgement,
      reason: `判定偏离：原记录「${entry.judgement === "normal" ? "正常" : "异常"}」，抽检判定「${
        judgement === "normal" ? "正常" : "异常"
      }」`,
    };
  }
  if (entry.frozen.type === "number" && spotValue.trim() !== entry.value.trim()) {
    return {
      judgement,
      reason: `数值偏离：原记录 ${entry.value}${entry.frozen.unit ?? ""}，抽检 ${spotValue.trim()}${
        entry.frozen.unit ?? ""
      }`,
    };
  }
  return { error: "抽检结果与原记录一致，未产生偏离，无需生成复核任务" };
}

export function completeReview(
  task: ReviewTask,
  reviewer: string,
  note: string
): ReviewTask | { error: string } {
  const name = reviewer.trim();
  if (!name) return { error: "请填写复核人" };
  if (name === task.originalInspector) {
    return { error: `复核人须与原巡检人不同（原巡检人：${task.originalInspector}）` };
  }
  return {
    ...task,
    status: "resolved",
    reviewer: name,
    reviewNote: note.trim() || "复核完成",
    reviewedAt: new Date().toISOString(),
  };
}

export function closeEntry(
  record: InspectionRecord,
  entryId: string,
  closedBy: string,
  note: string
): InspectionRecord {
  return {
    ...record,
    entries: record.entries.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            closure: {
              status: "closed",
              closedBy: closedBy.trim(),
              closedAt: new Date().toISOString(),
              note: note.trim() || "已处理",
            },
          }
        : entry
    ),
  };
}
