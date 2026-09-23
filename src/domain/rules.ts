import { areaNameOf } from "./catalog";
import type {
  Anomaly,
  DeviceRequirement,
  DeviceResult,
  DeviceSpec,
  FrozenDevice,
  InspectionTemplate,
  TemplateInput,
  TemplateSnapshot,
  Verdict
} from "./types";

/**
 * 判定规则层：数值/选择项判定、生效窗口重叠校验、发布闸门、模板快照冻结。
 * 纯函数，不读 localStorage，不依赖 React。
 */

export function judgeNumeric(value: number, min: number | null, max: number | null): Verdict {
  if (min !== null && value < min) return "abnormal";
  if (max !== null && value > max) return "abnormal";
  return "normal";
}

export function judgeChoice(value: string, expected: string): Verdict {
  return value === expected ? "normal" : "abnormal";
}

/** 单个设备读数的统一判定入口 */
export function judgeDevice(
  device: Pick<DeviceRequirement, "kind" | "min" | "max" | "expected">,
  value: string
): Verdict {
  if (value.trim() === "") return "unchecked";
  if (device.kind === "numeric") {
    const num = Number(value);
    if (Number.isNaN(num)) return "abnormal";
    return judgeNumeric(num, device.min, device.max);
  }
  return judgeChoice(value, device.expected);
}

export function rangeText(min: number | null, max: number | null): string {
  if (min === null && max === null) return "不限";
  if (min === null) return `≤ ${max}`;
  if (max === null) return `≥ ${min}`;
  return `${min} ~ ${max}`;
}

export function expectedTextOf(device: DeviceRequirement): string {
  return device.kind === "numeric"
    ? `允许范围 ${rangeText(device.min, device.max)}`
    : `应为「${device.expected}」`;
}

export const verdictLabel: Record<Verdict, string> = {
  normal: "正常",
  abnormal: "异常",
  unchecked: "未检"
};

/** 半开区间语义：[start, end) 与 [start, end) 相交即冲突，允许首尾相接 */
export function windowsOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return new Date(startA) < new Date(endB) && new Date(startB) < new Date(endA);
}

/**
 * 同区域已发布模板的生效窗口不得重叠。
 * excludeId 用于编辑草稿时排除自身（草稿本身不参与重叠判断）。
 */
export function findOverlappingTemplate(
  templates: InspectionTemplate[],
  areaCode: string,
  start: string,
  end: string,
  excludeId?: string
): InspectionTemplate | undefined {
  return templates.find(
    (tpl) =>
      tpl.status === "published" &&
      tpl.areaCode === areaCode &&
      tpl.id !== excludeId &&
      windowsOverlap(start, end, tpl.effectiveStart, tpl.effectiveEnd)
  );
}

/** 已发布即生效过的模板不可编辑；仅草稿可改、可删 */
export function openAnomaliesIn(anomalies: Anomaly[], areaCode: string): Anomaly[] {
  return anomalies.filter((item) => item.areaCode === areaCode && item.status === "open");
}

/** 发布前的结构性校验（保存草稿也走此校验，保证草稿随时可发布） */
export function validateTemplateInput(input: TemplateInput): string | null {
  if (!input.areaCode) return "请选择所属区域";
  if (!input.name.trim()) return "请填写模板名称";
  if (!input.effectiveStart || !input.effectiveEnd) return "请选择生效起止时间";
  if (new Date(input.effectiveStart) >= new Date(input.effectiveEnd)) {
    return "生效开始时间必须早于结束时间";
  }
  if (input.devices.length === 0) return "至少登记一台必检设备";
  const seen = new Set<string>();
  for (const device of input.devices) {
    if (!device.name.trim()) return "存在未命名的必检设备";
    if (seen.has(device.deviceId)) return `设备 ${device.name} 重复登记`;
    seen.add(device.deviceId);
    if (device.kind === "numeric") {
      if (
        device.min !== null &&
        device.max !== null &&
        Number(device.min) > Number(device.max)
      ) {
        return `设备 ${device.name} 的允许范围下限大于上限`;
      }
    } else if (!device.expected) {
      return `设备 ${device.name} 未设置期望项`;
    }
  }
  return null;
}

export interface PublishBlocker {
  overlap?: InspectionTemplate;
  openAnomalies: Anomaly[];
}

/** 发布闸门：窗口重叠 或 存在未闭环异常，均不允许发布（只能存草稿） */
export function checkPublishBlocker(
  templates: InspectionTemplate[],
  anomalies: Anomaly[],
  input: TemplateInput
): PublishBlocker {
  return {
    overlap: findOverlappingTemplate(
      templates,
      input.areaCode,
      input.effectiveStart,
      input.effectiveEnd,
      input.id
    ),
    openAnomalies: openAnomaliesIn(anomalies, input.areaCode)
  };
}

export function canPublish(blocker: PublishBlocker): boolean {
  return !blocker.overlap && blocker.openAnomalies.length === 0;
}

/** 目录定义 → 模板必检设备（发布前管理员可再调整范围） */
export function requirementFromSpec(spec: DeviceSpec): DeviceRequirement {
  return {
    deviceId: spec.deviceId,
    name: spec.name,
    kind: spec.kind,
    metric: spec.metric ?? "状态",
    min: spec.min ?? null,
    max: spec.max ?? null,
    options: spec.options ? [...spec.options] : [],
    expected: spec.expected ?? ""
  };
}

function freezeDevice(device: DeviceRequirement): FrozenDevice {
  return { ...device, options: [...device.options] };
}

/**
 * 巡检提交时冻结模板版本：
 * 将当时生效的模板整体复制进巡检记录，之后模板改版/失效都不影响本记录。
 */
export function freezeTemplate(template: InspectionTemplate, frozenAt: string): TemplateSnapshot {
  return {
    templateId: template.id,
    code: template.code,
    name: template.name,
    version: template.version,
    areaCode: template.areaCode,
    areaName: areaNameOf(template.areaCode),
    effectiveStart: template.effectiveStart,
    effectiveEnd: template.effectiveEnd,
    frozenAt,
    devices: template.devices.map(freezeDevice)
  };
}

/** 按提交时刻查找当前生效（且窗口覆盖该时刻）的已发布模板 */
export function activeTemplateAt(
  templates: InspectionTemplate[],
  areaCode: string,
  at: string
): InspectionTemplate | undefined {
  const time = new Date(at);
  return templates.find(
    (tpl) =>
      tpl.status === "published" &&
      tpl.areaCode === areaCode &&
      new Date(tpl.effectiveStart) <= time &&
      time < new Date(tpl.effectiveEnd)
  );
}

export function isAbnormalResult(result: DeviceResult): boolean {
  return result.verdict === "abnormal";
}
