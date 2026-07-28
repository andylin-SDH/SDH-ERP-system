import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { getMasterList } from "@/lib/db/master";
import { getTasks } from "@/lib/db/tasks";
import { getFinance } from "@/lib/db/finance";
import { buildMeetingSnapshot } from "@/lib/meeting/workload";

export const dynamic = "force-dynamic";

/** GET — 週一晨會：進行中專案 + 依主責人量能（不含金額欄） */
export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const [masterList, tasks, financeList] = await Promise.all([getMasterList(), getTasks(), getFinance()]);
    const financeByPid = new Map<string, (typeof financeList)[number]>();
    for (const f of financeList) {
      const pid = String(f.專案ID ?? "").trim();
      if (pid) financeByPid.set(pid, f);
    }
    const snapshot = buildMeetingSnapshot(masterList, tasks, financeByPid);
    return NextResponse.json({ ok: true, snapshot });
  } catch (e) {
    console.error("GET /api/meeting", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "讀取失敗" },
      { status: 500 }
    );
  }
}
