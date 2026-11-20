import { NextResponse } from "next/server";
import { requirePcUser } from "@/lib/production-case/access";
import {
  createEpisode,
  createPreprodTask,
  createRecordingSession,
  createWorkOrder,
  deleteProgram,
  patchEpisode,
  generateFromServices,
  getWorkOrder,
  listMemberships,
  patchPreprodTask,
  patchProgram,
  patchUpload,
  patchWorkOrder,
  reviewWorkOrder,
  submitDelivery,
  unlockWorkOrder,
} from "@/lib/production-case/db";
import { importCueFromSheetUrl } from "@/lib/production-case/cue-import";
import { nextProgramStage, nextWorkOrderStatus, rejectWorkOrderStatus } from "@/lib/production-case/lifecycle";

async function assertVendorOwnsWo(email: string, workorderId: string) {
  const wo = await getWorkOrder(workorderId);
  if (!wo) throw new Error("找不到工單");
  if (String(wo.assignee_email ?? "").toLowerCase() !== email.toLowerCase()) {
    throw new Error("只能操作指派給自己的工單");
  }
  return wo;
}

async function assertClientProgram(email: string, programId: string) {
  const memberships = await listMemberships({ email, programIds: [programId] });
  if (!memberships.some((m) => m.member_role === "案主")) throw new Error("無權限操作此案");
}

