import { useMemo, useState } from "react";
import { AREAS, areaNameOf } from "../domain/catalog";
import type { InspectionRecord } from "../domain/types";
import { useStore } from "../storage/store";
import { formatDateTime } from "../storage/time";
import { Badge, Empty, VerdictBadge } from "./components";

const FILTERS = ["全部区域", ...AREAS.map((area) => area.name)];

export default function RecordsPage({
  onSpotCheck
}: {
  onSpotCheck: (inspectionId: string, deviceId?: string) => void;
}) {
  const db = useStore();
  const [filter, setFilter] = useState(FILTERS[0]);

  const records = useMemo(() => {
    if (filter === "全部区域") return db.records;
    return db.records.filter((record) => areaNameOf(record.areaCode) === filter);
  }, [db.records, filter]);

  const spotKey = (inspectionId: string, deviceId: string) =>
    `${inspectionId}|${deviceId}`;
  const spotted = useMemo(() => {
    const set = new Set<string>();
    for (const spot of db.spotChecks) set.add(spotKey(spot.inspectionId, spot.refDeviceId));
    return set;
  }, [db.spotChecks]);

  return (
    <section className="list-panel full">
      <div className="toolbar">
        <h2>巡检记录与冻结快照（{records.length}）</h2>
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          {FILTERS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <p className="panel-tip">
        每条记录内嵌提交时冻结的标准版本与允许范围；标准改版后，旧记录按原快照展示，不重新判定。
      </p>

      <div className="record-grid">
        {records.length === 0 ? (
          <Empty text="暂无巡检记录" />
        ) : (
          records.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              spotted={spotted}
              onSpotCheck={onSpotCheck}
            />
          ))
        )}
      </div>
    </section>
  );
}

function RecordCard({
  record,
  spotted,
  onSpotCheck
}: {
  record: InspectionRecord;
  spotted: Set<string>;
  onSpotCheck: (inspectionId: string, deviceId?: string) => void;
}) {
  const abnormalCount = record.results.filter((result) => result.verdict === "abnormal").length;

  return (
    <article className="record record-wide">
      <div className="record-head">
        <p className="record-title">
          {record.code} · {record.areaName}
        </p>
        {abnormalCount > 0 ? <Badge tone="red">{abnormalCount} 项异常</Badge> : <Badge tone="green">全部正常</Badge>}
      </div>

      <div className="details">
        <span>巡检人：{record.inspector}</span>
        <span>巡检时间：{formatDateTime(record.checkedAt)}</span>
      </div>

      <div className="snapshot-box">
        <div className="snapshot-head">
          <span className="badge tone-blue">冻结标准</span>
          <strong>{record.template.code}</strong>
          <span>
            V{String(record.template.version).padStart(2, "0")} · {record.template.name}
          </span>
          <span className="hint-text">快照时间 {formatDateTime(record.template.frozenAt)}</span>
        </div>

        <table className="result-table">
          <thead>
            <tr>
              <th>必检设备</th>
              <th>指标 / 允许范围（快照）</th>
              <th>读数</th>
              <th>判定</th>
              <th>备注</th>
              <th>抽检</th>
            </tr>
          </thead>
          <tbody>
            {record.template.devices.map((device) => {
              const result = record.results.find((item) => item.deviceId === device.deviceId)!;
              const expected =
                device.kind === "numeric"
                  ? `${device.metric}：${device.min === null ? "≥ " + device.max : device.max === null ? "≤ " + device.min : `${device.min} ~ ${device.max}`}`
                  : `${device.metric}：应为「${device.expected}」`;
              const isSpotted = spotted.has(`${record.id}|${device.deviceId}`);
              return (
                <tr key={device.deviceId} className={result.verdict === "abnormal" ? "row-abnormal" : ""}>
                  <td>
                    {device.name}
                    <span className="device-id">{device.deviceId}</span>
                  </td>
                  <td>{expected}</td>
                  <td className="cell-value">{result.value}</td>
                  <td><VerdictBadge verdict={result.verdict} /></td>
                  <td className="cell-note">{result.note || "—"}</td>
                  <td>
                    {isSpotted ? (
                      <Badge tone="gray">已抽检</Badge>
                    ) : (
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => onSpotCheck(record.id, device.deviceId)}
                      >
                        登记抽检
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {record.overallNote ? <p className="note">{record.overallNote}</p> : null}
      <div className="actions">
        <button type="button" className="secondary" onClick={() => onSpotCheck(record.id)}>
          为本记录登记抽检
        </button>
      </div>
    </article>
  );
}
