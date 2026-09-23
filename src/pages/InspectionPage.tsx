import { useMemo, useState } from "react";
import { AREAS, areaNameOf } from "../domain/catalog";
import { activeTemplateAt, expectedTextOf } from "../domain/rules";
import { useStore, submitInspection } from "../storage/store";
import { formatDateTime, formatRange, fromLocalInput, nowIso, toLocalInput } from "../storage/time";
import { Banner, Empty, Field, VerdictBadge } from "./components";

export default function InspectionPage() {
  const db = useStore();
  const [areaCode, setAreaCode] = useState(AREAS[0].code);
  const [inspector, setInspector] = useState("");
  const [checkedAt, setCheckedAt] = useState(toLocalInput(nowIso()));
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [overallNote, setOverallNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const checkedIso = checkedAt ? fromLocalInput(checkedAt) : "";
  const template = useMemo(
    () => (checkedIso ? activeTemplateAt(db.templates, areaCode, checkedIso) : undefined),
    [db.templates, areaCode, checkedIso]
  );

  function resetForm() {
    setInspector("");
    setValues({});
    setNotes({});
    setOverallNote("");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = submitInspection({
      areaCode,
      inspector,
      checkedAt: checkedIso,
      values,
      notes,
      overallNote
    });
    if (!result.ok) {
      setError(result.error);
      setSuccess("");
      return;
    }
    setError("");
    setSuccess(
      `巡检 ${result.data.code} 已提交，已冻结标准 ${result.data.template.code}，后续模板改版不会重算本记录。`
    );
    resetForm();
  }

  const abnormalCount = template
    ? template.devices.filter((device) => {
        const value = values[device.deviceId];
        return value !== undefined && value !== "" && judgeLive(device, value) === "abnormal";
      }).length
    : 0;

  return (
    <div className="two-col">
      <form className="panel" onSubmit={handleSubmit}>
        <h2>现场巡检填报</h2>
        {error ? <Banner kind="error">{error}</Banner> : null}
        {success ? <Banner kind="success">{success}</Banner> : null}

        <div className="form-grid">
          <Field label="巡检区域">
            <select value={areaCode} onChange={(event) => { setAreaCode(event.target.value); setValues({}); setNotes({}); }}>
              {AREAS.map((area) => (
                <option key={area.code} value={area.code}>{area.name}</option>
              ))}
            </select>
          </Field>
          <Field label="巡检人">
            <input value={inspector} placeholder="填写巡检人姓名" onChange={(event) => setInspector(event.target.value)} />
          </Field>
          <Field label="巡检时间" hint="按此时间匹配当时生效的标准版本">
            <input type="datetime-local" value={checkedAt} onChange={(event) => setCheckedAt(event.target.value)} />
          </Field>
        </div>

        {!template ? (
          <Banner kind="error">
            {areaNameOf(areaCode)}在所选时间没有生效中的检查标准，请管理员先发布模板或调整巡检时间。
          </Banner>
        ) : (
          <div className="frozen-box">
            <div className="frozen-head">
              <strong>{template.code} · {template.name}</strong>
              <span>V{String(template.version).padStart(2, "0")}</span>
            </div>
            <p className="panel-tip">生效窗口：{formatRange(template.effectiveStart, template.effectiveEnd)}</p>
            <p className="panel-tip">提交时冻结该标准快照，共 {template.devices.length} 台必检设备。</p>

            <div className="inspect-rows">
              {template.devices.map((device) => {
                const value = values[device.deviceId] ?? "";
                const liveVerdict = value.trim() === "" ? null : judgeLive(device, value);
                return (
                  <div className="inspect-row" key={device.deviceId}>
                    <div className="inspect-row-head">
                      <strong>{device.name}</strong>
                      <span className="device-id">{device.deviceId}</span>
                      {liveVerdict ? <VerdictBadge verdict={liveVerdict} /> : <span className="hint-text">待读数</span>}
                    </div>
                    <div className="inspect-row-body">
                      <label>
                        {device.metric}（{expectedTextOf(device)}）
                        {device.kind === "numeric" ? (
                          <input
                            type="number"
                            step="0.01"
                            value={value}
                            placeholder="填写实测数值"
                            onChange={(event) => setValues((prev) => ({ ...prev, [device.deviceId]: event.target.value }))}
                          />
                        ) : (
                          <select value={value} onChange={(event) => setValues((prev) => ({ ...prev, [device.deviceId]: event.target.value }))}>
                            <option value="">请选择</option>
                            {device.options.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        )}
                      </label>
                      <label>
                        设备备注{liveVerdict === "abnormal" ? "（异常必填）" : ""}
                        <input
                          value={notes[device.deviceId] ?? ""}
                          placeholder={liveVerdict === "abnormal" ? "请描述异常情况" : "选填"}
                          onChange={(event) => setNotes((prev) => ({ ...prev, [device.deviceId]: event.target.value }))}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <Field label="巡检总备注">
              <textarea value={overallNote} placeholder="现场整体情况、处理说明" onChange={(event) => setOverallNote(event.target.value)} />
            </Field>
          </div>
        )}

        <div className="actions">
          <button type="submit" disabled={!template}>提交巡检并冻结标准</button>
          {template && abnormalCount > 0 ? (
            <span className="hint-text">当前 {abnormalCount} 台设备读数超出允许范围，提交后将登记异常</span>
          ) : null}
        </div>
      </form>

      <section className="list-panel">
        <div className="toolbar">
          <h2>今日生效标准一览</h2>
        </div>
        <p className="panel-tip">标准在生效窗口内对巡检开放；窗口外的历史版本仅保留在旧巡检记录中。</p>
        <div className="record-grid">
          {AREAS.map((area) => {
            const active = activeTemplateAt(db.templates, area.code, nowIso());
            return (
              <article className="record" key={area.code}>
                <div className="record-head">
                  <p className="record-title">{area.name}</p>
                  {active ? <span className="badge tone-green">有生效标准</span> : <span className="badge tone-gray">无生效标准</span>}
                </div>
                {active ? (
                  <div className="details">
                    <span>{active.code}</span>
                    <span>V{String(active.version).padStart(2, "0")} · {active.devices.length} 台必检</span>
                    <span className="details-wide">生效至 {formatDateTime(active.effectiveEnd)}</span>
                  </div>
                ) : (
                  <Empty text="当前时间无覆盖此区域的生效窗口" />
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function judgeLive(
  device: { kind: "numeric" | "choice"; min: number | null; max: number | null; expected: string },
  value: string
) {
  if (device.kind === "numeric") {
    const num = Number(value);
    if (Number.isNaN(num)) return "abnormal" as const;
    if (device.min !== null && num < device.min) return "abnormal" as const;
    if (device.max !== null && num > device.max) return "abnormal" as const;
    return "normal" as const;
  }
  return value === device.expected ? ("normal" as const) : ("abnormal" as const);
}
