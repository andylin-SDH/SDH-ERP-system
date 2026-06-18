/**
 * 長期案任務模板：依排程建立任務（cron 與手動觸發共用）
 */

import { listEnabledMasterTaskTemplates, updateMasterTaskTemplate } from "@/lib/db/master-task-templates";
import { getMasterList } from "@/lib/db/master";
import { createTask } from "@/lib/db/tasks";
import { getEmailByNameOrEmail } from "@/modules/users";
import { sendTaskAssignedEmail } from "@/lib/email";
import {
  daysInTaipeiMonth,
  getTaipeiDateString,
  getTaipeiYmd,
  taipeiMonthKey,
} from "@/lib/taiwan-date";

export type RunMasterTaskTemplatesResult = {
  checked: number;
  created: number;
  mailed: number;
  skipped: number;
  errors: string[];
};

/** 在台灣時區的「今天」是否應觸發此模板 */
export function shouldTriggerTemplateToday(
  dayOfMonth: number,
  leadDays: number,
  lastTriggerKey: string | null,
  today = getTaipeiDateString()
): { trigger: boolean; dueDate: string; monthKey: string } {
  const { year, month } = getTaipeiYmd(new Date(`${today}T12:00:00+08:00`));
  const dueDay = Math.min(Math.max(1, dayOfMonth), daysInTaipeiMonth(year, month));
  const dueDate = `${year}-${String(month).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
  const monthKey = taipeiMonthKey(year, month);

  if (lastTriggerKey === monthKey) {
    return { trigger: false, dueDate, monthKey };
  }

  const dueMs = new Date(`${dueDate}T12:00:00+08:00`).getTime();
  const leadMs = Math.max(0, leadDays) * 24 * 60 * 60 * 1000;
  const triggerDate = getTaipeiDateString(new Date(dueMs - leadMs));

  return { trigger: triggerDate === today, dueDate, monthKey };
}

export async function runMasterTaskTemplatesForToday(options?: {
  /** 手動觸發時略過「是否為觸發日」檢查，仍會防同月重複 */
  force?: boolean;
}): Promise<RunMasterTaskTemplatesResult> {
  const today = getTaipeiDateString();
  const masters = await getMasterList();
  const masterMap = new Map(masters.map((r) => [r.專案ID, r]));
  const templates = await listEnabledMasterTaskTemplates();
  let created = 0;
  let mailed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const tpl of templates) {
    const master = masterMap.get(tpl.專案ID);
    if (!master || !master.長期案) {
      skipped++;
      continue;
    }

    const { trigger, dueDate, monthKey } = shouldTriggerTemplateToday(
      tpl.每月幾號,
      tpl.提前天數,
      tpl.最後觸發鍵,
      today
    );

    if (!options?.force && !trigger) {
      skipped++;
      continue;
    }
    if (tpl.最後觸發鍵 === monthKey) {
      skipped++;
      continue;
    }

    try {
      const createdTask = await createTask({
        專案ID: tpl.專案ID,
        專案名稱: master.專案名稱 ?? undefined,
        任務名稱: tpl.任務名稱,
        任務類型: tpl.任務類型 ?? undefined,
        負責人: tpl.負責人 ?? undefined,
        建立者: options?.force ? "手動觸發排程" : "系統排程",
        備註: tpl.備註 ?? undefined,
        到期日: dueDate,
        來源模板ID: tpl.id,
        排程鍵: monthKey,
      });
      await updateMasterTaskTemplate({ id: tpl.id, 最後觸發鍵: monthKey });
      const assignee = String(tpl.負責人 ?? "").trim();
      if (assignee) {
        const email = await getEmailByNameOrEmail(assignee);
        if (email) {
          const mailRes = await sendTaskAssignedEmail({
            to: email,
            taskName: tpl.任務名稱,
            projectId: tpl.專案ID,
            projectName: master.專案名稱 ?? undefined,
            taskId: createdTask.任務ID,
            creator: options?.force ? "手動觸發排程" : "系統排程",
            note: tpl.備註 ?? undefined,
          });
          if (mailRes.ok) mailed++;
        }
      }
      created++;
    } catch (e) {
      errors.push(`template ${tpl.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { checked: templates.length, created, mailed, skipped, errors: errors.slice(0, 30) };
}
