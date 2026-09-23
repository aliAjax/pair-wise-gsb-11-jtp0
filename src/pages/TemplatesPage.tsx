import { useMemo, useState } from "react";
import { AREAS, areaOf, areaNameOf } from "../domain/catalog";
import {
  checkPublishBlocker,
  expectedTextOf,
  rangeText,
  requirementFromSpec
} from "../domain/rules";
import type { DeviceKind, DeviceRequirement, InspectionTemplate } from "../domain/types";
import {
  deleteTemplate,
  draftFromTemplate,
  getState,
  publishTemplate,
  saveTemplateDraft,
  useStore
} from "../storage/store";
import { formatRange, fromLocalInput, toLocalInput } from "../storage/time";
import { Banner, Empty, Field, TemplateStatusBadge } from "./components";

/** 页面内使用的设备行（范围以文本编辑，空串表示该侧不限） */
interface DeviceRow {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  metric: string;
  minText: string;
  maxText: string;
  options: string[];
  expected: string;
}

interface TemplateFormState {
  areaCode: string;
  name: string;
  start: string;
  end: string;
  rows: DeviceRow[];
}

function rowsForArea(areaCode: string): DeviceRow[] {
  return (areaOf(areaCode)?.devices ?? []).map((spec) => {
    const req = requirementFromSpec(spec);
    return {
      deviceId: req.deviceId,
      name: req.name,
      kind: req.kind,
      metric: req.metric,
      minText: req.min === null ? "" : String(req.min),
      maxText: req.max === null ? "" : String(req.max),
      options: req.options,
      expected: req.expected
    };
  });
}

function blankForm(): TemplateFormState {
  return {
    areaCode: AREAS[0].code,
    name: "",
    start: "",
    end: "",
    rows: rowsForArea(AREAS[0].code)
  };
}

function rowsFromTemplate(template: InspectionTemplate): DeviceRow[] {
  return template.devices.map((device) => ({
    deviceId: device.deviceId,
    name: device.name,
    kind: device.kind,
    metric: device.metric,
    minText: device.min === null ? "" : String(device.min),
    maxText: device.max === null ? "" : String(device.max),
    options: [...device.options],
    expected: device.expected
  }));
}

function toRequirements(rows: DeviceRow[]): DeviceRequirement[] {
  return rows.map((row) => ({
    deviceId: row.deviceId,
    name: row.name.trim(),
    kind: row.kind,
    metric: row.metric.trim() || "状态",
    min: row.minText.trim() === "" ? null : Number(row.minText),
    max: row.maxText.trim() === "" ? null : Number(row.maxText),
    options: [...row.options],
    expected: row.expected
  }));
}

function safeIso(value: string): string {
  return value ? fromLocalInput(value) : "";
}

