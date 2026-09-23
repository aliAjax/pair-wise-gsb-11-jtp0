import { useSyncExternalStore } from "react";
import { areaNameOf } from "../domain/catalog";
import {
  canPublish,
  checkPublishBlocker,
  expectedTextOf,
  freezeTemplate,
  judgeDevice,
  validateTemplateInput
} from "../domain/rules";
import type {
  ActionResult,
  Anomaly,
  Database,
  DeviceResult,
  InspectionRecord,
  InspectionTemplate,
  ReviewConclusion,
  ReviewTask,
  SpotCheck,
  TemplateInput
} from "../domain/types";
import { buildSeed } from "./seed";
import { nowIso } from "./time";

/**
 * 本地存储层：localStorage 持久化 + 全部写操作。
 * 对外暴露 useStore（useSyncExternalStore）与 action 函数；
 * 所有业务写操作都先在内存数据上完成，再一次性落盘。
 */

const STORAGE_KEY = "dfwlfront-10-inspection-standards-v1";

function isDatabase(value: unknown): value is Database {
  if (!value || typeof value !== "object") return false;
  const db = value as Record<string, unknown>;
  return ["templates", "records", "anomalies", "spotChecks", "reviews"].every(
    (key) => Array.isArray(db[key])
  );
}

function load(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isDatabase(parsed)) return parsed;
    }
  } catch {
    // 数据损坏时回落到种子数据
  }
  const seed = buildSeed();
  persist(seed);
  return seed;
}

function persist(db: Database) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // 隐私模式等场景下仅内存生效
  }
}

let database: Database = load();
const listeners = new Set<() => void>();

function commit(next: Database) {
  database = next;
  persist(database);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): Database {
  return useSyncExternalStore(subscribe, () => database);
}

/** 非 React 场景下同步读取当前数据（如 action 提交后立即取最新结果） */
export function getState(): Database {
  return database;
}

// ---------- 编号 ----------

function nextCode(prefix: string, list: { code: string }[]): string {
  return `${prefix}-${String(list.length + 1).padStart(3, "0")}`;
}

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ---------- 检查模板（标准版本） ----------

function nextAreaVersion(templates: InspectionTemplate[], areaCode: string): number {
  const used = templates.filter((tpl) => tpl.areaCode === areaCode && tpl.status === "published");
  return used.length + 1;
}

/** 保存草稿；草稿也要通过结构校验，保证随时可发布 */
export function saveTemplateDraft(input: TemplateInput): ActionResult<{ id: string }> {
  const structural = validateTemplateInput(input);
  if (structural) return { ok: false, error: structural };

  const existing = input.id
    ? database.templates.find((tpl) => tpl.id === input.id)
    : undefined;
  if (existing && existing.status === "published") {
    return { ok: false, error: "已发布版本不可修改，可基于它创建新版草稿" };
  }

  if (existing) {
    const updated: InspectionTemplate = {
      ...existing,
      areaCode: input.areaCode,
      name: input.name.trim(),
      effectiveStart: input.effectiveStart,
      effectiveEnd: input.effectiveEnd,
      devices: input.devices
    };
    commit({ ...database, templates: database.templates.map((t) => (t.id === existing.id ? updated : t)) });
    return { ok: true, data: { id: existing.id } };
  }

  const draft: InspectionTemplate = {
    id: nextId("tpl"),
    code: "",
    areaCode: input.areaCode,
    name: input.name.trim(),
    version: 0,
    status: "draft",
    effectiveStart: input.effectiveStart,
    effectiveEnd: input.effectiveEnd,
    devices: input.devices,
    createdAt: nowIso(),
    publishedAt: null
  };
  commit({ ...database, templates: [draft, ...database.templates] });
  return { ok: true, data: { id: draft.id } };
}

