import { useEffect, useMemo, useState } from "react";
import { expectedTextOf, verdictLabel } from "../domain/rules";
import type { Anomaly, ReviewTask } from "../domain/types";
import {
  completeReview,
  registerSpotCheck,
  resolveAnomaly,
  useStore
} from "../storage/store";
import { formatDateTime, fromLocalInput, nowIso, toLocalInput } from "../storage/time";
import {
  AnomalyStatusBadge,
  Badge,
  Banner,
  Empty,
  Field,
  ReviewStatusBadge,
  VerdictBadge
} from "./components";

type Tab = "spot" | "review" | "anomaly";

export default function ReviewStation({
  initialTab,
  pendingInspectionId,
  pendingDeviceId,
  consumePending
}: {
  initialTab: Tab;
  pendingInspectionId: string | null;
  pendingDeviceId: string | null;
  consumePending: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div className="station">
      <nav className="tabs">
        <button type="button" className={tab === "spot" ? "tab active" : "tab"} onClick={() => setTab("spot")}>
          抽检登记
        </button>
        <button type="button" className={tab === "review" ? "tab active" : "tab"} onClick={() => setTab("review")}>
          复核任务
        </button>
        <button type="button" className={tab === "anomaly" ? "tab active" : "tab"} onClick={() => setTab("anomaly")}>
          异常台账
        </button>
      </nav>

      {tab === "spot" ? (
        <SpotCheckPanel
          pendingInspectionId={pendingInspectionId}
          pendingDeviceId={pendingDeviceId}
          consumePending={consumePending}
        />
      ) : null}
      {tab === "review" ? <ReviewPanel /> : null}
      {tab === "anomaly" ? <AnomalyPanel /> : null}
    </div>
  );
}

// ---------- 抽检登记 ----------

