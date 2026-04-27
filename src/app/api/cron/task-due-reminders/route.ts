/**
 * 排程：即將到期／逾期任務通知負責人（每日由 Vercel Cron 或外部 GET 觸發）
 * 驗證：Authorization: Bearer CRON_SECRET 或 ?secret= 與 CRON_SECRET 相同
 */

import { NextRequest, NextResponse } from "next/server";
import { listTasksForDueReminderCron, markTaskDueReminderSent } from "@/lib/db/tasks";
import { getEmailByNameOrEmail } from "@/modules/users";
import { sendTaskDueSoonEmail } from "@/lib/email";
import { shouldSendDueReminder, dueDaysFromToday } from "@/lib/task-due";

export const dynamic = "force-dynamic";

function verifyCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = req.nextUrl.searchParams.get("secret");
  return q === secret;
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await listTasksForDueReminderCron();
    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const t of rows) {
      if (!t.任務ID) continue;
      if (!shouldSendDueReminder(t.任務完成, t.到期日, undefined)) {
        skipped++;
        continue;
      }
      const assignee = (t.任務負責人 ?? "").trim();
      if (!assignee) {
        skipped++;
        continue;
      }
      const email = await getEmailByNameOrEmail(assignee);
      if (!email) {
        errors.push(`無法解析 Email：${assignee}`);
        continue;
      }
      const days = dueDaysFromToday(t.到期日);
      const isOverdue = days !== null && days < 0;
      const r = await sendTaskDueSoonEmail({
        to: email,
        taskName: t.任務 ?? "",
        projectId: t.專案ID ?? "",
        projectName: t.專案名稱,
        creator: t.建立者,
        note: t.備註,
        dueDate: t.到期日 ?? "",
        isOverdue,
      });
      if (r.ok) {
        await markTaskDueReminderSent(t.任務ID);
        sent++;
      } else {
        errors.push(`${t.任務ID}: ${r.error ?? "send failed"}`);
      }
    }
    return NextResponse.json({
      ok: true,
      sent,
      skipped,
      checked: rows.length,
      errors: errors.slice(0, 30),
    });
  } catch (e) {
    console.error("GET /api/cron/task-due-reminders", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
