// 领域模型：模板、巡检记录、复核任务共用的类型定义

export type ItemType = "number" | "select";

export type Judgement = "normal" | "abnormal";

export type TemplateStatus = "draft" | "published";

export type TaskStatus = "pending" | "resolved";

export type ClosureStatus = "open" | "closed";

export interface TemplateItem {
  id: string;
  name: string;
  device: string;
  type: ItemType;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
  required: boolean;
}

export interface TemplateWindow {
  start: string; // YYYY-MM-DD，含当天
  end: string; // YYYY-MM-DD，含当天
}

export interface InspectionTemplate {
  id: string;
  name: string;
  area: string;
  version: number;
  status: TemplateStatus;
  window: TemplateWindow;
  items: TemplateItem[];
  publishedAt?: string;
  createdAt: string;
}

export interface Closure {
  status: ClosureStatus;
  closedBy?: string;
  closedAt?: string;
  note?: string;
}

export interface FrozenRange {
  type: ItemType;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface InspectionEntry {
  id: string;
  itemId: string;
  name: string;
  device: string;
  required: boolean;
  frozen: FrozenRange; // 提交时冻结的判定标准，不随模板更新
  value: string;
  judgement: Judgement;
  closure: Closure;
}

export interface InspectionRecord {
  id: string;
  area: string;
  inspector: string;
  inspectedAt: string; // YYYY-MM-DDTHH:mm 本地时间
  submittedAt: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  entries: InspectionEntry[];
}

export interface ReviewTask {
  id: string;
  recordId: string;
  entryId: string;
  area: string;
  itemName: string;
  device: string;
  originalInspector: string;
  originalValue: string;
  originalJudgement: Judgement;
  spotInspector: string;
  spotValue: string;
  spotJudgement: Judgement;
  reason: string;
  status: TaskStatus;
  createdAt: string;
  reviewer?: string;
  reviewNote?: string;
  reviewedAt?: string;
}

export interface PersistedState {
  version: 2;
  templates: InspectionTemplate[];
  records: InspectionRecord[];
  tasks: ReviewTask[];
}
