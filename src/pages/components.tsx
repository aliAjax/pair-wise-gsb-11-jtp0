import type { ReactNode } from "react";
import type { TemplateStatus, Verdict, AnomalyStatus, ReviewTaskStatus } from "../domain/types";

/** 页面共享的纯展示组件，不含业务规则与存储访问。 */

const toneClass: Record<string, string> = {
  gray: "tone-gray",
  green: "tone-green",
  red: "tone-red",
  amber: "tone-amber",
  blue: "tone-blue"
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof toneClass; children: ReactNode }) {
  return <span className={`badge ${toneClass[tone]}`}>{children}</span>;
}

export const verdictTone: Record<Verdict, "green" | "red" | "gray"> = {
  normal: "green",
  abnormal: "red",
  unchecked: "gray"
};

export const verdictText: Record<Verdict, string> = {
  normal: "正常",
  abnormal: "异常",
  unchecked: "未检"
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge tone={verdictTone[verdict]}>{verdictText[verdict]}</Badge>;
}

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  return status === "published" ? <Badge tone="blue">已发布</Badge> : <Badge tone="amber">草稿</Badge>;
}

export function AnomalyStatusBadge({ status }: { status: AnomalyStatus }) {
  return status === "open" ? <Badge tone="red">未闭环</Badge> : <Badge tone="green">已闭环</Badge>;
}

export function ReviewStatusBadge({ status }: { status: ReviewTaskStatus }) {
  return status === "open" ? <Badge tone="red">待复核</Badge> : <Badge tone="green">已闭环</Badge>;
}

export function Banner({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

export function Empty({ text = "暂无数据" }: { text?: string }) {
  return <div className="empty">{text}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
