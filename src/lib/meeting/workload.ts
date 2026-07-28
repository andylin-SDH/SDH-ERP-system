import "server-only";

import { isPayoutModeB } from "@/config/master-payout-defaults";
import type { MasterRow } from "@/lib/db/master";
import type { TaskRow } from "@/modules/tasks/types";
import type { FinanceRow } from "@/modules/finance/types";
import { financeProgressShortLabel } from "@/lib/meeting/finance-progress";
import { isDateBeforeToday, isProjectInProgress, normalizeDateYmd } from "@/lib/meeting/project-lifecycle";
import type { MeetingProjectItem, MeetingSnapshot, MeetingTaskItem, PersonWorkloadGroup } from "@/lib/meeting/types";

export type { MeetingProjectItem, MeetingSnapshot, PersonWorkloadGroup } from "@/lib/meeting/types";

const UNASSIGNED = "（未指定主責）";

export function meetingPrimaryOwner(row: MasterRow): { name: string; role: string } {
  const exec = String(row.執行管理員 ?? "").trim();
  if (exec) return { name: exec, role: "執行管理員" };
  const pm = String(row.專案管理員 ?? "").trim();
  if (pm) return { name: pm, role: "專案管理員" };
  if (isPayoutModeB(String(row.專案類型 ?? ""))) {
    const dev = String(row.專案開發人 ?? "").trim();
    if (dev) return { name: dev, role: "專案開發人" };
  } else {
    const ref = String(row.專案引薦人 ?? "").trim();
    if (ref) return { name: ref, role: "專案引薦人" };
  }
  const bd = String(row.專案BDPM ?? "").trim();
  if (bd) return { name: bd, role: "專案BDPM" };
  return { name: UNASSIGNED, role: "—" };
}

function meetingSecondary(row: MasterRow, primaryName: string): string {
  const candidates: { label: string; name: string }[] = isPayoutModeB(String(row.專案類型 ?? ""))
    ? [
        { label: "開發", name: String(row.專案開發人 ?? "").trim() },
        { label: "BDPM", name: String(row.專案BDPM ?? "").trim() },
      ]
    : [
        { label: "引薦", name: String(row.專案引薦人 ?? "").trim() },
        { label: "BDPM", name: String(row.專案BDPM ?? "").trim() },
      ];
  const parts: string[] = [];
  for (const c of candidates) {
    if (c.name && c.name !== primaryName) parts.push(`${c.label}：${c.name}`);
  }
  const pm = String(row.專案管理員 ?? "").trim();
  if (pm && pm !== primaryName) parts.push(`PM：${pm}`);
  return parts.join(" · ");
}

function isTaskOpen(t: TaskRow): boolean {
  return !t.任務完成;
}

function isTaskOverdue(t: TaskRow): boolean {
  if (!isTaskOpen(t)) return false;
  const due = normalizeDateYmd(t.到期日);
  return due ? isDateBeforeToday(due) : false;
}

function mapMeetingTask(t: TaskRow): MeetingTaskItem {
  const due = normalizeDateYmd(t.到期日);
  return {
    任務ID: String(t.任務ID ?? "").trim(),
    任務: String(t.任務 ?? "").trim() || "—",
    任務類型: String(t.任務類型 ?? "").trim() || "—",
    任務負責人: String(t.任務負責人 ?? "").trim() || "—",
    到期日: due || "—",
    備註: String(t.備註 ?? "").trim(),
    逾期: isTaskOverdue(t),
  };
}

function sortMeetingTasks(tasks: MeetingTaskItem[]): MeetingTaskItem[] {
  return [...tasks].sort((a, b) => {
    if (a.逾期 !== b.逾期) return a.逾期 ? -1 : 1;
    if (a.到期日 !== "—" && b.到期日 !== "—" && a.到期日 !== b.到期日) return a.到期日.localeCompare(b.到期日);
    if (a.到期日 === "—" && b.到期日 !== "—") return 1;
    if (a.到期日 !== "—" && b.到期日 === "—") return -1;
    return a.任務.localeCompare(b.任務, "zh-Hant");
  });
}

