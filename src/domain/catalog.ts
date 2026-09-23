import type { AreaDef, DeviceSpec } from "./types";

/**
 * 标准资料：油站区域与设备目录。
 * 只负责"有哪些区域、有哪些设备、出厂允许范围是什么"，
 * 与判定规则、存储和页面完全分开；后续改为从接口拉取时仅替换本文件。
 */
export const AREAS: AreaDef[] = [
  {
    code: "FUEL",
    name: "加油区",
    devices: [
      { deviceId: "FUEL-PUMP-01", name: "1号加油机", kind: "numeric", metric: "出油压力（MPa）", min: 0.2, max: 0.35 },
      { deviceId: "FUEL-FLOW-01", name: "1号加油机流量计", kind: "numeric", metric: "计量误差（%）", min: -0.3, max: 0.3 },
      { deviceId: "FUEL-LEAK-01", name: "加油区油气回收", kind: "choice", options: ["正常", "渗漏", "停机"], expected: "正常" },
      { deviceId: "FUEL-EXT-01", name: "加油区灭火器", kind: "choice", options: ["在有效期内", "压力不足", "过期"], expected: "在有效期内" }
    ]
  },
  {
    code: "TANK",
    name: "油罐区",
    devices: [
      { deviceId: "TANK-SEAL-01", name: "卸油口密封", kind: "choice", options: ["完好", "老化", "渗漏"], expected: "完好" },
      { deviceId: "TANK-STATIC-01", name: "静电接地装置", kind: "numeric", metric: "接地电阻（Ω）", min: 0, max: 100 },
      { deviceId: "TANK-LVL-01", name: "油罐液位仪", kind: "numeric", metric: "液位偏差（mm）", min: -5, max: 5 },
      { deviceId: "TANK-VENT-01", name: "通气管阻火帽", kind: "choice", options: ["通畅", "堵塞", "破损"], expected: "通畅" }
    ]
  },
  {
    code: "CASH",
    name: "收银区",
    devices: [
      { deviceId: "CASH-ALARM-01", name: "可燃气体报警器", kind: "choice", options: ["在线", "故障", "离线"], expected: "在线" },
      { deviceId: "CASH-CAM-01", name: "监控摄像头", kind: "choice", options: ["正常", "偏位", "离线"], expected: "正常" },
      { deviceId: "CASH-EMS-01", name: "应急照明", kind: "choice", options: ["正常", "不亮", "电池亏电"], expected: "正常" }
    ]
  }
];

export function areaNameOf(code: string): string {
  return AREAS.find((area) => area.code === code)?.name ?? code;
}

export function areaOf(code: string): AreaDef | undefined {
  return AREAS.find((area) => area.code === code);
}

export function findDeviceSpec(areaCode: string, deviceId: string): DeviceSpec | undefined {
  return areaOf(areaCode)?.devices.find((device) => device.deviceId === deviceId);
}
