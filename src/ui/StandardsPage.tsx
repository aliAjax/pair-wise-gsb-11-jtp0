// 标准管理页：按区域维护检查模板、必检设备、允许范围与生效窗口
import { useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Popconfirm, Select, Space, Switch, Tag, message } from "antd";
import { publishBlockers, type ItemDraft } from "../domain/rules";
import { AREAS } from "../domain/standards";
import type { InspectionTemplate, ItemType } from "../domain/types";
import { useStore } from "../store/useStore";
import { fmtDateTime } from "./shared";

interface ItemRow extends ItemDraft {
  key: string;
}

function blankRow(): ItemRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    device: "",
    type: "number",
    unit: "",
    min: "",
    max: "",
    options: "",
    required: true,
  };
}

function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rowsFromTemplate(template: InspectionTemplate): ItemRow[] {
  return template.items.map((item) => ({
    key: item.id,
    name: item.name,
    device: item.device,
    type: item.type,
    unit: item.unit ?? "",
    min: item.min === undefined ? "" : String(item.min),
    max: item.max === undefined ? "" : String(item.max),
    options: item.options?.join(", ") ?? "",
    required: item.required,
  }));
}

function blankForm() {
  return {
    name: "",
    area: AREAS[0],
    start: "",
    end: "",
    rows: [blankRow()],
  };
}