/** 发布：结构校验 + 同区域窗口不重叠 + 同区域无未闭环异常，任一不满足都只能存草稿 */
export function publishTemplate(input: TemplateInput): ActionResult<InspectionTemplate> {
  const structural = validateTemplateInput(input);
  if (structural) return { ok: false, error: structural };

  const blocker = checkPublishBlocker(database.templates, database.anomalies, input);
  if (!canPublish(blocker)) {
    if (blocker.overlap) {
      return {
        ok: false,
        error: `生效窗口与同区域已发布的 ${blocker.overlap.code}《${blocker.overlap.name}》重叠，暂不能发布`
      };
    }
    return {
      ok: false,
      error: `该区域存在 ${blocker.openAnomalies.length} 条未闭环异常，请先在异常复核台闭环后再发布（可先保存草稿）`
    };
  }

  const existing = input.id
    ? database.templates.find((tpl) => tpl.id === input.id)
    : undefined;
  if (existing && existing.status === "published") {
    return { ok: false, error: "该模板已是发布版本" };
  }

  const version = nextAreaVersion(database.templates, input.areaCode);
  const publishedAt = nowIso();
  const published: InspectionTemplate = {
    id: existing?.id ?? nextId("tpl"),
    code: `TPL-${input.areaCode}-V${String(version).padStart(2, "0")}`,
    areaCode: input.areaCode,
    name: input.name.trim(),
    version,
    status: "published",
    effectiveStart: input.effectiveStart,
    effectiveEnd: input.effectiveEnd,
    devices: input.devices,
    createdAt: existing?.createdAt ?? publishedAt,
    publishedAt
  };

  const templates = existing
    ? database.templates.map((t) => (t.id === existing.id ? published : t))
    : [published, ...database.templates];
  commit({ ...database, templates });
  return { ok: true, data: published };
}

/** 基于已发布版本创建新版草稿（旧版本保留，已冻结的记录不受影响） */
export function draftFromTemplate(templateId: string): ActionResult<{ id: string }> {
  const source = database.templates.find((tpl) => tpl.id === templateId);
  if (!source) return { ok: false, error: "模板不存在" };
  const draft: InspectionTemplate = {
    id: nextId("tpl"),
    code: "",
    areaCode: source.areaCode,
    name: source.name,
    version: 0,
    status: "draft",
    effectiveStart: source.effectiveStart,
    effectiveEnd: source.effectiveEnd,
    devices: source.devices.map((device) => ({ ...device, options: [...device.options] })),
    createdAt: nowIso(),
    publishedAt: null
  };
  commit({ ...database, templates: [draft, ...database.templates] });
  return { ok: true, data: { id: draft.id } };
}

/** 仅可删除草稿；已发布版本作为历史标准保留 */
export function deleteTemplate(id: string): ActionResult {
  const target = database.templates.find((tpl) => tpl.id === id);
  if (!target) return { ok: false, error: "模板不存在" };
  if (target.status === "published") {
    return { ok: false, error: "已发布的标准版本不可删除，以保证历史巡检记录可追溯" };
  }
  commit({ ...database, templates: database.templates.filter((tpl) => tpl.id !== id) });
  return { ok: true, data: undefined };
}

// ---------- 巡检提交（冻结模板版本） ----------

export interface SubmitInspectionInput {
  areaCode: string;
  inspector: string;
  checkedAt: string;
  values: Record<string, string>;
  notes: Record<string, string>;
  overallNote: string;
}

export function submitInspection(input: SubmitInspectionInput): ActionResult<InspectionRecord> {
  if (!input.areaCode) return { ok: false, error: "请选择巡检区域" };
  if (!input.inspector.trim()) return { ok: false, error: "请填写巡检人" };
  if (!input.checkedAt) return { ok: false, error: "请选择巡检时间" };

  const template = [...database.templates]
    .filter((tpl) => tpl.status === "published" && tpl.areaCode === input.areaCode)
    .find((tpl) => {
      const time = new Date(input.checkedAt);
      return new Date(tpl.effectiveStart) <= time && time < new Date(tpl.effectiveEnd);
    });
  if (!template) {
    return { ok: false, error: "该区域在所选时间没有生效中的检查标准，请管理员先发布模板" };
  }

  const results: DeviceResult[] = [];
  for (const device of template.devices) {
    const raw = input.values[device.deviceId] ?? "";
    const value = raw.trim();
    if (!value) return { ok: false, error: `必检设备「${device.name}」尚未读数` };
    const verdict = judgeDevice(device, value);
    if (verdict === "abnormal" && !input.notes[device.deviceId]?.trim()) {
      return { ok: false, error: `设备「${device.name}」判定异常，请填写异常说明` };
    }
    results.push({ deviceId: device.deviceId, value, verdict, note: input.notes[device.deviceId] ?? "" });
  }

  const submittedAt = nowIso();
  const snapshot = freezeTemplate(template, submittedAt);
  const code = nextCode("INS", database.records);
  const record: InspectionRecord = {
    id: nextId("rec"),
    code,
    areaCode: input.areaCode,
    areaName: areaNameOf(input.areaCode),
    inspector: input.inspector.trim(),
    checkedAt: input.checkedAt,
    template: snapshot,
    results,
    overallNote: input.overallNote.trim()
  };

  // 异常设备登记进异常台账（与冻结快照中的设备定义对应）
  const newAnomalies: Anomaly[] = results
    .filter((result) => result.verdict === "abnormal")
    .map((result, index) => {
      const device = snapshot.devices.find((item) => item.deviceId === result.deviceId)!;
      return {
        id: nextId("anm"),
        code: `ANM-${String(database.anomalies.length + index + 1).padStart(3, "0")}`,
        inspectionId: record.id,
        inspectionCode: record.code,
        areaCode: record.areaCode,
        areaName: record.areaName,
        deviceId: result.deviceId,
        deviceName: device.name,
        metric: device.metric,
        value: result.value,
        expectedText: expectedTextOf(device),
        inspector: record.inspector,
        openedAt: submittedAt,
        status: "open" as const,
        closedAt: null,
        closedBy: null,
        closeReason: null,
        reviewTaskId: null
      };
    });

  commit({
    ...database,
    records: [record, ...database.records],
    anomalies: [...newAnomalies, ...database.anomalies]
  });
  return { ok: true, data: record };
}

