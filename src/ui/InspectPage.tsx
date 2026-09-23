// 巡检填报页：按当前生效模板录入，提交时冻结模板版本快照
import { useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Select, Space, Tag, message } from "antd";
import { effectiveTemplate, judgeValue } from "../domain/rules";
import { AREAS, INSPECTORS } from "../domain/standards";
import { useStore } from "../store/useStore";
import { JudgementTag, rangeText } from "./shared";

function nowLocal(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default function InspectPage() {
  const templates = useStore((state) => state.templates);
  const submitInspection = useStore((state) => state.submitInspection);

  const [area, setArea] = useState<string>(AREAS[0]);
  const [inspector, setInspector] = useState("");
  const [inspectedAt, setInspectedAt] = useState(nowLocal);
  const [values, setValues] = useState<Record<string, string>>({});
  const [messageApi, contextHolder] = message.useMessage();

  const date = inspectedAt.slice(0, 10);
  const template = useMemo(
    () => effectiveTemplate(templates, area, date),
    [templates, area, date]
  );

  function handleSubmit() {
    if (!template) return;
    const result = submitInspection({ area, inspector, inspectedAt, template, values });
    if (!result.ok) {
      messageApi.error(result.error ?? "提交失败");
      return;
    }
    messageApi.success(`已提交，冻结模板版本 v${template.version}，旧记录不随新标准重算`);
    setValues({});
    setInspectedAt(nowLocal());
  }

  return (
    <div className="page">
      {contextHolder}
      <Card title="巡检填报" size="small">
        <div className="field-row three">
          <label className="field">
            <span>区域</span>
            <Select
              value={area}
              onChange={(value) => {
                setArea(value);
                setValues({});
              }}
              style={{ width: "100%" }}
              options={AREAS.map((item) => ({ value: item, label: item }))}
            />
          </label>
          <label className="field">
            <span>巡检人</span>
            <Input
              value={inspector}
              onChange={(event) => setInspector(event.target.value)}
              placeholder="姓名"
              list="inspector-options"
            />
          </label>
          <label className="field">
            <span>巡检时间</span>
            <input
              type="datetime-local"
              value={inspectedAt}
              onChange={(event) => {
                setInspectedAt(event.target.value);
                setValues({});
              }}
            />
          </label>
        </div>
        <datalist id="inspector-options">
          {INSPECTORS.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </Card>

      {!template ? (
        <Card size="small">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`${area}在 ${date || "所选日期"} 没有生效中的检查模板，请先在标准管理中发布`}
          />
        </Card>
      ) : (
        <Card
          size="small"
          title={
            <Space size={8} wrap>
              <span>{template.name}</span>
              <Tag>v{template.version}</Tag>
              <span className="muted">
                生效窗口 {template.window.start} ~ {template.window.end}
              </span>
            </Space>
          }
        >
          <Alert
            className="rule-banner"
            type="info"
            showIcon
            message="提交后将冻结当前模板版本与判定标准；后续发布新标准不会重算本次记录。"
          />
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {template.items.map((item) => {
              const value = values[item.id] ?? "";
              const judgement = judgeValue(item, value);
              return (
                <div key={item.id} className="entry-row">
                  <div className="entry-meta">
                    <strong>
                      {item.device} · {item.name}
                    </strong>
                    {item.required ? <Tag color="blue">必检</Tag> : <Tag>选检</Tag>}
                    <span className="muted">允许：{rangeText(item)}</span>
                  </div>
                  <div className="entry-input">
                    {item.type === "number" ? (
                      <Input
                        value={value}
                        placeholder={`数值${item.unit ? `（${item.unit}）` : ""}`}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [item.id]: event.target.value }))
                        }
                      />
                    ) : (
                      <Select
                        value={value || undefined}
                        placeholder="请选择"
                        style={{ width: "100%" }}
                        onChange={(next) =>
                          setValues((current) => ({ ...current, [item.id]: next }))
                        }
                        options={(item.options ?? []).map((option) => ({ value: option, label: option }))}
                      />
                    )}
                    {value.trim() !== "" && judgement ? <JudgementTag judgement={judgement} /> : null}
                  </div>
                </div>
              );
            })}
            <Button type="primary" block onClick={handleSubmit}>
              提交巡检（冻结 v{template.version}）
            </Button>
          </Space>
        </Card>
      )}
    </div>
  );
}