export default function StandardsPage() {
  const templates = useStore((state) => state.templates);
  const records = useStore((state) => state.records);
  const tasks = useStore((state) => state.tasks);
  const saveTemplateDraft = useStore((state) => state.saveTemplateDraft);
  const publishTemplate = useStore((state) => state.publishTemplate);
  const deleteTemplate = useStore((state) => state.deleteTemplate);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState<string>(AREAS[0]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([blankRow()]);
  const [messageApi, contextHolder] = message.useMessage();

  const [areaFilter, setAreaFilter] = useState<string>(AREAS[0]);

  const sortedTemplates = useMemo(() => {
    return templates
      .filter((template) => template.area === areaFilter)
      .sort((a, b) => (a.window.start < b.window.start ? 1 : -1))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "draft" ? -1 : 1));
  }, [templates, areaFilter]);

  const blockerState = useMemo(
    () => ({ version: 2 as const, templates, records, tasks }),
    [templates, records, tasks]
  );

  function resetForm() {
    const next = blankForm();
    setEditingId(null);
    setName(next.name);
    setArea(areaFilter);
    setStart(next.start);
    setEnd(next.end);
    setRows(next.rows);
  }

  function fillFromTemplate(template: InspectionTemplate, asNewVersion: boolean) {
    setEditingId(asNewVersion ? null : template.id);
    setName(template.name);
    setArea(template.area);
    if (asNewVersion) {
      const nextStart = shiftDate(template.window.end, 1);
      setStart(nextStart);
      setEnd(shiftDate(nextStart, 29));
    } else {
      setStart(template.window.start);
      setEnd(template.window.end);
    }
    setRows(rowsFromTemplate(template));
  }

  function patchRow(key: string, patch: Partial<ItemRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  }

  function handleSave() {
    const result = saveTemplateDraft({
      id: editingId ?? undefined,
      name,
      area,
      window: { start, end },
      items: rows.map(({ key: _key, ...rest }) => rest),
    });
    if (!result.ok) {
      messageApi.error(result.error ?? "保存失败");
      return;
    }
    messageApi.success(editingId ? "草稿已更新" : "草稿已保存");
    resetForm();
  }

  function handlePublish(id: string) {
    const result = publishTemplate(id);
    if (result.ok) messageApi.success("模板已发布生效");
    else messageApi.error(result.error ?? "发布失败");
  }

  return (
    <div className="page">
      {contextHolder}
      <Alert
        className="rule-banner"
        type="info"
        showIcon
        message="发布规则：同一区域生效窗口不得重叠；区域内存在未闭环异常时只能保存草稿；已生效模板不可修改，可基于其新建版本。"
      />
      <div className="two-col">
        <Card
          className="editor"
          title={editingId ? "编辑草稿模板" : "新建检查模板"}
          extra={
            editingId ? (
              <Button size="small" onClick={resetForm}>
                取消编辑
              </Button>
            ) : null
          }
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <label className="field">
              <span>模板名称</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例：加油区日常巡检标准" />
            </label>
            <label className="field">
              <span>适用区域</span>
              <Select value={area} onChange={setArea} style={{ width: "100%" }} options={AREAS.map((item) => ({ value: item, label: item }))} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>生效开始</span>
                <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label className="field">
                <span>生效结束</span>
                <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
            </div>

            <div className="item-editor-head">
              <strong>必检设备与允许范围</strong>
              <Button size="small" type="dashed" onClick={() => setRows((current) => [...current, blankRow()])}>
                添加一项
              </Button>
            </div>

            {rows.map((row, index) => (
              <Card key={row.key} size="small" className="item-card" title={`检查项 ${index + 1}`}
                extra={
                  rows.length > 1 ? (
                    <Button size="small" danger type="text" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>
                      移除
                    </Button>
                  ) : null
                }
              >
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <div className="field-row">
                    <label className="field">
                      <span>设备</span>
                      <Input value={row.device} onChange={(event) => patchRow(row.key, { device: event.target.value })} placeholder="例：1号加油机" />
                    </label>
                    <label className="field">
                      <span>检查项</span>
                      <Input value={row.name} onChange={(event) => patchRow(row.key, { name: event.target.value })} placeholder="例：出口压力" />
                    </label>
                  </div>
                  <div className="field-row">
                    <label className="field">
                      <span>记录方式</span>
                      <Select
                        value={row.type}
                        style={{ width: "100%" }}
                        onChange={(value) => patchRow(row.key, { type: value as ItemType })}
                        options={[{ value: "number", label: "数值（范围判定）" }, { value: "select", label: "选择（选项判定）" }]}
                      />
                    </label>
                    {row.type === "number" ? (
                      <label className="field">
                        <span>单位</span>
                        <Input value={row.unit} onChange={(event) => patchRow(row.key, { unit: event.target.value })} placeholder="例：MPa" />
                      </label>
                    ) : null}
                  </div>
                  {row.type === "number" ? (
                    <div className="field-row">
                      <label className="field">
                        <span>允许下限</span>
                        <Input value={row.min} onChange={(event) => patchRow(row.key, { min: event.target.value })} placeholder="0.15" />
                      </label>
                      <label className="field">
                        <span>允许上限</span>
                        <Input value={row.max} onChange={(event) => patchRow(row.key, { max: event.target.value })} placeholder="0.3" />
                      </label>
                    </div>
                  ) : (
                    <label className="field">
                      <span>可选值（逗号分隔，首个为正常项，其余判异常）</span>
                      <Input value={row.options} onChange={(event) => patchRow(row.key, { options: event.target.value })} placeholder="完好, 老化, 渗漏" />
                    </label>
                  )}
                  <label className="switch-field">
                    <Switch checked={row.required} onChange={(checked) => patchRow(row.key, { required: checked })} />
                    <span>必检项（提交时必须填写）</span>
                  </label>
                </Space>
              </Card>
            ))}

            <Button type="primary" block onClick={handleSave}>
              保存草稿
            </Button>
          </Space>
        </Card>

        <div className="template-list">
          <Card
            size="small"
            title="区域模板"
            extra={
              <Select
                size="small"
                value={areaFilter}
                onChange={(value) => {
                  setAreaFilter(value);
                  if (!editingId) setArea(value);
                }}
                style={{ width: 110 }}
                options={AREAS.map((item) => ({ value: item, label: item }))}
              />
            }
          >
            {sortedTemplates.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该区域暂无模板" />
            ) : (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {sortedTemplates.map((template) => {
                  const blockers =
                    template.status === "draft" ? publishBlockers(blockerState, template) : [];
                  return (
                    <Card key={template.id} size="small" className="template-card">
                      <div className="template-head">
                        <div>
                          <strong>{template.name}</strong>
                          <Tag className="version-tag">v{template.version}</Tag>
                        </div>
                        {template.status === "published" ? <Tag color="green">已生效</Tag> : <Tag color="orange">草稿</Tag>}
                      </div>
                      <p className="template-window">
                        生效窗口：{template.window.start} ~ {template.window.end}
                        {template.publishedAt ? `　发布于 ${fmtDateTime(template.publishedAt)}` : ""}
                      </p>
                      <ul className="item-summary">
                        {template.items.map((item) => (
                          <li key={item.id}>
                            {item.device} · {item.name}
                            {item.type === "number"
                              ? `（允许 ${item.min}~${item.max}${item.unit ?? ""}）`
                              : `（${item.options?.join("/")}）`}
                            {item.required ? <Tag color="blue">必检</Tag> : null}
                          </li>
                        ))}
                      </ul>
                      {template.status === "draft" && blockers.length > 0 ? (
                        <Alert className="block-alert" type="warning" showIcon message={blockers.join("；")} />
                      ) : null}
                      <Space wrap>
                        {template.status === "draft" ? (
                          <>
                            <Button size="small" type="primary" onClick={() => handlePublish(template.id)}>
                              发布生效
                            </Button>
                            <Button size="small" onClick={() => fillFromTemplate(template, false)}>
                              编辑
                            </Button>
                            <Popconfirm
                              title="删除该草稿？"
                              onConfirm={() => {
                                deleteTemplate(template.id);
                                if (editingId === template.id) resetForm();
                                messageApi.success("草稿已删除");
                              }}
                            >
                              <Button size="small" danger>
                                删除
                              </Button>
                            </Popconfirm>
                          </>
                        ) : (
                          <Button size="small" onClick={() => fillFromTemplate(template, true)}>
                            基于此版新建版本
                          </Button>
                        )}
                      </Space>
                    </Card>
                  );
                })}
              </Space>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
