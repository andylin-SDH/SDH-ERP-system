import { TASK_DUE_SOON_DAYS } from "@/config/task-due";
import type { TaskRow } from "@/modules/tasks/types";

/** 解析 YYYY-MM-DD 或 ISO 開頭為本地日曆日 */
export function parseTaskDueDate(raw: string | null | undefined): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d);
}

/** 今日 0:00 本地時間 */
export function startOfTodayLocal(): Date {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 到期日距「今天」的天數：未來為正、當天 0、過去為負 */
export function dueDaysFromToday(到期日: string | null | undefined): number | null {
  const due = parseTaskDueDate(到期日);
  if (!due) return null;
  const t0 = startOfTodayLocal();
  return Math.round((due.getTime() - t0.getTime()) / 86_400_000);
}

export type TaskDueUiStatus = "none" | "soon" | "overdue" | "scheduled";

export function getTaskDueUiStatus(任務完成: boolean | undefined, 到期日: string | null | undefined): TaskDueUiStatus {
  if (任務完成) return "none";
  const days = dueDaysFromToday(到期日);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days <= TASK_DUE_SOON_DAYS) return "soon";
  return "scheduled";
}

/**
 * 是否應寄送「即將到期／逾期」通知（尚未寄過）
 * - 未完工、有到期日、未寄過
 * - 到期日在 [今天, 今天+N] 內（即將），或已早於今天（逾期）
 */
export function shouldSendDueReminder(
  任務完成: boolean | undefined,
  到期日: string | null | undefined,
  到期提醒寄送於: string | null | undefined
): boolean {
  if (任務完成) return false;
  if (到期提醒寄送於) return false;
  const days = dueDaysFromToday(到期日);
  if (days === null) return false;
  if (days > TASK_DUE_SOON_DAYS) return false;
  return true;
}

export type AssigneeWorkloadRow = {
  assigneeLabel: string;
  open: number;
  soon: number;
  overdue: number;
  noDueOpen: number;
};

/** 依「任務負責人」彙總負載（含搜尋／可見範圍篩過的列表） */
export function aggregateTasksByAssignee(tasks: TaskRow[]): AssigneeWorkloadRow[] {
  const map = new Map<
    string,
    { open: number; soon: number; overdue: number; noDueOpen: number }
  >();
  for (const t of tasks) {
    const key = (t.任務負責人 ?? "").trim() || "（未指定）";
    if (!map.has(key)) map.set(key, { open: 0, soon: 0, overdue: 0, noDueOpen: 0 });
    const g = map.get(key)!;
    if (t.任務完成) continue;
    g.open += 1;
    if (!(t.到期日?.trim())) {
      g.noDueOpen += 1;
      continue;
    }
    const st = getTaskDueUiStatus(t.任務完成, t.到期日);
    if (st === "soon") g.soon += 1;
    else if (st === "overdue") g.overdue += 1;
  }
  return [...map.entries()]
    .map(([assigneeLabel, v]) => ({ assigneeLabel, ...v }))
    .filter((r) => r.open > 0)
    .sort((a, b) => b.open - a.open || a.assigneeLabel.localeCompare(b.assigneeLabel, "zh-TW"));
}
