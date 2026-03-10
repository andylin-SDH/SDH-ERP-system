/**
 * POST /api/tasks/remind
 * 手動再次寄送任務指派通知給 任務負責人
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/server";
import { getEmailByNameOrEmail } from "@/modules/users";
import { sendTaskAssignedEmail } from "@/lib/email";
import { requireAuth } from "@/lib/auth/api";

function rowToTask(r: Record<string, unknown>) {
  return {
    專案ID: r.專案ID as string,
    專案名稱: (r.專案名稱 as string) ?? undefined,
    任務: (r.任務名稱 as string) ?? undefined,
    負責人: (r.負責人 as string) ?? undefined,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { 任務ID?: string } | null;
    const 任務ID = String(body?.任務ID ?? "").trim();
    if (!任務ID) {
      return NextResponse.json({ ok: false, error: "任務ID 為必填" }, { status: 400 });
    }

    const { data, error } = await getSupabase()
      .from("任務")
      .select("專案ID, 專案名稱, 任務名稱, 負責人")
      .eq("任務ID", 任務ID)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ ok: false, error: "找不到該任務" }, { status: 404 });
    }

    const task = rowToTask(data as Record<string, unknown>);
    const 負責人 = task.負責人?.trim();
    if (!負責人) {
      return NextResponse.json({ ok: false, error: "此任務未指定負責人" }, { status: 400 });
    }

    const email = await getEmailByNameOrEmail(負責人);
    if (!email) {
      return NextResponse.json({ ok: false, error: "找不到負責人對應的 email" }, { status: 400 });
    }

    const result = await sendTaskAssignedEmail({
      to: email,
      taskName: task.任務 ?? "",
      projectId: task.專案ID ?? "",
      projectName: task.專案名稱,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "寄送失敗" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, message: "已再次寄送提醒信件" });
  } catch (error) {
    console.error("POST /api/tasks/remind error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "寄送失敗" },
      { status: 500 }
    );
  }
}
