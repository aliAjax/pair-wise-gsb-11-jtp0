/**
 * 规则闭环验证脚本（不加入应用依赖，仅用已装的 esbuild 转译后运行）：
 *   node --import <esbuild-register> scripts/verify.ts 不可用时，
 *   通过 npm run verify（esbuild 打包后 node 执行）。
 */
import { AREAS } from "../src/domain/catalog";
import {
  checkPublishBlocker,
  canPublish,
  findOverlappingTemplate,
  freezeTemplate,
  judgeDevice,
  requirementFromSpec,
  validateTemplateInput,
  windowsOverlap
} from "../src/domain/rules";
import {
  completeReview,
  getState,
  publishTemplate,
  registerSpotCheck,
  resetToSeed,
  resolveAnomaly,
  saveTemplateDraft,
  submitInspection
} from "../src/storage/store";

let passed = 0;
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`断言失败：${message}`);
  passed += 1;
  console.log(`✓ ${message}`);
}

// 1. 判定规则
const numeric = requirementFromSpec(AREAS[0].devices[0]); // 0.2 ~ 0.35
assert(judgeDevice(numeric, "0.30") === "normal", "数值在允许范围内判正常");
assert(judgeDevice(numeric, "0.40") === "abnormal", "数值超上限判异常");
assert(judgeDevice(numeric, "0.10") === "abnormal", "数值低于下限判异常");
const choice = requirementFromSpec(AREAS[0].devices[2]); // 油气回收=正常
assert(judgeDevice(choice, "正常") === "normal", "选择项符合期望判正常");
assert(judgeDevice(choice, "渗漏") === "abnormal", "选择项偏离期望判异常");

// 2. 窗口重叠（半开区间，首尾相接不冲突）
assert(windowsOverlap("2026-01-01T00:00:00Z", "2026-06-30T16:00:00Z", "2026-06-01T00:00:00Z", "2027-01-01T00:00:00Z"), "相交窗口判重叠");
assert(!windowsOverlap("2026-01-01T00:00:00Z", "2026-06-30T16:00:00Z", "2026-06-30T16:00:00Z", "2027-01-01T00:00:00Z"), "首尾相接不算重叠");

// 3. 种子数据一致 + 发布闸门
resetToSeed();
const seed = getState();
assert(seed.templates.length === 3, "种子含 3 个已发布模板");
assert(seed.reviews.length === 1 && seed.reviews[0].status === "open", "种子含 1 条待复核任务");
const openByArea = (code: string) => seed.anomalies.filter((a) => a.areaCode === code && a.status === "open").length;
assert(openByArea("FUEL") === 2, "加油区有 2 条未闭环异常");
assert(openByArea("TANK") === 1, "油罐区有 1 条未闭环异常");
assert(openByArea("CASH") === 0, "收银区无未闭环异常");

// 加油区发布新标准：有未闭环异常 → 拒绝，可存草稿
const blocked = publishTemplate({
  areaCode: "FUEL",
  name: "加油区新版",
  effectiveStart: "2027-01-01T00:00:00.000Z",
  effectiveEnd: "2027-12-31T16:00:00.000Z",
  devices: seed.templates[0].devices.map((d) => ({ ...d, options: [...d.options] }))
});
assert(!blocked.ok, "存在未闭环异常时发布被拒绝");
const draft = saveTemplateDraft({
  areaCode: "FUEL",
  name: "加油区新版草稿",
  effectiveStart: "2027-01-01T00:00:00.000Z",
  effectiveEnd: "2027-12-31T16:00:00.000Z",
  devices: seed.templates[0].devices.map((d) => ({ ...d, options: [...d.options] }))
});
assert(draft.ok, "存在未闭环异常时可保存草稿");

// 收银区无异常但窗口重叠 → 拒绝
const overlapPub = publishTemplate({
  areaCode: "CASH",
  name: "收银区重叠版",
  effectiveStart: "2026-06-01T00:00:00.000Z",
  effectiveEnd: "2026-08-01T00:00:00.000Z",
  devices: seed.templates[2].devices.map((d) => ({ ...d, options: [...d.options] }))
});
assert(!overlapPub.ok, "同区域生效窗口重叠时发布被拒绝");
assert(findOverlappingTemplate(getState().templates, "CASH", "2026-06-01T00:00:00Z", "2026-08-01T00:00:00Z") !== undefined, "可定位到重叠模板");

// 收银区无异常 + 窗口不重叠 → 发布成功，版本号 V2
const okPub = publishTemplate({
  areaCode: "CASH",
  name: "收银区 2027 版",
  effectiveStart: "2027-01-01T00:00:00.000Z",
  effectiveEnd: "2027-12-31T16:00:00.000Z",
  devices: seed.templates[2].devices.map((d) => ({ ...d, options: [...d.options] }))
});
assert(okPub.ok && okPub.data.code === "TPL-CASH-V02" && okPub.data.version === 2, "满足条件发布成功，同区域版本号递增为 V2");

