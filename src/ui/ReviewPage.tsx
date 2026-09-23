// 异常复核台：巡检记录快照、异常闭环、抽检偏离生成复核任务、复核闭环
import { useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Tag, message } from "antd";
import { AREAS, INSPECTORS } from "../domain/standards";
import type { InspectionEntry, InspectionRecord } from "../domain/types";
import { useStore } from "../store/useStore";
import { JudgementTag, fmtDateTime, fmtLocal, rangeText } from "./shared";

interface SpotTarget {
  record: InspectionRecord;
  entry: InspectionEntry;
}

interface CloseTarget {
  recordId: string;
  entryId: string;
  label: string;
}

export default function ReviewPage() {
  const records = useStore((state) => state.records);
  const tasks = useStore((state) => state.tasks);
  const closeAbnormality = useStore((state) => state.closeAbnormality);
  const createReviewFromSpot = useStore((state) => state.createReviewFromSpot);
  const resolveReview = useStore((state) => state.resolveReview);

  const [areaFilter, setAreaFilter] = useState<string>("全部区域");
  const [spotTarget, setSpotTarget] = useState<SpotTarget | null>(null);
  const [spotInspector, setSpotInspector] = useState("");
  const [spotValue, setSpotValue] = useState("");
  const [closeTarget, setCloseTarget] = useState<CloseTarget | null>(null);
  const [closedBy, setClosedBy] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { reviewer: string; note: string }>>({});
  const [messageApi, contextHolder] = message.useMessage();

  const filteredRecords = useMemo(
    () => records.filter((record) => areaFilter === "全部区域" || record.area === areaFilter),
    [records, areaFilter]
  );

  const pendingTasks = tasks.filter((task) => task.status === "pending");
  const resolvedTasks = tasks.filter((task) => task.status === "resolved");

  function openSpot(record: InspectionRecord, entry: InspectionEntry) {
    setSpotTarget({ record, entry });
    setSpotInspector("");
    setSpotValue("");
  }

  function handleSpotSubmit() {
    if (!spotTarget) return;
    const result = createReviewFromSpot({
      record: spotTarget.record,
      entry: spotTarget.entry,
      spotInspector,
      spotValue,
    });
    if (!result.ok) {
      messageApi.error(result.error ?? "抽检失败");
      return;
    }
    messageApi.success("抽检偏离原记录，已生成复核任务");
    setSpotTarget(null);
  }

  function handleCloseSubmit() {
    if (!closeTarget) return;
    if (!closedBy.trim()) {
      messageApi.error("请填写闭环人");
      return;
    }
    closeAbnormality(closeTarget.recordId, closeTarget.entryId, closedBy, closeNote);
    messageApi.success("异常已闭环");
    setCloseTarget(null);
    setClosedBy("");
    setCloseNote("");
  }

  function handleResolve(taskId: string, originalInspector: string) {
    const draft = reviewDrafts[taskId] ?? { reviewer: "", note: "" };
    const result = resolveReview(taskId, draft.reviewer, draft.note);
    if (!result.ok) {
      messageApi.error(result.error ?? "复核失败");
      return;
    }
    messageApi.success(`复核完成（复核人与原巡检人 ${originalInspector} 不同，校验通过）`);
  }

  return (
    <div className="page">
      {contextHolder}
      <Alert
        className="rule-banner"
        type="info"
        showIcon
        message="复核规则：记录按提交时的模板快照展示，不随新标准重算；抽检偏离原记录自动生成复核任务；复核人须与原巡检人不同。"
      />

      <Card
        size="small"
        title="复核任务"
        extra={<Tag color={pendingTasks.length > 0 ? "red" : "green"}>待复核 {pendingTasks.length}</Tag>}
      >
        {tasks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无复核任务" />
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {pendingTasks.map((task) => {
              const draft = reviewDrafts[task.id] ?? { reviewer: "", note: "" };
              return (
                <Card key={task.id} size="small" className="task-card">
                  <div className="template-head">
                    <strong>
                      {task.area} · {task.device} · {task.itemName}
                    </strong>
                    <Tag color="red">待复核</Tag>
                  </div>
                  <p className="muted">{task.reason}</p>
                  <div className="compare">
                    <div>
                      <span className="muted">原记录（{task.originalInspector}）</span>
                      <strong>
                        {task.originalValue} <JudgementTag judgement={task.originalJudgement} />
                      </strong>
                    </div>
                    <div>
                      <span className="muted">抽检（{task.spotInspector}）</span>
                      <strong>
                        {task.spotValue} <JudgementTag judgement={task.spotJudgement} />
                      </strong>
                    </div>
                    <div>
                      <span className="muted">生成时间</span>
                      <strong>{fmtDateTime(task.createdAt)}</strong>
                    </div>
                  </div>
                  <div className="field-row three">
                    <label className="field">
                      <span>复核人（须 ≠ {task.originalInspector}）</span>
                      <Input
                        value={draft.reviewer}
                        placeholder="复核人姓名"
                        list="reviewer-options"
                        onChange={(event) =>
                          setReviewDrafts((current) => ({
                            ...current,
                            [task.id]: { ...draft, reviewer: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>复核结论</span>
                      <Input
                        value={draft.note}
                        placeholder="例：现场复测确认，原记录误填"
                        onChange={(event) =>
                          setReviewDrafts((current) => ({
                            ...current,
                            [task.id]: { ...draft, note: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <Button
                      type="primary"
                      className="align-end"
                      onClick={() => handleResolve(task.id, task.originalInspector)}
                    >
                      完成复核
                    </Button>
                  </div>
                </Card>
              );
            })}
            {resolvedTasks.map((task) => (
              <Card key={task.id} size="small" className="task-card resolved">
                <div className="template-head">
                  <strong>
                    {task.area} · {task.device} · {task.itemName}
                  </strong>
                  <Tag color="green">已复核</Tag>
                </div>
                <p className="muted">
                  {task.reason}；复核人 {task.reviewer}（原巡检人 {task.originalInspector}），
                  {fmtDateTime(task.reviewedAt)}：{task.reviewNote}
                </p>
              </Card>
            ))}
          </Space>
        )}
      </Card>

      <Card
        size="small"
        title="巡检记录（模板快照）"
        extra={
          <Select
            size="small"
            value={areaFilter}
            onChange={setAreaFilter}
            style={{ width: 110 }}
            options={["全部区域", ...AREAS].map((item) => ({ value: item, label: item }))}
          />
        }
      >
        {filteredRecords.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无巡检记录" />
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {filteredRecords.map((record) => {
              const abnormalCount = record.entries.filter((entry) => entry.judgement === "abnormal").length;
              return (
                <Card key={record.id} size="small" className="record-card">
                  <div className="template-head">
                    <div>
                      <strong>{record.area}</strong>
                      <Tag className="version-tag">
                        {record.templateName} v{record.templateVersion}
                      </Tag>
                    </div>
                    {abnormalCount > 0 ? (
                      <Tag color="red">异常 {abnormalCount}</Tag>
                    ) : (
                      <Tag color="green">全部正常</Tag>
                    )}
                  </div>
                  <p className="muted">
                    巡检人 {record.inspector} · 巡检时间 {fmtLocal(record.inspectedAt)} · 提交于{" "}
                    {fmtDateTime(record.submittedAt)}
                  </p>
                  <div className="entry-list">
                    {record.entries.map((entry) => (
                      <div key={entry.id} className="entry-line">
                        <div className="entry-meta">
                          <strong>
                            {entry.device} · {entry.name}
                          </strong>
                          <span className="muted">冻结标准：{rangeText(entry.frozen)}</span>
                        </div>
                        <div className="entry-input">
                          <span>
                            {entry.value}
                            {entry.frozen.unit ?? ""}
                          </span>
                          <JudgementTag judgement={entry.judgement} />
                          {entry.judgement === "abnormal" ? (
                            entry.closure.status === "closed" ? (
                              <Tag color="green">
                                已闭环 · {entry.closure.closedBy} {fmtDateTime(entry.closure.closedAt)}
                              </Tag>
                            ) : (
                              <Button
                                size="small"
                                danger
                                onClick={() =>
                                  setCloseTarget({
                                    recordId: record.id,
                                    entryId: entry.id,
                                    label: `${entry.device} · ${entry.name}`,
                                  })
                                }
                              >
                                闭环
                              </Button>
                            )
                          ) : null}
                          <Button size="small" onClick={() => openSpot(record, entry)}>
                            抽检
                          </Button>
                        </div>
                        {entry.judgement === "abnormal" && entry.closure.status === "closed" && entry.closure.note ? (
                          <p className="muted closure-note">闭环说明：{entry.closure.note}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </Space>
        )}
      </Card>

      <datalist id="reviewer-options">
        {INSPECTORS.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>

      <Modal
        title={spotTarget ? `抽检：${spotTarget.entry.device} · ${spotTarget.entry.name}` : "抽检"}
        open={spotTarget !== null}
        onOk={handleSpotSubmit}
        onCancel={() => setSpotTarget(null)}
        okText="提交抽检"
        cancelText="取消"
      >
        {spotTarget ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <p className="muted">
              原记录：{spotTarget.record.inspector} 填报 {spotTarget.entry.value}
              {spotTarget.entry.frozen.unit ?? ""}（
              {spotTarget.entry.judgement === "normal" ? "正常" : "异常"}）；冻结标准：
              {rangeText(spotTarget.entry.frozen)}。偏离原记录将生成复核任务。
            </p>
            <label className="field">
              <span>抽检人</span>
              <Input
                value={spotInspector}
                onChange={(event) => setSpotInspector(event.target.value)}
                placeholder="姓名"
                list="reviewer-options"
              />
            </label>
            <label className="field">
              <span>抽检值</span>
              {spotTarget.entry.frozen.type === "select" ? (
                <Select
                  value={spotValue || undefined}
                  placeholder="请选择"
                  style={{ width: "100%" }}
                  onChange={setSpotValue}
                  options={(spotTarget.entry.frozen.options ?? []).map((option) => ({
                    value: option,
                    label: option,
                  }))}
                />
              ) : (
                <Input
                  value={spotValue}
                  onChange={(event) => setSpotValue(event.target.value)}
                  placeholder={`数值${spotTarget.entry.frozen.unit ? `（${spotTarget.entry.frozen.unit}）` : ""}`}
                />
              )}
            </label>
          </Space>
        ) : null}
      </Modal>

      <Modal
        title={closeTarget ? `异常闭环：${closeTarget.label}` : "异常闭环"}
        open={closeTarget !== null}
        onOk={handleCloseSubmit}
        onCancel={() => setCloseTarget(null)}
        okText="确认闭环"
        cancelText="取消"
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <label className="field">
            <span>闭环人</span>
            <Input
              value={closedBy}
              onChange={(event) => setClosedBy(event.target.value)}
              placeholder="姓名"
              list="reviewer-options"
            />
          </label>
          <label className="field">
            <span>处理说明</span>
            <Input.TextArea
              value={closeNote}
              onChange={(event) => setCloseNote(event.target.value)}
              placeholder="例：已更换密封圈并复测合格"
            />
          </label>
        </Space>
      </Modal>
    </div>
  );
}
