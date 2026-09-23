/**
 * 时间工具：ISO 字符串与 <input type="datetime-local"> 之间转换，
 * 统一在本地时区处理，页面与存储各用各的格式。
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** ISO 字符串 → datetime-local 控件值（本地时区，精确到分钟） */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** datetime-local 控件值 → ISO 字符串 */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/** 日期选择控件（date）→ 当天 23:59，用于巡检日期等 */
export function dateEndOfDay(value: string): string {
  return new Date(`${value}T23:59:00`).toISOString();
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function formatRange(start: string, end: string): string {
  return `${formatDateTime(start)} ~ ${formatDateTime(end)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
