/**
 * 领域模型：检查模板、巡检快照、异常、抽检与复核任务。
 * 仅描述数据结构，不包含任何判定逻辑与存储实现。
 */

export type DeviceKind = "numeric" | "choice";

/** 标准资料中的设备目录定义（管理员发布模板时的数据来源） */
export interface DeviceSpec {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  /** 指标名称，如：出油压力（MPa） */
  metric?: string;
  /** 数值型允许范围，闭区间，null 表示该侧不限 */
  min?: number | null;
  max?: number | null;
  /** 选择型的可选项与期望值 */
  options?: string[];
  expected?: string;
}

export interface AreaDef {
  code: string;
  name: string;
  devices: DeviceSpec[];
}

/** 模板中登记的必检设备（可由管理员在目录基础上调整） */
export interface DeviceRequirement {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  metric: string;
  min: number | null;
  max: number | null;
  options: string[];
  expected: string;
}

export type TemplateStatus = "draft" | "published";

/** 巡检检查模板（标准版本） */
export interface InspectionTemplate {
  id: string;
  /** 发布时生成，如 TPL-FUEL-V01；草稿为空 */
  code: string;
  areaCode: string;
  name: string;
  /** 发布时按区域递增，草稿为 0 */
  version: number;
  status: TemplateStatus;
  /** 生效窗口，ISO 时间字符串 */
  effectiveStart: string;
  effectiveEnd: string;
  devices: DeviceRequirement[];
  createdAt: string;
  publishedAt: string | null;
}

/** 巡检提交时冻结进记录的设备定义 */
export interface FrozenDevice {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  metric: string;
  min: number | null;
  max: number | null;
  options: string[];
  expected: string;
}

/** 巡检提交时冻结的模板快照，此后模板再改版也不影响本记录 */
export interface TemplateSnapshot {
  templateId: string;
  code: string;
  name: string;
  version: number;
  areaCode: string;
  areaName: string;
  effectiveStart: string;
  effectiveEnd: string;
  frozenAt: string;
  devices: FrozenDevice[];
}

export type Verdict = "normal" | "abnormal" | "unchecked";

export interface DeviceResult {
  deviceId: string;
  value: string;
  verdict: Verdict;
  note: string;
}

/** 一次巡检提交记录，内含冻结的模板快照 */
export interface InspectionRecord {
  id: string;
  code: string;
  areaCode: string;
  areaName: string;
  inspector: string;
  checkedAt: string;
  template: TemplateSnapshot;
  results: DeviceResult[];
  overallNote: string;
}

export type AnomalyStatus = "open" | "closed";

/** 异常台账：每个判定异常的设备结果对应一条，闭环前阻止同区域发布新标准 */
export interface Anomaly {
  id: string;
  code: string;
  inspectionId: string;
  inspectionCode: string;
  areaCode: string;
  areaName: string;
  deviceId: string;
  deviceName: string;
  metric: string;
  value: string;
  expectedText: string;
  inspector: string;
  openedAt: string;
  status: AnomalyStatus;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
  /** 由偏离抽检生成时，关联对应复核任务 */
  reviewTaskId: string | null;
}

/** 抽检登记：对某条巡检记录中的某个设备重新读数 */
export interface SpotCheck {
  id: string;
  inspectionId: string;
  refDeviceId: string;
  deviceName: string;
  checker: string;
  checkedAt: string;
  value: string;
  verdict: Verdict;
  originalValue: string;
  originalVerdict: Verdict;
  deviated: boolean;
  note: string;
}

export type ReviewTaskStatus = "open" | "closed";
export type ReviewConclusion = "confirm-abnormal" | "dismiss";

/** 复核任务：抽检结论与原记录不一致时生成 */
export interface ReviewTask {
  id: string;
  code: string;
  inspectionId: string;
  inspectionCode: string;
  areaCode: string;
  areaName: string;
  deviceId: string;
  deviceName: string;
  metric: string;
  originalInspector: string;
  originalValue: string;
  originalVerdict: Verdict;
  spotCheckId: string;
  spotChecker: string;
  spotValue: string;
  spotVerdict: Verdict;
  createdAt: string;
  status: ReviewTaskStatus;
  reviewer: string | null;
  reviewedAt: string | null;
  conclusion: ReviewConclusion | null;
  note: string | null;
  anomalyId: string | null;
}

export interface Database {
  templates: InspectionTemplate[];
  records: InspectionRecord[];
  anomalies: Anomaly[];
  spotChecks: SpotCheck[];
  reviews: ReviewTask[];
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface TemplateInput {
  id?: string;
  areaCode: string;
  name: string;
  effectiveStart: string;
  effectiveEnd: string;
  devices: DeviceRequirement[];
}
