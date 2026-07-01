import { NextRequest, NextResponse } from "next/server";
import { getTasks, createTask, updateTask, deleteTaskById } from "@/lib/db/tasks";
import { getEmailByNameOrEmail } from "@/modules/users";
import { sendTaskAssignedEmail } from "@/lib/email";
import { requireEmployee } from "@/lib/auth/api";

function taskCreatorLabel(user: { name?: string | null; email?: string | null }): string {
  return String(user.name ?? "").trim() || String(user.email ?? "").trim();
}

export async function GET(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const tasks = await getTasks();
    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    console.error("GET /api/tasks error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      專案ID?: string;
      專案名稱?: string;
      任務名稱?: string;
      任務類型?: string;
      負責人?: string;
      備註?: string | null;
      到期日?: string | null;
    } | null;
    const 專案ID = String(body?.專案ID ?? "").trim();
    if (!專案ID) {
      return NextResponse.json({ ok: false, error: "專案ID 為必填" }, { status: 400 });
    }
    const 任務名稱 = String(body?.任務名稱 ?? "").trim();
    if (!任務名稱) {
      return NextResponse.json({ ok: false, error: "任務名稱 為必填" }, { status: 400 });
    }
    const 專案名稱 = (body?.專案名稱 ?? "").toString().trim() || null;
    const 建立者 = taskCreatorLabel(auth.user);
    const task = await createTask({
      專案ID,
      專案名稱: 專案名稱 ?? null,
      任務名稱,
      任務類型: body?.任務類型 ?? null,
      負責人: body?.負責人 ?? null,
      建立者,
      備註: body?.備註 !== undefined ? (body.備註 === null || body.備註 === "" ? null : String(body.備註)) : undefined,
      到期日: body?.到期日 !== undefined ? (body.到期日 === null || body.到期日 === "" ? null : String(body.到期日)) : undefined,
    });
    // 若有指定負責人，非同步寄送指派通知（失敗不影響 API 回應）
    const 負責人 = (body?.負責人 ?? "").toString().trim();
    if (負責人) {
      getEmailByNameOrEmail(負責人).then((email) => {
        if (email) {
          sendTaskAssignedEmail({
            to: email,
            taskName: 任務名稱,
            projectId: 專案ID,
            projectName: 專案名稱 || undefined,
            taskId: task.任務ID,
            creator: 建立者 || undefined,
            note: body?.備註 ?? undefined,
          }).catch((e) => console.error("POST /api/tasks 寄送通知失敗", e));
        }
      });
    }
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    console.error("POST /api/tasks error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "新增任務失敗" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as {
      任務ID?: string;
      任務名稱?: string;
      任務類型?: string;
      負責人?: string;
      備註?: string | null;
      任務完成?: boolean;
      到期日?: string | null;
      /** 僅編輯任務按「儲存」且前端判定有內容變更時為 true */
      notifyAssignee?: boolean;
    } | null;
    const 任務ID = String(body?.任務ID ?? "").trim();
    if (!任務ID) {
      return NextResponse.json({ ok: false, error: "任務ID 為必填" }, { status: 400 });
    }
    const task = await updateTask({
      任務ID,
      任務名稱: body?.任務名稱,
      任務類型: body?.任務類型,
      負責人: body?.負責人,
      備註: body?.備註 !== undefined ? (body.備註 === null || body.備註 === "" ? null : String(body.備註)) : undefined,
      任務完成: body?.任務完成,
      到期日: body?.到期日 !== undefined ? (body.到期日 === null || body.到期日 === "" ? null : String(body.到期日)) : undefined,
    });
    // 僅前端編輯任務按「儲存」且內容有變更時寄送；列表快速勾選完成／改類型等不自動寄信
    if (body?.notifyAssignee === true) {
      const 負責人 = String(task.任務負責人 ?? "").trim();
      if (負責人) {
        getEmailByNameOrEmail(負責人).then((email) => {
          if (email) {
            sendTaskAssignedEmail({
              to: email,
              taskName: task.任務 ?? "",
              projectId: task.專案ID ?? "",
              projectName: task.專案名稱 ?? undefined,
              taskId: task.任務ID,
              creator: task.建立者 ?? undefined,
              note: task.備註 ?? undefined,
            }).catch((e) => console.error("PATCH /api/tasks 寄送通知失敗", e));
          }
        });
      }
    }
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    console.error("PATCH /api/tasks error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "更新任務失敗" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireEmployee(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { 任務ID?: string } | null;
    const 任務ID = String(body?.任務ID ?? "").trim();
    if (!任務ID) {
      return NextResponse.json({ ok: false, error: "任務ID 為必填" }, { status: 400 });
    }
    const deleted = await deleteTaskById(任務ID);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "找不到該任務或刪除失敗" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, 任務ID });
  } catch (error) {
    console.error("DELETE /api/tasks error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "刪除任務失敗" },
      { status: 500 }
    );
  }
}