export default function TemplatesPage() {
  const db = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormState>(blankForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const openAnomalyCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of db.anomalies) {
      if (item.status === "open") counts.set(item.areaCode, (counts.get(item.areaCode) ?? 0) + 1);
    }
    return counts;
  }, [db.anomalies]);

  /** 当前表单若发布，会被什么规则拦住（实时提示；设备结构校验在提交时进行） */
  const liveBlocker = useMemo(() => {
    if (!form.start || !form.end) return null;
    return checkPublishBlocker(db.templates, db.anomalies, {
      id: editingId ?? undefined,
      areaCode: form.areaCode,
      name: form.name,
      effectiveStart: safeIso(form.start),
      effectiveEnd: safeIso(form.end),
      devices: []
    });
  }, [form.areaCode, form.start, form.end, form.name, editingId, db.templates, db.anomalies]);

  function patch(next: Partial<TemplateFormState>) {
    setForm((prev) => ({ ...prev, ...next }));
    setError("");
    setSuccess("");
  }

  function changeArea(areaCode: string) {
    patch({ areaCode, rows: rowsForArea(areaCode), name: "" });
  }

  function patchRow(deviceId: string, rowPatch: Partial<DeviceRow>) {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.deviceId === deviceId ? { ...row, ...rowPatch } : row))
    }));
  }

  function addDevice(specDeviceId: string) {
    const spec = areaOf(form.areaCode)?.devices.find((item) => item.deviceId === specDeviceId);
    if (!spec) return;
    const req = requirementFromSpec(spec);
    setForm((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        {
          deviceId: req.deviceId,
          name: req.name,
          kind: req.kind,
          metric: req.metric,
          minText: req.min === null ? "" : String(req.min),
          maxText: req.max === null ? "" : String(req.max),
          options: req.options,
          expected: req.expected
        }
      ]
    }));
  }

  function removeRow(deviceId: string) {
    setForm((prev) => ({ ...prev, rows: prev.rows.filter((row) => row.deviceId !== deviceId) }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(blankForm());
    setError("");
    setSuccess("");
  }

  function startEdit(template: InspectionTemplate) {
    setEditingId(template.id);
    setForm({
      areaCode: template.areaCode,
      name: template.name,
      start: toLocalInput(template.effectiveStart),
      end: toLocalInput(template.effectiveEnd),
      rows: rowsFromTemplate(template)
    });
    setError("");
    setSuccess("");
  }

  function newVersion(template: InspectionTemplate) {
    const result = draftFromTemplate(template.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const created = getState().templates.find((item) => item.id === result.data.id);
    if (created) startEdit(created);
    setSuccess(`已基于 ${template.code} 创建新版草稿，请调整生效时间或允许范围后发布`);
  }

  function buildInput() {
    return {
      id: editingId ?? undefined,
      areaCode: form.areaCode,
      name: form.name.trim(),
      effectiveStart: safeIso(form.start),
      effectiveEnd: safeIso(form.end),
      devices: toRequirements(form.rows)
    };
  }

  function handleDraft() {
    const result = saveTemplateDraft(buildInput());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(editingId ? "草稿已更新" : "已保存为草稿，可在异常闭环且窗口无冲突后发布");
    setError("");
  }

  function handlePublish() {
    const result = publishTemplate(buildInput());
    if (!result.ok) {
      setError(result.error);
      setSuccess("");
      return;
    }
    setSuccess(`标准 ${result.data.code} 已发布生效，之后提交的巡检将冻结此版本`);
    setError("");
    setEditingId(null);
    setForm(blankForm());
  }

  function handleDelete(template: InspectionTemplate) {
    const result = deleteTemplate(template.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (editingId === template.id) resetForm();
  }

  const usedDeviceIds = new Set(form.rows.map((row) => row.deviceId));
  const addableDevices =
    areaOf(form.areaCode)?.devices.filter((spec) => !usedDeviceIds.has(spec.deviceId)) ?? [];

  return (
    <div className="two-col">
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          handlePublish();
        }}
      >
        <h2>{editingId ? "编辑标准草稿" : "发布检查模板"}</h2>
        <Banner kind="info">
          同区域已发布模板的生效时间窗口不得重叠；区域内存在未闭环异常时，只能保存草稿。
        </Banner>
        {error ? <Banner kind="error">{error}</Banner> : null}
        {success ? <Banner kind="success">{success}</Banner> : null}

        <div className="form-grid">
          <Field label="所属区域">
            <select value={form.areaCode} onChange={(event) => changeArea(event.target.value)}>
              {AREAS.map((area) => (
                <option key={area.code} value={area.code}>
                  {area.name}
                  {openAnomalyCount.get(area.code)
                    ? `（${openAnomalyCount.get(area.code)} 条未闭环）`
                    : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="模板名称">
            <input
              value={form.name}
              placeholder="如：加油区设备巡检标准（2026 夏季版）"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <Field label="生效开始时间">
            <input
              type="datetime-local"
              value={form.start}
              onChange={(event) => patch({ start: event.target.value })}
            />
          </Field>
          <Field label="生效结束时间">
            <input
              type="datetime-local"
              value={form.end}
              onChange={(event) => patch({ end: event.target.value })}
            />
          </Field>
        </div>

        {liveBlocker ? (
          <div className="gate-hints">
            {liveBlocker.overlap ? (
              <p className="gate-block">
                ✕ 窗口与 {liveBlocker.overlap.code}《{liveBlocker.overlap.name}》（
                {formatRange(liveBlocker.overlap.effectiveStart, liveBlocker.overlap.effectiveEnd)}
                ）重叠
              </p>
            ) : (
              <p className="gate-ok">✓ 同区域生效窗口无重叠</p>
            )}
            {liveBlocker.openAnomalies.length > 0 ? (
              <p className="gate-block">
                ✕ 该区域有 {liveBlocker.openAnomalies.length} 条未闭环异常，发布将被拦截
              </p>
            ) : (
              <p className="gate-ok">✓ 该区域无未闭环异常</p>
            )}
          </div>
        ) : null}

        <div className="device-editor">
          <div className="device-editor-head">
            <h3>必检设备与允许范围</h3>
            {addableDevices.length > 0 ? (
              <select value="" onChange={(event) => event.target.value && addDevice(event.target.value)}>
                <option value="">＋ 添加设备</option>
                {addableDevices.map((spec) => (
                  <option key={spec.deviceId} value={spec.deviceId}>
                    {spec.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {form.rows.length === 0 ? (
            <Empty text="尚未登记必检设备" />
          ) : (
            <div className="device-rows">
              {form.rows.map((row) => (
                <div className="device-row" key={row.deviceId}>
                  <div className="device-row-title">
                    <strong>{row.name}</strong>
                    <span className="device-id">{row.deviceId}</span>
                    <button
                      type="button"
                      className="link-danger"
                      onClick={() => removeRow(row.deviceId)}
                    >
                      移除
                    </button>
                  </div>
                  <div className="device-row-fields">
                    <label>
                      指标
                      <input
                        value={row.metric}
                        onChange={(event) => patchRow(row.deviceId, { metric: event.target.value })}
                      />
                    </label>
                    {row.kind === "numeric" ? (
                      <>
                        <label>
                          下限（空=不限）
                          <input
                            type="number"
                            step="0.01"
                            value={row.minText}
                            onChange={(event) => patchRow(row.deviceId, { minText: event.target.value })}
                          />
                        </label>
                        <label>
                          上限（空=不限）
                          <input
                            type="number"
                            step="0.01"
                            value={row.maxText}
                            onChange={(event) => patchRow(row.deviceId, { maxText: event.target.value })}
                          />
                        </label>
                      </>
                    ) : (
                      <label>
                        期望项
                        <select
                          value={row.expected}
                          onChange={(event) => patchRow(row.deviceId, { expected: event.target.value })}
                        >
                          {row.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="actions">
          <button type="submit">发布标准</button>
          <button type="button" className="secondary" onClick={handleDraft}>
            保存草稿
          </button>
          {editingId ? (
            <button type="button" className="secondary" onClick={resetForm}>
              放弃编辑
            </button>
          ) : null}
        </div>
      </form>

      <section className="list-panel">
        <div className="toolbar">
          <h2>标准版本（{db.templates.length}）</h2>
        </div>
        <p className="panel-tip">
          按区域查看已发布版本与草稿。已发布版本不可修改、删除，改版请创建新版本；旧巡检记录仍保留各自冻结的旧版本。
        </p>
        <div className="record-grid">
          {db.templates.length === 0 ? (
            <Empty text="还没有检查模板" />
          ) : (
            db.templates.map((template) => (
              <article className="record" key={template.id}>
                <div className="record-head">
                  <p className="record-title">
                    {template.status === "published" ? template.code : "草稿"} · {template.name}
                  </p>
                  <TemplateStatusBadge status={template.status} />
                </div>
                <div className="details">
                  <span>区域：{areaNameOf(template.areaCode)}</span>
                  <span>版本：V{String(template.version).padStart(2, "0")}</span>
                  <span className="details-wide">
                    生效窗口：{formatRange(template.effectiveStart, template.effectiveEnd)}
                  </span>
                </div>
                <div className="chips">
                  {template.devices.map((device) => (
                    <span className="chip" key={device.deviceId} title={expectedTextOf(device)}>
                      {device.name}
                      <em>
                        {device.kind === "numeric"
                          ? rangeText(device.min, device.max)
                          : `应为${device.expected}`}
                      </em>
                    </span>
                  ))}
                </div>
                <div className="actions">
                  {template.status === "draft" ? (
                    <>
                      <button type="button" onClick={() => startEdit(template)}>
                        编辑
                      </button>
                      <button type="button" className="danger" onClick={() => handleDelete(template)}>
                        删除草稿
                      </button>
                    </>
                  ) : (
                    <button type="button" className="secondary" onClick={() => newVersion(template)}>
                      基于此版建新版草稿
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
