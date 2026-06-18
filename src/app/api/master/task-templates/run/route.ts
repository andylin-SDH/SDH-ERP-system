import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/api";
import { runMasterTaskTemplatesForToday } from "@/lib/master-task-template-run";

/** 手動觸發長期案排程（略過「是否為觸發日」，仍防同月重複建立） */
export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await runMasterTaskTemplatesForToday({ force: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("POST /api/master/task-templates/run error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "執行排程失敗" },
      { status: 500 }
    );
  }
}