// ---------- 抽检与复核任务 ----------

export interface SpotCheckInput {
  inspectionId: string;
  refDeviceId: string;
  checker: string;
  checkedAt: string;
  value: string;
  note: string;
}

export function registerSpotCheck(input: SpotCheckInput): ActionResult<SpotCheck> {
  const record = database.records.find((item) => item.id === input.inspectionId);
  if (!record) return { ok: false, error: "原巡检记录不存在" };
  const frozenDevice = record.template.devices.find((item) => item.deviceId === input.refDeviceId);
  if (!frozenDevice) return { ok: false, error: "该设备不在原巡检标准内" };
  if (!input.checker.trim()) return { ok: false, error: "请填写抽检人" };
  if (!input.checkedAt) return { ok: false, error: "请选择抽检时间" };
  if (!input.value.trim()) return { ok: false, error: "请填写抽检读数" };

  const duplicated = database.spotChecks.some(
    (item) => item.inspectionId === input.inspectionId && item.refDeviceId === input.refDeviceId
  );
  if (duplicated) return { ok: false, error: "该设备已登记过抽检，不能重复抽检" };

  const original = record.results.find((item) => item.deviceId === input.refDeviceId)!;
  // 以抽检当时冻结在记录里的允许范围重新判定，旧记录不按新标准重算
  const verdict = judgeDevice(frozenDevice, input.value.trim());
  const deviated = verdict !== original.verdict;

  const spotCheck: SpotCheck = {
    id: nextId("spot"),
    inspectionId: input.inspectionId,
    refDeviceId: input.refDeviceId,
    deviceName: frozenDevice.name,
    checker: input.checker.trim(),
    checkedAt: input.checkedAt,
    value: input.value.trim(),
    verdict,
    originalValue: original.value,
    originalVerdict: original.verdict,
    deviated,
    note: input.note.trim()
  };

  let anomalies = database.anomalies;
  let reviews = database.reviews;

  if (deviated) {
    // 复核人必须不同于原巡检人；抽检人只是发起人，真正复核在任务台完成
    const reviewCode = nextCode("RVW", database.reviews);
    let anomaly: Anomaly;
    const existing = database.anomalies.find(
      (item) => item.inspectionId === input.inspectionId && item.deviceId === input.refDeviceId && item.status === "open"
    );

    const reviewSeed: ReviewTask = {
      id: nextId("rvw"),
      code: reviewCode,
      inspectionId: input.inspectionId,
      inspectionCode: record.code,
      areaCode: record.areaCode,
      areaName: record.areaName,
      deviceId: input.refDeviceId,
      deviceName: frozenDevice.name,
      metric: frozenDevice.metric,
      originalInspector: record.inspector,
      originalValue: original.value,
      originalVerdict: original.verdict,
      spotCheckId: spotCheck.id,
      spotChecker: spotCheck.checker,
      spotValue: spotCheck.value,
      spotVerdict: verdict,
      createdAt: nowIso(),
      status: "open",
      reviewer: null,
      reviewedAt: null,
      conclusion: null,
      note: null,
      anomalyId: null
    };

    if (existing) {
      // 原异常仍在：复核任务挂到既有异常上
      reviewSeed.anomalyId = existing.id;
      anomaly = { ...existing, reviewTaskId: reviewSeed.id };
      anomalies = anomalies.map((item) => (item.id === existing.id ? anomaly : item));
    } else {
      // 原记录正常、抽检却异常：先开出异常，再挂复核任务
      anomaly = {
        id: nextId("anm"),
        code: `ANM-${String(database.anomalies.length + 1).padStart(3, "0")}`,
        inspectionId: record.id,
        inspectionCode: record.code,
        areaCode: record.areaCode,
        areaName: record.areaName,
        deviceId: input.refDeviceId,
        deviceName: frozenDevice.name,
        metric: frozenDevice.metric,
        value: original.value,
        expectedText: expectedTextOf(frozenDevice),
        inspector: record.inspector,
        openedAt: nowIso(),
        status: "open",
        closedAt: null,
        closedBy: null,
        closeReason: null,
        reviewTaskId: reviewSeed.id
      };
      reviewSeed.anomalyId = anomaly.id;
      anomalies = [anomaly, ...anomalies];
    }
    reviews = [reviewSeed, ...reviews];
  }

  commit({
    ...database,
    spotChecks: [spotCheck, ...database.spotChecks],
    anomalies,
    reviews
  });
  return { ok: true, data: spotCheck };
}