function SpotCheckPanel({
  pendingInspectionId,
  pendingDeviceId,
  consumePending
}: {
  pendingInspectionId: string | null;
  pendingDeviceId: string | null;
  consumePending: () => void;
}) {
  const db = useStore();
  const [inspectionId, setInspectionId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [checker, setChecker] = useState("");
  const [checkedAt, setCheckedAt] = useState(toLocalInput(nowIso()));
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (pendingInspectionId) {
      setInspectionId(pendingInspectionId);
      setDeviceId(pendingDeviceId ?? "");
      consumePending();
    }
  }, [pendingInspectionId, pendingDeviceId, consumePending]);

  const record = db.records.find((item) => item.id === inspectionId);
  const device = record?.template.devices.find((item) => item.deviceId === deviceId);
  const original = record?.results.find((item) => item.deviceId === deviceId);
  const alreadySpotted =
    record && deviceId
      ? db.spotChecks.some((spot) => spot.inspectionId === record.id && spot.refDeviceId === deviceId)
      : false;

  const liveVerdict = useMemo(() => {
    if (!device || value.trim() === "") return null;
    if (device.kind === "numeric") {
      const num = Number(value);
      if (Number.isNaN(num)) return "abnormal" as const;
      if (device.min !== null && num < device.min) return "abnormal" as const;
      if (device.max !== null && num > device.max) return "abnormal" as const;
      return "normal" as const;
    }
    return value === device.expected ? ("normal" as const) : ("abnormal" as const);
  }, [device, value]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = registerSpotCheck({
      inspectionId,
      refDeviceId: deviceId,
      checker,
      checkedAt: fromLocalInput(checkedAt),
      value,
      note
    });
    if (!result.ok) {
      setError(result.error);
      setSuccess("");
      return;
    }
    setError("");
    setSuccess(
      result.data.deviated
        ? `抽检结论（${verdictLabel[result.data.verdict]}）与原记录（${verdictLabel[result.data.originalVerdict]}）不一致，已生成复核任务`
        : "抽检结论与原记录一致，无需复核"
    );
    setDeviceId("");
    setValue("");
    setNote("");
  }

  return (
    <div className="two-col">
      <form className="panel" onSubmit={handleSubmit}>
        <h2>抽检登记</h2>
        <Banner kind="info">
          抽检按原记录冻结的允许范围判定；结论偏离原记录（正常⇄异常）时自动生成复核任务，复核人必须不同于原巡检人。
        </Banner>
        {error ? <Banner kind="error">{error}</Banner> : null}
        {success ? <Banner kind="success">{success}</Banner> : null}

        <div className="form-grid">
          <Field label="选择巡检记录">
            <select value={inspectionId} onChange={(event) => { setInspectionId(event.target.value); setDeviceId(""); }}>
              <option value="">请选择</option>
              {db.records.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.areaName} · {item.inspector} · {formatDateTime(item.checkedAt)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="抽检设备">
            <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={!record}>
              <option value="">请选择</option>
              {record?.template.devices.map((item) => (
                <option key={item.deviceId} value={item.deviceId}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="抽检人">
            <input value={checker} placeholder="复核发起人，可与巡检人相同" onChange={(event) => setChecker(event.target.value)} />
          </Field>
          <Field label="抽检时间">
            <input type="datetime-local" value={checkedAt} onChange={(event) => setCheckedAt(event.target.value)} />
          </Field>
        </div>

        {record && device && original ? (
          <div className="compare-box">
            <div className="compare-col">
              <span className="field-label">原巡检记录（冻结）</span>
              <p>
                读数 <strong>{original.value}</strong> · <VerdictBadge verdict={original.verdict} />
              </p>
              <p className="hint-text">{expectedTextOf(device)}</p>
            </div>
            <div className="compare-arrow">→</div>
            <div className="compare-col">
              <span className="field-label">本次抽检</span>
              {device.kind === "numeric" ? (
                <input
                  type="number"
                  step="0.01"
                  value={value}
                  placeholder="重新读数"
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <select value={value} onChange={(event) => setValue(event.target.value)}>
                  <option value="">请选择</option>
                  {device.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              )}
              {liveVerdict ? <VerdictBadge verdict={liveVerdict} /> : <span className="hint-text">待读数</span>}
              {liveVerdict && liveVerdict !== original.verdict ? (
                <p className="gate-block">结论偏离原记录，提交后生成复核任务</p>
              ) : liveVerdict ? (
                <p className="gate-ok">结论与原记录一致</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {alreadySpotted ? <Banner kind="error">该设备已抽检过，不能重复登记。</Banner> : null}

        <Field label="抽检说明">
          <textarea value={note} placeholder="现场情况、偏离原因初判" onChange={(event) => setNote(event.target.value)} />
        </Field>

        <div className="actions">
          <button type="submit" disabled={!record || !device || alreadySpotted}>提交抽检</button>
        </div>
      </form>

      <section className="list-panel">
        <div className="toolbar"><h2>抽检历史（{db.spotChecks.length}）</h2></div>
        <div className="record-grid">
          {db.spotChecks.length === 0 ? <Empty text="暂无抽检记录" /> : db.spotChecks.map((spot) => (
            <article className="record" key={spot.id}>
              <div className="record-head">
                <p className="record-title">{spot.deviceName}</p>
                {spot.deviated ? <Badge tone="red">偏离 · 已生成复核</Badge> : <Badge tone="green">一致</Badge>}
              </div>
              <div className="details">
                <span>抽检人：{spot.checker}</span>
                <span>时间：{formatDateTime(spot.checkedAt)}</span>
                <span>原读数 {spot.originalValue}（{verdictLabel[spot.originalVerdict]}）</span>
                <span>抽检读数 {spot.value}（{verdictLabel[spot.verdict]}）</span>
              </div>
              {spot.note ? <p className="note">{spot.note}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------- 复核任务 ----------

function ReviewPanel() {
  const db = useStore();
  const [openOnly, setOpenOnly] = useState(true);
  const tasks = openOnly ? db.reviews.filter((task) => task.status === "open") : db.reviews;

  return (
    <section className="list-panel full">
      <div className="toolbar">
        <h2>复核任务（待处理 {db.reviews.filter((task) => task.status === "open").length}）</h2>
        <label className="inline-check">
          <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
          仅看待复核
        </label>
      </div>
      <p className="panel-tip">抽检结论与原记录不一致时自动生成；完成复核时复核人不能与原巡检人为同一人。</p>
      <div className="record-grid">
        {tasks.length === 0 ? <Empty text="暂无复核任务" /> : tasks.map((task) => (
          <ReviewCard key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}

function ReviewCard({ task }: { task: ReviewTask }) {
  const [reviewer, setReviewer] = useState("");
  const [conclusion, setConclusion] = useState<"confirm-abnormal" | "dismiss">("confirm-abnormal");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = completeReview({ reviewId: task.id, reviewer, conclusion, note });
    if (!result.ok) setError(result.error);
    else setError("");
  }

  return (
    <article className="record record-wide">
      <div className="record-head">
        <p className="record-title">
          {task.code} · {task.areaName} · {task.deviceName}
        </p>
        <ReviewStatusBadge status={task.status} />
      </div>
      <div className="compare-box">
        <div className="compare-col">
          <span className="field-label">原巡检 {task.inspectionCode}（{task.originalInspector}）</span>
          <p>读数 <strong>{task.originalValue}</strong> · <VerdictBadge verdict={task.originalVerdict} /></p>
        </div>
        <div className="compare-arrow">→</div>
        <div className="compare-col">
          <span className="field-label">抽检（{task.spotChecker}）</span>
          <p>读数 <strong>{task.spotValue}</strong> · <VerdictBadge verdict={task.spotVerdict} /></p>
        </div>
      </div>

      {task.status === "open" ? (
        <form onSubmit={handleSubmit} className="review-form">
          {error ? <Banner kind="error">{error}</Banner> : null}
          <Banner kind="info">原巡检人为「{task.originalInspector}」，复核人必须换人。</Banner>
          <div className="device-row-fields">
            <label>
              复核人
              <input
                value={reviewer}
                placeholder={`不得为 ${task.originalInspector}`}
                onChange={(event) => setReviewer(event.target.value)}
              />
              {reviewer.trim() === task.originalInspector ? (
                <span className="gate-block">复核人与原巡检人相同</span>
              ) : null}
            </label>
            <label>
              复核结论
              <select value={conclusion} onChange={(event) => setConclusion(event.target.value as "confirm-abnormal" | "dismiss")}>
                <option value="confirm-abnormal">确认异常（按异常处置并闭环）</option>
                <option value="dismiss">排除异常（原读数失真，闭环）</option>
              </select>
            </label>
            <label className="field-grow">
              复核意见（必填）
              <input value={note} placeholder="依据、处置方式" onChange={(event) => setNote(event.target.value)} />
            </label>
          </div>
          <div className="actions">
            <button type="submit">提交复核并闭环异常</button>
          </div>
        </form>
      ) : (
        <div className="closed-box">
          <div className="details">
            <span>复核人：{task.reviewer}</span>
            <span>复核时间：{formatDateTime(task.reviewedAt ?? "")}</span>
            <span>
              结论：
              {task.conclusion === "confirm-abnormal" ? "确认异常" : "排除异常"}
            </span>
          </div>
          {task.note ? <p className="note">{task.note}</p> : null}
        </div>
      )}
    </article>
  );
}

// ---------- 异常台账 ----------

function AnomalyPanel() {
  const db = useStore();
  const [openOnly, setOpenOnly] = useState(true);
  const anomalies = openOnly
    ? db.anomalies.filter((item) => item.status === "open")
    : db.anomalies;

  return (
    <section className="list-panel full">
      <div className="toolbar">
        <h2>异常台账（未闭环 {db.anomalies.filter((item) => item.status === "open").length}）</h2>
        <label className="inline-check">
          <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
          仅看未闭环
        </label>
      </div>
      <p className="panel-tip">
        异常未闭环前，同区域检查标准只能保存草稿；由抽检偏离生成的异常须在复核任务中闭环。
      </p>
      <div className="record-grid">
        {anomalies.length === 0 ? <Empty text="暂无异常" /> : anomalies.map((anomaly) => (
          <AnomalyCard key={anomaly.id} anomaly={anomaly} />
        ))}
      </div>
    </section>
  );
}

function AnomalyCard({ anomaly }: { anomaly: Anomaly }) {
  const [handler, setHandler] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function handleResolve(event: React.FormEvent) {
    event.preventDefault();
    const result = resolveAnomaly(anomaly.id, handler, reason);
    if (!result.ok) setError(result.error);
    else setError("");
  }

  return (
    <article className="record">
      <div className="record-head">
        <p className="record-title">
          {anomaly.code} · {anomaly.deviceName}
        </p>
        <AnomalyStatusBadge status={anomaly.status} />
      </div>
      <div className="details">
        <span>区域：{anomaly.areaName}</span>
        <span>来源：{anomaly.inspectionCode}</span>
        <span>指标：{anomaly.metric}</span>
        <span>读数：{anomaly.value}</span>
        <span>判定依据：{anomaly.expectedText}</span>
        <span>巡检人：{anomaly.inspector}</span>
        <span>发现时间：{formatDateTime(anomaly.openedAt)}</span>
        {anomaly.reviewTaskId ? <Badge tone="amber">须经复核闭环</Badge> : null}
      </div>

      {anomaly.status === "open" ? (
        anomaly.reviewTaskId ? (
          <Banner kind="info">该异常由抽检偏离生成，请在「复核任务」页签完成复核后自动闭环。</Banner>
        ) : (
          <form onSubmit={handleResolve} className="review-form">
            {error ? <Banner kind="error">{error}</Banner> : null}
            <div className="device-row-fields">
              <label>
                整改责任人
                <input value={handler} onChange={(event) => setHandler(event.target.value)} placeholder="填写姓名" />
              </label>
              <label className="field-grow">
                整改说明
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="如：密封圈已更换并复检合格" />
              </label>
            </div>
            <div className="actions">
              <button type="submit">登记整改并闭环</button>
            </div>
          </form>
        )
      ) : (
        <div className="closed-box">
          <div className="details">
            <span>闭环人：{anomaly.closedBy}</span>
            <span>闭环时间：{formatDateTime(anomaly.closedAt ?? "")}</span>
          </div>
          {anomaly.closeReason ? <p className="note">{anomaly.closeReason}</p> : null}
        </div>
      )}
    </article>
  );
}