// 4. 巡检提交冻结模板
const before = getState();
const submission = submitInspection({
  areaCode: "CASH",
  inspector: "赵敏",
  checkedAt: "2026-06-30T03:00:00.000Z", // 落在 V1 窗口
  values: {
    "CASH-ALARM-01": "在线",
    "CASH-CAM-01": "正常",
    "CASH-EMS-01": "不亮"
  },
  notes: { "CASH-EMS-01": "应急灯不亮，待修" },
  overallNote: ""
});
assert(submission.ok, "按生效模板提交巡检成功");
const recordId = submission.ok ? submission.data.id : "";
const rec = getState().records.find((r) => r.id === recordId)!;
assert(rec.template.code === "TPL-CASH-V01", "提交时冻结的是当时生效的 V1，而非后来发布的 V2");
assert(rec.results.some((r) => r.deviceId === "CASH-EMS-01" && r.verdict === "abnormal"), "异常设备被正确判定");
assert(getState().anomalies.some((a) => a.inspectionId === recordId && a.status === "open"), "异常自动登记台账");

// 旧记录不随新标准重算：用当前的 V1 模板重新冻结一份快照，与记录内快照结构一致、互不共享引用
const cashV1 = before.templates.find((t) => t.code === "TPL-CASH-V01")!;
const snapshotCopy = freezeTemplate(cashV1, new Date().toISOString());
assert(snapshotCopy.devices.length === rec.template.devices.length, "冻结快照与模板结构一致");
assert(snapshotCopy.devices !== rec.template.devices, "快照设备数组是独立拷贝，不共享引用");

// 5. 抽检偏离 → 复核任务 + 复核人必须不同于原巡检人
// 对 INS-001（何鑫，全部正常）的灭火器抽检为"过期" → 偏离
const normalRec = getState().records.find((r) => r.code === "INS-001")!;
const spot = registerSpotCheck({
  inspectionId: normalRec.id,
  refDeviceId: "FUEL-EXT-01",
  checker: "李倩",
  checkedAt: new Date().toISOString(),
  value: "过期",
  note: "压力表指针在红区"
});
assert(spot.ok && spot.data.deviated, "抽检结论偏离原记录");
const task = getState().reviews.find((t) => t.inspectionId === normalRec.id && t.status === "open");
assert(!!task, "偏离后生成待复核任务");

const samePerson = completeReview({ reviewId: task!.id, reviewer: "何鑫", conclusion: "confirm-abnormal", note: "确认" });
assert(!samePerson.ok, "复核人与原巡检人相同时被拒绝");
const otherPerson = completeReview({ reviewId: task!.id, reviewer: "周强", conclusion: "confirm-abnormal", note: "灭火器已更换，确认异常属实" });
assert(otherPerson.ok, "不同复核人可完成复核");
const after = getState();
assert(after.reviews.find((t) => t.id === task!.id)?.status === "closed", "复核任务已闭环");
assert(after.anomalies.find((a) => a.id === task!.anomalyId)?.status === "closed", "复核同时闭环关联异常");

// 6. 重复抽检拒绝
const dup = registerSpotCheck({
  inspectionId: normalRec.id,
  refDeviceId: "FUEL-EXT-01",
  checker: "李倩",
  checkedAt: new Date().toISOString(),
  value: "过期",
  note: ""
});
assert(!dup.ok, "同一设备不能重复抽检");

// 7. 非复核异常可整改闭环，闭环后发布闸门放开
const tankAnomaly = getState().anomalies.find((a) => a.code === "ANM-001")!;
const needHandler = resolveAnomaly(tankAnomaly.id, "", "");
assert(!needHandler.ok, "整改闭环要求责任人与说明");
const resolve = resolveAnomaly(tankAnomaly.id, "何鑫", "密封圈已更换并复检完好");
assert(resolve.ok, "非复核关联异常可登记整改闭环");
const fuelOpen = getState().anomalies.filter((a) => a.areaCode === "FUEL" && a.status === "open");
assert(fuelOpen.length === 2, "加油区仍有 2 条未闭环异常（种子 ANM-002 与 ANM-003），不能发布");
// 全部闭环加油区后再试
for (const anomaly of getState().anomalies.filter((a) => a.areaCode === "FUEL" && a.status === "open")) {
  if (anomaly.reviewTaskId) continue;
  resolveAnomaly(anomaly.id, "何鑫", "整改完成");
}
const stillBlocked = checkPublishBlocker(getState().templates, getState().anomalies, {
  areaCode: "FUEL",
  name: "加油区新版",
  effectiveStart: "2027-01-01T00:00:00.000Z",
  effectiveEnd: "2027-12-31T16:00:00.000Z",
  devices: []
});
// 种子 ANM-003 挂着待复核 RVW-001，所以仍被拦截
assert(!canPublish(stillBlocked), "挂起复核任务的异常未闭环时仍拦截发布");

// 8. 模板结构校验
assert(validateTemplateInput({ areaCode: "FUEL", name: "", effectiveStart: "2027-01-01T00:00:00Z", effectiveEnd: "2027-12-31T16:00:00Z", devices: [] }) !== null, "无名称/无设备的模板不合法");
assert(validateTemplateInput({
  areaCode: "FUEL",
  name: "t",
  effectiveStart: "2027-06-01T00:00:00Z",
  effectiveEnd: "2027-01-01T00:00:00Z",
  devices: []
}) !== null, "起止倒置的模板不合法");

console.log(`\n全部 ${passed} 条断言通过。`);