export interface ReviewInput {
  reviewId: string;
  reviewer: string;
  conclusion: ReviewConclusion;
  note: string;
}

/** 完成复核：复核人必须与原巡检人不同；完成后连同异常一起闭环 */
export function completeReview(input: ReviewInput): ActionResult {
  const task = database.reviews.find((item) => item.id === input.reviewId);
  if (!task) return { ok: false, error: "复核任务不存在" };
  if (task.status === "closed") return { ok: false, error: "该复核任务已闭环" };
  if (!input.reviewer.trim()) return { ok: false, error: "请填写复核人" };
  if (input.reviewer.trim() === task.originalInspector) {
    return { ok: false, error: `复核人不能与原巡检人「${task.originalInspector}」为同一人` };
  }
  if (!input.note.trim()) return { ok: false, error: "请填写复核意见" };

  const closedAt = nowIso();
  const updatedTask: ReviewTask = {
    ...task,
    status: "closed",
    reviewer: input.reviewer.trim(),
    reviewedAt: closedAt,
    conclusion: input.conclusion,
    note: input.note.trim()
  };

  // 复核结论同时闭环关联异常
  const reasonPrefix = input.conclusion === "confirm-abnormal" ? "复核确认异常，按异常处置：" : "复核排除异常：";
  const anomalies = database.anomalies.map((item) =>
    item.id === task.anomalyId
      ? {
          ...item,
          status: "closed" as const,
          closedAt,
          closedBy: input.reviewer.trim(),
          closeReason: reasonPrefix + input.note.trim()
        }
      : item
  );

  commit({
    ...database,
    reviews: database.reviews.map((item) => (item.id === task.id ? updatedTask : item)),
    anomalies
  });
  return { ok: true, data: undefined };
}

/** 无复核任务的异常，由责任人登记整改直接闭环 */
export function resolveAnomaly(anomalyId: string, handler: string, reason: string): ActionResult {
  const anomaly = database.anomalies.find((item) => item.id === anomalyId);
  if (!anomaly) return { ok: false, error: "异常不存在" };
  if (anomaly.status === "closed") return { ok: false, error: "该异常已闭环" };
  if (!handler.trim()) return { ok: false, error: "请填写整改责任人" };
  if (!reason.trim()) return { ok: false, error: "请填写整改说明" };
  if (anomaly.reviewTaskId) {
    return { ok: false, error: "该异常由抽检偏离生成，需在复核任务中闭环" };
  }

  const closedAt = nowIso();
  commit({
    ...database,
    anomalies: database.anomalies.map((item) =>
      item.id === anomalyId
        ? {
            ...item,
            status: "closed" as const,
            closedAt,
            closedBy: handler.trim(),
            closeReason: `现场整改：${reason.trim()}`
          }
        : item
    )
  });
  return { ok: true, data: undefined };
}

/** 清空浏览器数据并恢复演示种子（仅开发辅助） */
export function resetToSeed(): void {
  localStorage.removeItem(STORAGE_KEY);
  commit(buildSeed());
}
