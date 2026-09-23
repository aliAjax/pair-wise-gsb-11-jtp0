// 共享展示组件：判定标签、范围文案、状态标签
import { Tag } from "antd";
import type { FrozenRange, Judgement } from "../domain/types";

export function JudgementTag({ judgement }: { judgement: Judgement }) {
  return judgement === "normal" ? <Tag color="green">正常</Tag> : <Tag color="red">异常</Tag>;
}

export function rangeText(range: FrozenRange): string {
  if (range.type === "number") {
    return `${range.min ?? "-"} ~ ${range.max ?? "-"}${range.unit ?? ""}`;
  }
  return `可选：${(range.options ?? []).join(" / ")}`;
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function fmtLocal(local?: string): string {
  if (!local) return "-";
  return local.replace("T", " ");
}