/** POST body: { action, ... } */
export async function POST(request: Request) {
  try {
    const auth = await requirePcUser(request);
    if (auth instanceof NextResponse) return auth;
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();
    const email = auth.user.email;

    if (action === "advance_program") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可推進節目階段" }, { status: 403 });
      }
      const id = String(body.id ?? "");
      const current = String(body.stage ?? "");
      const next = nextProgramStage(current);
      if (!next) return NextResponse.json({ ok: false, error: "無法再推進" }, { status: 400 });
      const program = await patchProgram(id, { workflow_stage: next }, email);
      return NextResponse.json({ ok: true, program });
    }

    if (action === "client_submit_onboarding") {
      if (auth.perspective !== "client") {
        return NextResponse.json({ ok: false, error: "僅案主可送出開案資料" }, { status: 403 });
      }
      const id = String(body.id ?? "");
      await assertClientProgram(email, id);
      const program = await patchProgram(id, { workflow_stage: "開案審核中" }, email);
      return NextResponse.json({ ok: true, program });
    }

    if (action === "advance_workorder") {
      const id = String(body.id ?? "");
      if (auth.perspective === "vendor") await assertVendorOwnsWo(email, id);
      else if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "無權限" }, { status: 403 });
      }
      const wo = await getWorkOrder(id);
      if (!wo) return NextResponse.json({ ok: false, error: "找不到工單" }, { status: 404 });
      const next = nextWorkOrderStatus(wo.status);
      if (!next) return NextResponse.json({ ok: false, error: "無法再推進" }, { status: 400 });
      const patch: Record<string, unknown> = { status: next };
      if (wo.status === "等待前置") {
        patch.prereq_status = "已解鎖";
        patch.prereq_missing = null;
      }
      const updated = await patchWorkOrder(id, patch, email);
      return NextResponse.json({ ok: true, workOrder: updated });
    }

    if (action === "unlock_workorder") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可解鎖前置" }, { status: 403 });
      }
      const updated = await unlockWorkOrder(String(body.id ?? ""), email);
      return NextResponse.json({ ok: true, workOrder: updated });
    }

    if (action === "submit_delivery") {
      const id = String(body.workorder_id ?? body.id ?? "");
      if (auth.perspective === "vendor") await assertVendorOwnsWo(email, id);
      else if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "無權限" }, { status: 403 });
      }
      const delivery = await submitDelivery({
        workorder_id: id,
        delivery_url: body.delivery_url ? String(body.delivery_url) : undefined,
        delivery_note: body.delivery_note ? String(body.delivery_note) : undefined,
        submitted_by: email,
      });
      return NextResponse.json({ ok: true, delivery });
    }

    if (action === "review_workorder") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可審核" }, { status: 403 });
      }
      const result = String(body.result ?? "") === "退回" ? "退回" : "通過";
      if (result === "退回" && !rejectWorkOrderStatus("待審核")) {
        /* ok */
      }
      const workOrder = await reviewWorkOrder({
        workorder_id: String(body.id ?? ""),
        result,
        reject_reason: body.reject_reason ? String(body.reject_reason) : undefined,
        reviewer_email: email,
      });
      return NextResponse.json({ ok: true, workOrder });
    }

    if (action === "patch_preprod") {
      if (auth.perspective !== "internal" && auth.perspective !== "client") {
        return NextResponse.json({ ok: false, error: "無權限" }, { status: 403 });
      }
      const patch = (body.patch as Record<string, unknown>) ?? {};
      const task = await patchPreprodTask(String(body.id ?? ""), patch, email);
      return NextResponse.json({ ok: true, task });
    }

    if (action === "patch_upload") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可更新上架" }, { status: 403 });
      }
      const upload = await patchUpload(String(body.id ?? ""), (body.patch as Record<string, unknown>) ?? {}, email);
      return NextResponse.json({ ok: true, upload });
    }

    if (action === "generate_from_services") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可依服務產生工單" }, { status: 403 });
      }
      const result = await generateFromServices(String(body.id ?? body.program_id ?? ""), email);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "import_cue_sheet") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可匯入" }, { status: 403 });
      }
      const result = await importCueFromSheetUrl({
        sheet_url: String(body.sheet_url ?? ""),
        program_name: body.program_name ? String(body.program_name) : undefined,
        client_name: body.client_name ? String(body.client_name) : undefined,
        actor_email: email,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "delete_program") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可刪除" }, { status: 403 });
      }
      const id = String(body.id ?? "").trim();
      if (!id) return NextResponse.json({ ok: false, error: "缺少節目 id" }, { status: 400 });
      await deleteProgram(id, email);
      return NextResponse.json({ ok: true, deleted: id });
    }

    if (action === "create_episode") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可新增單集" }, { status: 403 });
      }
      const episode = await createEpisode({
        program_id: String(body.program_id ?? ""),
        episode_no: Number(body.episode_no),
        season: body.season != null ? Number(body.season) : 1,
        title: String(body.title ?? ""),
        recording_date: body.recording_date ? String(body.recording_date) : undefined,
        air_date: body.air_date ? String(body.air_date) : undefined,
        actor_email: email,
      });
      return NextResponse.json({ ok: true, episode });
    }

    if (action === "patch_episode") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可編輯單集" }, { status: 403 });
      }
      const episode = await patchEpisode(
        String(body.id ?? ""),
        (body.patch as Record<string, unknown>) ?? {},
        email
      );
      return NextResponse.json({ ok: true, episode });
    }

    if (action === "create_preprod") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可新增前製" }, { status: 403 });
      }
      const task = await createPreprodTask({
        program_id: String(body.program_id ?? ""),
        task_type: String(body.task_type ?? ""),
        episode_id: body.episode_id ? String(body.episode_id) : null,
        assignee_name: body.assignee_name ? String(body.assignee_name) : undefined,
        due_date: body.due_date ? String(body.due_date) : undefined,
        actor_email: email,
      });
      return NextResponse.json({ ok: true, task });
    }

    if (action === "create_workorder") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可新增工單" }, { status: 403 });
      }
      const workOrder = await createWorkOrder({
        program_id: String(body.program_id ?? ""),
        service_name: String(body.service_name ?? ""),
        episode_id: body.episode_id ? String(body.episode_id) : null,
        assignee_name: body.assignee_name ? String(body.assignee_name) : undefined,
        assignee_email: body.assignee_email ? String(body.assignee_email) : undefined,
        due_date: body.due_date ? String(body.due_date) : undefined,
        actor_email: email,
      });
      return NextResponse.json({ ok: true, workOrder });
    }

    if (action === "create_session") {
      if (auth.perspective !== "internal") {
        return NextResponse.json({ ok: false, error: "僅內部可新增場次" }, { status: 403 });
      }
      const session = await createRecordingSession({
        program_id: String(body.program_id ?? ""),
        session_date: body.session_date ? String(body.session_date) : undefined,
        start_time: body.start_time ? String(body.start_time) : undefined,
        end_time: body.end_time ? String(body.end_time) : undefined,
        studio_name: body.studio_name ? String(body.studio_name) : undefined,
        actor_email: email,
      });
      return NextResponse.json({ ok: true, session });
    }

    return NextResponse.json({ ok: false, error: `未知操作：${action}` }, { status: 400 });
  } catch (e) {
    console.error("POST /api/production-case/actions", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "操作失敗" },
      { status: 500 }
    );
  }
}
