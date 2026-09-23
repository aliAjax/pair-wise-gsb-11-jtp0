import { AREAS } from "../domain/catalog";
import { expectedTextOf, freezeTemplate, judgeDevice, requirementFromSpec } from "../domain/rules";
import type {
  Anomaly,
  Database,
  DeviceResult,
  InspectionRecord,
  InspectionTemplate,
  ReviewTask,
  SpotCheck,
  TemplateSnapshot,
  Verdict
} from "../domain/types";

/**
 * 首启种子数据。模板与巡检快照之间通过 freezeTemplate 构建，
 * 保证"刷新后模板、快照、复核任务一致"，不手工复制两份易漂移的定义。
 */

const WINDOW_START = "2026-01-01T00:00:00+08:00";
const WINDOW_END = "2026-12-31T23:59:00+08:00";

function seedTemplate(areaCode: "FUEL" | "TANK" | "CASH", index: number): InspectionTemplate {
  const area = AREAS.find((item) => item.code === areaCode)!;
  return {
    id: `tpl-${area.code.toLowerCase()}`,
    code: `TPL-${area.code}-V01`,
    areaCode: area.code,
    name: `${area.name}设备巡检标准`,
    version: 1,
    status: "published",
    effectiveStart: WINDOW_START,
    effectiveEnd: WINDOW_END,
    devices: area.devices.map(requirementFromSpec),
    createdAt: `2026-01-01T0${8 + index}:00:00+08:00`,
    publishedAt: `2026-01-01T0${8 + index}:30:00+08:00`
  };
}

function buildResults(
  snapshot: TemplateSnapshot,
  values: Record<string, string>,
  notes: Record<string, string> = {}
): DeviceResult[] {
  return snapshot.devices.map((device) => {
    const value = values[device.deviceId] ?? "";
    return {
      deviceId: device.deviceId,
      value,
      verdict: judgeDevice(device, value),
      note: notes[device.deviceId] ?? ""
    };
  });
}

function buildRecord(
  code: string,
  template: InspectionTemplate,
  inspector: string,
  checkedAt: string,
  values: Record<string, string>,
  overallNote: string
): InspectionRecord {
  const snapshot = freezeTemplate(template, checkedAt);
  return {
    id: `rec-${code.slice(4)}`,
    code,
    areaCode: template.areaCode,
    areaName: snapshot.areaName,
    inspector,
    checkedAt,
    template: snapshot,
    results: buildResults(snapshot, values),
    overallNote
  };
}

function openAnomaly(
  code: string,
  record: InspectionRecord,
  result: DeviceResult
): Anomaly {
  const device = record.template.devices.find((item) => item.deviceId === result.deviceId)!;
  return {
    id: `anm-${code.slice(4)}`,
    code,
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
    openedAt: record.checkedAt,
    status: "open",
    closedAt: null,
    closedBy: null,
    closeReason: null,
    reviewTaskId: null
  };
}

export function buildSeed(): Database {
  const fuelTemplate = seedTemplate("FUEL", 0);
  const tankTemplate = seedTemplate("TANK", 1);
  const cashTemplate = seedTemplate("CASH", 2);

  const record1 = buildRecord(
    "INS-001",
    fuelTemplate,
    "何鑫",
    "2026-06-30T10:00:00+08:00",
    {
      "FUEL-PUMP-01": "0.28",
      "FUEL-FLOW-01": "0.12",
      "FUEL-LEAK-01": "正常",
      "FUEL-EXT-01": "在有效期内"
    },
    "班前例行巡检，设备运行平稳。"
  );

  const record2 = buildRecord(
    "INS-002",
    tankTemplate,
    "何鑫",
    "2026-06-30T10:40:00+08:00",
    {
      "TANK-SEAL-01": "老化",
      "TANK-STATIC-01": "12",
      "TANK-LVL-01": "1",
      "TANK-VENT-01": "通畅"
    },
    "卸油口密封圈老化，已上报等待备件。"
  );

  const record3 = buildRecord(
    "INS-003",
    fuelTemplate,
    "王磊",
    "2026-07-02T09:20:00+08:00",
    {
      "FUEL-PUMP-01": "0.30",
      "FUEL-FLOW-01": "0.42",
      "FUEL-LEAK-01": "正常",
      "FUEL-EXT-01": "在有效期内"
    },
    "1号加油机流量计误差偏大，申请校泵。"
  );

  // INS-002 自带的未闭环异常（可在异常台账直接登记整改闭环）
  const anomaly1 = openAnomaly(
    "ANM-001",
    record2,
    record2.results.find((item) => item.deviceId === "TANK-SEAL-01")!
  );

  // INS-003 自带的未闭环异常
  const anomaly2 = openAnomaly(
    "ANM-002",
    record3,
    record3.results.find((item) => item.deviceId === "FUEL-FLOW-01")!
  );

  // 抽检：李倩复核 1 号加油机流量计，读数 0.10 正常，与原记录 0.42 异常不一致 → 偏离
  const originalResult = record3.results.find((item) => item.deviceId === "FUEL-FLOW-01")!;
  const spotVerdict: Verdict = "normal";
  const spotCheck: SpotCheck = {
    id: "spot-001",
    inspectionId: record3.id,
    refDeviceId: "FUEL-FLOW-01",
    deviceName: "1号加油机流量计",
    checker: "李倩",
    checkedAt: "2026-07-05T14:00:00+08:00",
    value: "0.10",
    verdict: spotVerdict,
    originalValue: originalResult.value,
    originalVerdict: originalResult.verdict,
    deviated: true,
    note: "复校后误差在允许范围内，怀疑首次读数时油枪未回零。"
  };

  const review: ReviewTask = {
    id: "rvw-001",
    code: "RVW-001",
    inspectionId: record3.id,
    inspectionCode: record3.code,
    areaCode: record3.areaCode,
    areaName: record3.areaName,
    deviceId: "FUEL-FLOW-01",
    deviceName: "1号加油机流量计",
    metric: "计量误差（%）",
    originalInspector: record3.inspector,
    originalValue: "0.42",
    originalVerdict: "abnormal",
    spotCheckId: spotCheck.id,
    spotChecker: "李倩",
    spotValue: "0.10",
    spotVerdict: "normal",
    createdAt: spotCheck.checkedAt,
    status: "open",
    reviewer: null,
    reviewedAt: null,
    conclusion: null,
    note: null,
    anomalyId: "anm-003"
  };

  // 偏离场景下由抽检生成的待复核异常
  const anomaly3: Anomaly = {
    id: "anm-003",
    code: "ANM-003",
    inspectionId: record3.id,
    inspectionCode: record3.code,
    areaCode: record3.areaCode,
    areaName: record3.areaName,
    deviceId: "FUEL-FLOW-01",
    deviceName: "1号加油机流量计",
    metric: "计量误差（%）",
    value: "0.42",
    expectedText: "允许范围 -0.3 ~ 0.3",
    inspector: record3.inspector,
    openedAt: spotCheck.checkedAt,
    status: "open",
    closedAt: null,
    closedBy: null,
    closeReason: null,
    reviewTaskId: review.id
  };

  return {
    templates: [fuelTemplate, tankTemplate, cashTemplate],
    records: [record3, record2, record1],
    anomalies: [anomaly3, anomaly2, anomaly1],
    spotChecks: [spotCheck],
    reviews: [review]
  };
}