export function buildMeetingSnapshot(
  masterList: MasterRow[],
  tasks: TaskRow[],
  financeByPid: Map<string, FinanceRow>
): MeetingSnapshot {
  const inProgress = masterList.filter((r) => isProjectInProgress(r.專案狀態));

  const openTasksByPid = new Map<string, TaskRow[]>();
  const openTasksByPerson = new Map<string, number>();
  const overdueByPid = new Map<string, number>();

  for (const t of tasks) {
    if (!isTaskOpen(t)) continue;
    const pid = String(t.專案ID ?? "").trim();
    if (pid) {
      if (!openTasksByPid.has(pid)) openTasksByPid.set(pid, []);
      openTasksByPid.get(pid)!.push(t);
      if (isTaskOverdue(t)) {
        overdueByPid.set(pid, (overdueByPid.get(pid) ?? 0) + 1);
      }
    }
    const assignee = String(t.任務負責人 ?? "").trim() || UNASSIGNED;
    openTasksByPerson.set(assignee, (openTasksByPerson.get(assignee) ?? 0) + 1);
  }

  const projects: MeetingProjectItem[] = inProgress.map((row) => {
    const pid = String(row.專案ID ?? "").trim();
    const primary = meetingPrimaryOwner(row);
    const payYmd = normalizeDateYmd(row.廠商預計付款日);
    const openList = openTasksByPid.get(pid) ?? [];
    const overdue = overdueByPid.get(pid) ?? 0;
    const 逾期警示: string[] = [];
    if (overdue > 0) 逾期警示.push(`任務逾期 ${overdue} 件`);
    if (payYmd && isDateBeforeToday(payYmd)) 逾期警示.push("預計付款日已過");

    return {
      masterId: String(row.id ?? "").trim(),
      專案ID: pid || "—",
      專案名稱: String(row.專案名稱 ?? "").trim() || "—",
      專案狀態: String(row.專案狀態 ?? "").trim() || "—",
      專案類型: String(row.專案類型 ?? "").trim() || "—",
      主責人: primary.name,
      主責角色: primary.role,
      執行管理員: String(row.執行管理員 ?? "").trim(),
      專案管理員: String(row.專案管理員 ?? "").trim(),
      協作: meetingSecondary(row, primary.name),
      KOL名稱: String(row.KOL名稱 ?? "").trim() || "—",
      廠商名稱: String(row.廠商名稱 ?? "").trim() || "—",
      開案日期: normalizeDateYmd(row.開案日期) || "—",
      狀態確認日期: normalizeDateYmd(row.狀態確認日期) || "—",
      廠商預計付款日: payYmd || "—",
      款項進度: financeProgressShortLabel(financeByPid.get(pid)),
      專案內容: String(row.專案內容 ?? "").trim(),
      備註: String(row.備註 ?? "").trim(),
      未完成任務數: openList.length,
      逾期任務數: overdue,
      逾期警示,
      待辦任務: sortMeetingTasks(openList.map(mapMeetingTask)),
    };
  });

  const byPerson = new Map<string, MeetingProjectItem[]>();
  for (const p of projects) {
    const key = p.主責人;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key)!.push(p);
  }

  const personGroups: PersonWorkloadGroup[] = [];
  for (const [person, list] of byPerson) {
    if (person === UNASSIGNED) continue;
    list.sort((a, b) => a.專案名稱.localeCompare(b.專案名稱, "zh-Hant"));
    const openTasks = openTasksByPerson.get(person) ?? 0;
    const 進行中專案數 = list.length;
    const 逾期任務數 = list.reduce((sum, p) => sum + p.逾期任務數, 0);
    personGroups.push({
      person,
      進行中專案數,
      未完成任務數: openTasks,
      逾期任務數,
      projects: list,
    });
  }
  personGroups.sort((a, b) => b.逾期任務數 - a.逾期任務數 || b.進行中專案數 - a.進行中專案數 || a.person.localeCompare(b.person, "zh-Hant"));

  const unassignedProjects = byPerson.get(UNASSIGNED) ?? [];

  return {
    generatedAt: new Date().toISOString(),
    inProgressCount: projects.length,
    personGroups,
    unassignedProjects,
  };
}
