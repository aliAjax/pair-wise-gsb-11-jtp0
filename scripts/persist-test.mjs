import { build } from "esbuild";
import { writeFileSync } from "fs";
import { execSync } from "child_process";

const SHIM = `
class M {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
globalThis.localStorage = new M();
`;

async function bundle(source) {
  const result = await build({
    stdin: { contents: source, resolveDir: process.cwd() },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false
  });
  return result.outputFiles[0].text;
}

// 阶段一：全新加载 → 写种子 → 发布 V2 → 提交一条巡检 → 打印落盘内容
const phase1 = `${SHIM}
const s = await import("./src/storage/store.ts");
s.resetToSeed();
const pub = s.publishTemplate({
  areaCode: "CASH", name: "窗口外新版",
  effectiveStart: "2030-01-01T00:00:00.000Z",
  effectiveEnd: "2030-12-31T16:00:00.000Z",
  devices: s.getState().templates.find((t) => t.code === "TPL-CASH-V01").devices
    .map((d) => ({ ...d, options: [...d.options] }))
});
if (!pub.ok) throw new Error(pub.error);
const sub = s.submitInspection({
  areaCode: "TANK", inspector: "测试员",
  checkedAt: "2026-08-01T02:00:00.000Z",
  values: {
    "TANK-SEAL-01": "完好", "TANK-STATIC-01": "12",
    "TANK-LVL-01": "0", "TANK-VENT-01": "通畅"
  },
  notes: {}, overallNote: "持久化测试"
});
if (!sub.ok) throw new Error(sub.error);
console.log(JSON.stringify({
  snapshotCode: sub.data.template.code,
  snapshotDevices: sub.data.template.devices.length,
  storage: localStorage.getItem("dfwlfront-10-inspection-standards-v1")
}));
`;
writeFileSync("/tmp/p1.mjs", await bundle(phase1));
const dump = JSON.parse(execSync("node /tmp/p1.mjs").toString().trim());

// 阶段二：另一个全新模块实例，只注入阶段一落盘的 localStorage（模拟刷新）
const phase2 = `${SHIM}
globalThis.localStorage.setItem(
  "dfwlfront-10-inspection-standards-v1",
  ${JSON.stringify(dump.storage)}
);
const s = await import("./src/storage/store.ts");
const db = s.getState();
const newest = db.records[0];
console.log(JSON.stringify({
  templates: db.templates.length,
  records: db.records.length,
  anomalies: db.anomalies.length,
  reviews: db.reviews.length,
  v2Exists: db.templates.some((t) => t.code === "TPL-CASH-V02"),
  newestCode: newest.code,
  newestSnapshot: newest.template.code,
  newestSnapshotDevices: newest.template.devices.length,
  reviewConsistent: db.reviews[0]?.code === "RVW-001"
    && db.anomalies.some((a) => a.id === db.reviews[0].anomalyId && a.reviewTaskId === db.reviews[0].id)
}));
`;
writeFileSync("/tmp/p2.mjs", await bundle(phase2));
const after = JSON.parse(execSync("node /tmp/p2.mjs").toString().trim());

if (!after.v2Exists) throw new Error("刷新后丢失新发布的 V2 模板");
if (after.templates !== 4) throw new Error("刷新后模板数量不一致");
if (after.records !== 4) throw new Error("刷新后巡检记录数量不一致");
if (after.newestCode !== "INS-004") throw new Error("新巡检编号异常: " + after.newestCode);
if (after.newestSnapshot !== dump.snapshotCode) throw new Error("刷新后记录的冻结快照版本被重算");
if (after.newestSnapshotDevices !== dump.snapshotDevices) throw new Error("刷新后快照设备数变化");
if (!after.reviewConsistent) throw new Error("复核任务与异常的关联在刷新后断裂");
console.log("✓ 模拟刷新后模板、巡检快照、异常与复核任务完全一致:", JSON.stringify(after));
