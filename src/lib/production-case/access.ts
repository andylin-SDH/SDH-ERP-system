import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth, ADMIN_ROLES, KOL_ROLE } from "@/lib/auth/api";
import type { User } from "@/lib/types";
import { listMemberships } from "./db";
import type { PcPerspective, PcWorkOrder } from "./types";

const INTERNAL_ROLES = ["董事長", "管理者", "製作人", "行政", "經紀人", "會計"] as const;

export function resolvePerspective(user: User): PcPerspective {
  const role = String(user.role ?? "").trim();
  if (role === "外包") return "vendor";
  if (role === "製作案主") return "client";
  if (role === KOL_ROLE) return "kol";
  return "internal";
}

export function isInternalPcUser(user: User): boolean {
  const role = String(user.role ?? "").trim();
  return (INTERNAL_ROLES as readonly string[]).includes(role) || (ADMIN_ROLES as readonly string[]).includes(role);
}

/** 製作案任一角色皆可（員工／外包／案主／KOL） */
export async function requirePcUser(
  request: NextRequest | Request
): Promise<{ user: User; perspective: PcPerspective } | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;
  return { user: result.user, perspective: resolvePerspective(result.user) };
}

export async function requirePcInternal(
  request: NextRequest | Request
): Promise<{ user: User; perspective: "internal" } | NextResponse> {
  const result = await requirePcUser(request);
  if (result instanceof NextResponse) return result;
  if (result.perspective !== "internal") {
    return NextResponse.json({ ok: false, error: "此操作僅限內部人員" }, { status: 403 });
  }
  return { user: result.user, perspective: "internal" };
}

export async function programIdsForUser(user: User, perspective: PcPerspective): Promise<string[] | null> {
  if (perspective === "internal") return null; // 全開
  const memberships = await listMemberships({ email: user.email });
  const roleWanted =
    perspective === "vendor" ? "外包" : perspective === "client" ? "案主" : perspective === "kol" ? "KOL" : null;
  const ids = memberships
    .filter((m) => !roleWanted || m.member_role === roleWanted || m.member_role === "PM")
    .map((m) => m.program_id);
  return [...new Set(ids)];
}

/** 外包可見工單欄位白名單 */
export function projectWorkOrderForPerspective(wo: PcWorkOrder, perspective: PcPerspective): Record<string, unknown> {
  if (perspective === "internal") return { ...wo };
  if (perspective === "vendor") {
    return {
      id: wo.id,
      program_id: wo.program_id,
      episode_id: wo.episode_id,
      service_name: wo.service_name,
      unit_seq: wo.unit_seq,
      workorder_kind: wo.workorder_kind,
      assignee_email: wo.assignee_email,
      assignee_name: wo.assignee_name,
      due_date: wo.due_date,
      status: wo.status,
      prereq_status: wo.prereq_status,
      prereq_missing: wo.prereq_missing,
      vendor_payable: wo.vendor_payable,
      vendor_amount: wo.vendor_amount,
      included_revisions: wo.included_revisions,
      revision_round: wo.revision_round,
      review_status: wo.review_status,
    };
  }
  // client / kol：不看應付、不看外包個資細節
  return {
    id: wo.id,
    program_id: wo.program_id,
    episode_id: wo.episode_id,
    service_name: wo.service_name,
    due_date: wo.due_date,
    status: wo.status,
    prereq_status: wo.prereq_status,
    review_status: wo.review_status,
  };
}
