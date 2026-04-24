/**
 * 排程：長期案任務模板自動建立任務（每日）
 * 驗證：Authorization: Bearer CRON_SECRET 或 ?secret=
 */

import { NextRequest, NextResponse } from "next/server";
import { listEnabledMasterTaskTemplates, updateMasterTaskTemplate } from "@/lib/db/master-task-templates";
import { getMasterList } from "@/lib/db/master";
import { createTask } from "@/lib/db/tasks";
import { getEmailByNameOrEmail } from "@/modules/users";
import { sendTaskAssignedEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

function verifyCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = req.nextUrl.searchParams.get("secret");
  return q === secret;
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth() + 1;
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

      const dueDay = Math.min(Math.max(1, tpl.每月幾號), daysInMonth(y, m));
      const dueDate = new Date(Date.UTC(y, m - 1, dueDay));
      const triggerDate = new Date(dueDate);
      triggerDate.setUTCDate(triggerDate.getUTCDate() - Math.max(0, tpl.提前天數));
      const key = monthKey(dueDate);

      if (tpl.最後觸發鍵 === key) {
        skipped++;
        continue;
      }
      if (toDateString(today) !== toDateString(triggerDate)) {
        skipped++;
        continue;
      }

      try {
        await createTask({
          專案ID: tpl.專案ID,
          專案名稱: master.專案名稱 ?? undefined,
          任務名稱: tpl.任務名稱,
          任務類型: tpl.任務類型 ?? undefined,
          負責人: tpl.負責人 ?? undefined,
          備註: tpl.備註 ?? undefined,
          到期日: toDateString(dueDate),
          來源模板ID: tpl.id,
          排程鍵: key,
        });
        await updateMasterTaskTemplate({ id: tpl.id, 最後觸發鍵: key });
        const assignee = String(tpl.負責人 ?? "").trim();
        if (assignee) {
          const email = await getEmailByNameOrEmail(assignee);
          if (email) {
            const mailRes = await sendTaskAssignedEmail({
              to: email,
              taskName: tpl.任務名稱,
              projectId: tpl.專案ID,
              projectName: master.專案名稱 ?? undefined,
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

    return NextResponse.json({
      ok: true,
      checked: templates.length,
      created,
      mailed,
      skipped,
      errors: errors.slice(0, 30),
    });
  } catch (e) {
    console.error("GET /api/cron/master-task-templates", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
